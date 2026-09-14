/**
 * Reading a medication label (pharmacy bag sticker, blister-pack label,
 * bottle label) into a proposed medication + schedule + inventory row.
 *
 * WHY THIS IS ITS OWN PIPELINE, NOT A REUSE OF travel-doc.ts OR extractor.ts
 * A medication label is neither a receipt (one document, one total) nor a
 * travel document (one or more dated stops). It is one drug, one dosing
 * instruction, one dispensed quantity — closer in shape to the itinerary
 * reader than the receipt reader, so this mirrors travel-doc.ts's structure,
 * but the fields match what web/src/app/api/medications/route.ts POST
 * already accepts, so a proposal from here can be handed straight to that
 * existing endpoint without a translation layer.
 *
 * WHY NOT preprocessor.ts's normalizeImage
 * That function's landscape-correction step assumes the document is a
 * receipt or invoice — naturally taller than wide — and rotates anything
 * landscape into portrait. A pharmacy label is the opposite: a wide sticker,
 * landscape BY DESIGN. Running that heuristic here would "correct" a
 * correctly-oriented label into a wrong one. This pipeline keeps only the
 * EXIF auto-rotate step and otherwise leaves the frame alone, instructing
 * the model itself to read text at any rotation — which vision models
 * handle well for printed text, and which sidesteps needing a SECOND,
 * label-specific orientation heuristic that would be just as guessable-wrong
 * as reusing the receipt one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not write to the database. It proposes one medication; a person
 * reviews it in the existing "เพิ่มยา" form (pre-filled instead of blank) and
 * accepts or edits before POST /api/medications actually saves it. A
 * mis-read dose is a categorically worse mistake to make silently than a
 * mis-read flight time — this pipeline gets the exact same never-write
 * discipline as travel-doc.ts, not a lighter version of it because the
 * stakes are higher.
 */
import sharp from "sharp"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Matches travel-doc.ts's MODEL — same measured reasoning: small print, Thai text, exactness matters. */
const MODEL = process.env.MEDICATION_LABEL_MODEL ?? "claude-sonnet-5"

export interface ProposedMedication {
  name: string
  brand_name: string | null
  generic_name: string | null
  dosage_form: string
  strength: string | null
  purpose: string | null
  /** Verbatim, exactly as printed — the fallback when the parse below is wrong or partial. */
  instructions_verbatim: string | null
  /** Parsed pieces of the instruction, matching AddMedicationModal / POST /api/medications. */
  times: string[]
  dose_qty: number
  meal_relation: "before" | "after" | "with" | "any"
  meal_note: string | null
  qty_total: number | null
  qty_unit: string
  expiry_date: string | null
  prescribing_doctor: string | null
  hospital_name: string | null
  lot_no: string | null
  /** 0–1, the model's own confidence. A hint, never a gate. */
  confidence: number
}

export interface MedicationLabelResult {
  items: ProposedMedication[]
  issues: string[]
}

const SYSTEM = `You read Thai/English pharmacy medication labels — the sticker on a
pharmacy bag, a blister-pack label, or a bottle label — and turn each one into
a structured medication entry.

The photo may be rotated (0°, 90°, 180°, or 270° from upright) or photographed
at a slight angle. READ THE TEXT REGARDLESS OF ORIENTATION — do not refuse or
guess when a label is sideways or upside down; rotate it mentally and
transcribe what it actually says.

RULES

1. TRANSCRIBE, NEVER TRANSLATE THE DRUG NAME. "SERC" stays "SERC". A Thai
   instruction stays Thai, verbatim, in instructions_verbatim.

2. ONE ENTRY PER LABEL. If a photo shows more than one distinct label (e.g.
   two blister packs with two different printed labels in frame), return one
   entry per label. A single label is always exactly one entry, never split.

3. PARSE THE DOSING INSTRUCTION into times/dose_qty/meal_relation — Thai
   pharmacy instructions follow a small set of patterns:
   - "รับประทานครั้งละ N เม็ด วันละ M ครั้ง [ก่อน/หลัง]อาหาร[ทันที]" → dose_qty=N,
     M evenly-spaced times starting near 07:00–08:00 (e.g. M=3 → ["08:00",
     "13:00", "19:00"]; M=2 → ["08:00", "19:00"]; M=1 → ["08:00"]),
     meal_relation = "before" or "after" from the text (default "any" if
     unstated), meal_note = the qualifier if any ("ทันที", "ก่อนนอน", etc).
   - "ก่อนนอน" (before bed) → times=["22:00"], meal_relation="any",
     meal_note="ก่อนนอน".
   - "เมื่อมีอาการ" / as-needed → times=[] (nothing to schedule), and say so
     in issues rather than inventing a time.
   - Always ALSO set instructions_verbatim to the exact printed Thai/English
     text, so a wrong parse is still visible and correctable next to the
     source.

4. QUANTITY: read the QTY/quantity dispensed field (often "QTY: [N เม็ด]" or
   similar) into qty_total, with its unit (เม็ด, แคปซูล, ขวด...) into qty_unit.

5. DATES: expiry_date as "YYYY-MM-DD" if printed (often absent on a dispensing
   label — leave null, do not guess from a lot number).

6. WHEN A FIELD IS NOT PRINTED, RETURN null. An invented prescriber or dose is
   worse than a missing one.

7. Put anything you are unsure about in issues, in Thai — including any label
   you could not confidently read at all (blurry, cut off, wrong document type).

DOSAGE FORMS: tablet, capsule, liquid, injection, cream, drops, inhaler, other.

Reply with JSON only, no prose, no code fence:
{"items": [{"name": string, "brand_name": string|null, "generic_name": string|null,
  "dosage_form": string, "strength": string|null, "purpose": string|null,
  "instructions_verbatim": string|null, "times": [string], "dose_qty": number,
  "meal_relation": "before"|"after"|"with"|"any", "meal_note": string|null,
  "qty_total": number|null, "qty_unit": string, "expiry_date": string|null,
  "prescribing_doctor": string|null, "hospital_name": string|null,
  "lot_no": string|null, "confidence": number}],
 "issues": [string]}`

/** Strip a ```json fence if the model added one despite being told not to. */
function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  const start = cleaned.indexOf("{")
  const end   = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("โมเดลไม่ได้ตอบเป็น JSON")
  return JSON.parse(cleaned.slice(start, end + 1))
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : ""
  return s.length ? s : null
}
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null

const MEAL: ReadonlySet<string> = new Set(["before", "after", "with", "any"])

function normDate(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(`${s}T00:00:00Z`)
  return d.toISOString().slice(0, 10) === s ? s : null
}

function normTimes(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map(t => (typeof t === "string" ? t.match(/^(\d{1,2}):(\d{2})/) : null))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`)
}

function coerceItem(raw: unknown): ProposedMedication | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const name = str(r.name)
  if (!name) return null   // an entry with no drug name is not usable

  return {
    name,
    brand_name: str(r.brand_name),
    generic_name: str(r.generic_name),
    dosage_form: str(r.dosage_form) ?? "tablet",
    strength: str(r.strength),
    purpose: str(r.purpose),
    instructions_verbatim: str(r.instructions_verbatim),
    times: normTimes(r.times),
    dose_qty: num(r.dose_qty) ?? 1,
    meal_relation: typeof r.meal_relation === "string" && MEAL.has(r.meal_relation)
      ? r.meal_relation as ProposedMedication["meal_relation"] : "any",
    meal_note: str(r.meal_note),
    qty_total: num(r.qty_total),
    qty_unit: str(r.qty_unit) ?? "เม็ด",
    expiry_date: normDate(r.expiry_date),
    prescribing_doctor: str(r.prescribing_doctor),
    hospital_name: str(r.hospital_name),
    lot_no: str(r.lot_no),
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
  }
}

/**
 * EXIF auto-rotate only — see the file header for why the receipt
 * pipeline's landscape-forcing step is deliberately NOT reused here.
 */
async function normalizeLabelImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 }).toBuffer()
}

export async function readMedicationLabel(buffer: Buffer): Promise<MedicationLabelResult> {
  const normalized = await normalizeLabelImage(buffer)

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: normalized.toString("base64") } },
        { type: "text", text: "อ่านฉลากยานี้แล้วสรุปเป็นรายการยา" },
      ],
    }],
  })

  const block = res.content.find(b => b.type === "text")
  if (!block || block.type !== "text") throw new Error("โมเดลไม่ได้ตอบกลับเป็นข้อความ")

  const parsed = parseJson(block.text) as Record<string, unknown>
  const items = Array.isArray(parsed.items)
    ? parsed.items.map(coerceItem).filter((i): i is ProposedMedication => i !== null)
    : []

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((s): s is string => typeof s === "string")
    : []

  const dropped = (Array.isArray(parsed.items) ? parsed.items.length : 0) - items.length
  if (dropped > 0) issues.push(`มี ${dropped} รายการที่อ่านได้ไม่ครบจนใช้ไม่ได้ และถูกตัดออก`)
  if (!items.length) issues.push("ไม่พบฉลากยาที่อ่านได้ในภาพนี้")

  return { items, issues }
}
