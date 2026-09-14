/**
 * Receipt row classification
 * =====================================================================
 * A receipt is a sequence of labelled amount rows, and the recurring bug is
 * that only SOME of them are real purchased items — the rest are discounts,
 * freebies, promos, subtotal/total, tax, cash/change, loyalty points and
 * marketing noise, printed in the same columns. Treating "line_items" as a
 * dumping ground meant those got summed, counted and shown as things you bought.
 *
 * This module makes the *role* of each row the single source of truth. Every
 * row is mapped to one `RowRole` from a fixed taxonomy via a bilingual (TH/EN)
 * lexicon plus structural signals (amount sign, qty×price). Downstream logic
 * then decides what to keep, sum, route to a field, or drop — driven by the
 * role, never by scattered ad-hoc regex.
 *
 * Deterministic on purpose: this exact task is where LLM extraction is least
 * reliable, so the code — not the model — has the final say, and it's unit
 * tested (`scripts/verify-rows.ts`).
 */

export type RowRole =
  | "item"           // real product/service purchased → counts toward subtotal
  | "freebie"        // ของแถม / free gift (฿0) → shown, not summed
  | "discount"       // ส่วนลด / promotion → reduces total, routed to discount_amount
  | "service_charge" // ค่าบริการ → routed to a fee field
  | "delivery_fee"   // ค่าจัดส่ง → routed to delivery_fee
  | "subtotal"       // ยอดก่อนภาษี
  | "vat"            // ภาษีมูลค่าเพิ่ม
  | "total"          // ยอดรวมสุทธิ
  | "tender"         // cash / card / transfer paid
  | "change"         // เงินทอน
  | "rounding"       // ปัดเศษ
  | "loyalty"        // คะแนน / points (not money)
  | "count"          // "Items: N" summary line
  | "noise"          // metadata / marketing text
  | "unknown"

export interface RowInput {
  label:      string
  amount?:    number | null
  quantity?:  number | null
  unitPrice?: number | null
}

export interface RowClassification {
  role:          RowRole
  isItem:        boolean  // contributes to the goods subtotal
  isDisplayable: boolean  // appears in the line-items list shown to the user
}

/** Learned label → role, mined from user corrections (see receipt-feedback.ts).
 *  Consulted BEFORE the static lexicon so the system adapts per organisation. */
export type LearnedOverrides = Record<string, RowRole>

/** Canonical key for a row label — used by both the learned overrides and the
 *  feedback aggregation so they always agree on what "the same label" means. */
export function normalizeLabel(label: unknown): string {
  return String(label ?? "").toLowerCase().replace(/[\s.,()\-฿*]/g, "").trim()
}

// Rows that only ever appear in the summary/payment region at the bottom.
const SUMMARY_MARKERS: ReadonlySet<RowRole> =
  new Set<RowRole>(["subtotal", "total", "vat", "tender", "change", "rounding"])

// ── Lexicon ───────────────────────────────────────────────────────────────────
// ORDER MATTERS — the first matching role wins, so list the specific/rare labels
// before the broad ones (e.g. เงินทอน before เงิน…, total before subtotal). Every
// pattern is anchored or word-bounded so a real dish name that merely CONTAINS a
// fragment ("ข้าวผัดรวมมิตร" vs "ยอดรวม", "สลัด" vs "ส่วนลด") is never misread.
const LEXICON: Array<{ role: RowRole; patterns: RegExp[] }> = [
  // Loyalty first: points lines often mention สมัครสมาชิก, which would otherwise
  // be swallowed by the metadata-noise "สมัครสมาชิก" below (both are dropped, but
  // the role should read as loyalty).
  { role: "loyalty", patterns: [/คะแนน/, /แต้ม/, /สะสม/, /\bpoints?\b/i, /reward/i, /redeem/i, /แลกของ/] },
  // Document metadata — so "Tax ID" / "Tel" / QR captions never look like tax/items.
  { role: "noise", patterns: [
    /powered\s*by/i, /foodstory/i, /สมัครสมาชิก/, /ขอบคุณ/, /thank\s*you/i,
    /www\.|https?:/i, /\btel\b/i, /โทร\.?\s*\d/, /\btax\s*id\b/i, /เลขประจำตัวผู้เสีย/,
    /\bstaff\b/i, /\bcashier\b/i, /\bqueue\b/i, /\btable\b/i, /\bguests?\b/i, /\bpos\s*id\b/i,
  ]},
  { role: "count",   patterns: [/^items?\b/i, /\bitems?\s*[:：]/i, /จำนวนรายการ/, /^qty\b/i, /^จำนวน\s*[:：]/] },
  { role: "change",  patterns: [/เงินทอน/, /^ทอน/, /\bchange\b/i] },
  { role: "rounding",patterns: [/ปัดเศษ/, /\bround(ing)?\b/i, /adjustment/i] },
  { role: "tender",  patterns: [
    /เงินสด/, /\bcash\b/i, /บัตรเครดิต/, /บัตรเดบิต/, /\b(credit|debit)\s*card\b/i,
    /\b(master\s*card|mastercard|visa|jcb|amex|unionpay)\b/i, /พร้อมเพย์/, /prompt\s*pay/i,
    /\bqr\b/i, /โอนเงิน/, /เงินโอน/, /\btransfer\b/i, /true\s*money/i, /\be-?wallet\b/i,
    /ชำระโดย/, /รับชำระ/, /\btender(ed)?\b/i, /\bpaid\b/i, /ยอดรับ/, /รับเงิน/,
  ]},
  { role: "total",   patterns: [
    /ยอดสุทธิ/, /ยอดรวมทั้งสิ้น/, /รวมทั้งสิ้น/, /ยอดชำระ/, /grand\s*total/i,
    /net\s*total/i, /amount\s*due/i, /\btotal\s*due\b/i, /\bnet\s*amount\b/i, /^\s*total\b/i,
  ]},
  { role: "vat",     patterns: [/ภาษีมูลค่าเพิ่ม/, /^ภาษี\b/, /\bvat\b/i, /\btax\b/i, /\b7\s*%/] },
  { role: "subtotal",patterns: [/ยอดก่อนภาษี/, /ก่อนภาษี/, /มูลค่าสินค้า/, /รวมเป็นเงิน/, /\bsub[\s-]*total\b/i] },
  { role: "service_charge", patterns: [/ค่าบริการ/, /เซอร์วิสชาร์จ/, /เซอร์วิส/, /service\s*charge/i] },
  { role: "delivery_fee",   patterns: [/ค่าจัดส่ง/, /ค่าส่ง/, /ค่าขนส่ง/, /\bdelivery\b/i, /\bshipping\b/i] },
  { role: "discount",       patterns: [
    /ส่วนลด/, /มูลค่าส่วนลด/, /\bdiscount\b/i, /โปรโมชั่น/, /\bpromo(tion)?\b/i,
    /คูปอง/, /\bcoupon\b/i, /\bvoucher\b/i, /\bdeal\b/i, /markdown/i,
  ]},
  { role: "freebie",        patterns: [/ของแถม/, /^แถม/, /ฟรี/, /\bfree\b/i, /complimentary/i, /giveaway/i, /on\s+the\s+house/i] },
]

function decorate(role: RowRole): RowClassification {
  switch (role) {
    case "item":    return { role, isItem: true,  isDisplayable: true }
    case "freebie": return { role, isItem: false, isDisplayable: true }
    default:        return { role, isItem: false, isDisplayable: false }
  }
}

/**
 * Assign a semantic role to one receipt row.
 * Falls back to structural signals when the label is unrecognised: a negative
 * amount is a discount, a ฿0 line is a freebie, otherwise it's a real item.
 */
export function classifyReceiptRow(input: RowInput, overrides?: LearnedOverrides): RowClassification {
  const label  = String(input.label ?? "").trim()
  const amount = input.amount ?? null

  if (!label) return decorate("noise")

  // Learned overrides win — the system's memory of what humans corrected.
  if (overrides) {
    const learned = overrides[normalizeLabel(label)]
    if (learned) return decorate(learned)
  }

  // Match on the label WITHOUT its parenthesised qualifier. On a receipt the
  // bracketed part says how an item was obtained, not what the row is:
  // "ทาโกะยากิ (แลกคะแนน)" is takoyaki that happened to be redeemed with points,
  // but the bare /คะแนน/ pattern classified the whole row as a loyalty line and
  // silently dropped a real product from the bill. Keywords that genuinely
  // define a row ("คะแนนสะสม", "ส่วนลดสมาชิก", "Subtotal") sit outside the
  // brackets, so they still match. Falls back to the full label when stripping
  // leaves nothing — e.g. a row printed as just "(ส่วนลด)".
  const core = label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()
  const matchTarget = core || label

  for (const { role, patterns } of LEXICON) {
    if (patterns.some(p => p.test(matchTarget))) return decorate(role)
  }

  if (amount != null && amount < 0) return decorate("discount")
  if (amount === 0)                 return decorate("freebie")
  return decorate("item")
}

/** Back-compat helper: true when a row should NOT appear in the products list. */
export function isNonItemRow(description: unknown): boolean {
  return !classifyReceiptRow({ label: String(description ?? "") }).isDisplayable
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

/** A row is a genuine product only if qty × unit_price ≈ amount (> 0). */
function hasStrongItemEvidence(row: ReclassifiableRow, amount: number | null): boolean {
  const q = numOrNull(row.quantity)
  const u = numOrNull(row.unit_price)
  return q != null && u != null && q > 0 && u > 0
    && amount != null && amount > 0
    && Math.abs(q * u - amount) <= Math.max(1, amount * 0.02)
}

// ── Bulk re-classification of an extracted document ───────────────────────────

export interface ReclassifiableRow {
  description?: unknown
  amount?:      unknown
  quantity?:    unknown
  unit_price?:  unknown
}

export interface ReclassifiableDoc {
  line_items?:        ReclassifiableRow[]
  discount_amount:    number
  delivery_fee:       number
  extraction_issues?: string[]
}

/**
 * Re-buckets `line_items` by role, in place:
 *   • item / freebie   → kept as products
 *   • discount         → accumulated into discount_amount (only if the LLM left it 0)
 *   • service / delivery → accumulated into delivery_fee (only if left 0)
 *   • everything else  → dropped (payment, totals, tax, points, noise)
 *
 * SUBTOTAL BOUNDARY: rows are processed in printed order, and once a summary
 * marker (subtotal / total / VAT / tender / change) is seen, any later row that
 * only *defaulted* to "item" (the lexicon didn't recognise it) is trailing
 * promo/footer text, not a product — dropped unless it shows real qty×price
 * evidence. This structural rule generalises across every vendor and language,
 * catching the long tail the keyword lexicon can't (e.g. "ยอดซื้อ 60.- ได้ 1 คะแนน").
 *
 * `overrides` (learned from user corrections) win over the static lexicon.
 * Never double-counts a field the model already populated.
 */
export function reclassifyLineItems<T extends ReclassifiableDoc>(
  doc: T, overrides?: LearnedOverrides,
): T {
  const rows = Array.isArray(doc.line_items) ? doc.line_items : []
  const kept: ReclassifiableRow[] = []
  let discountFromLines = 0
  let feeFromLines = 0
  const moved: string[] = []
  let seenSummary = false

  for (const row of rows) {
    const label  = String(row.description ?? "")
    const amount = numOrNull(row.amount)
    let c = classifyReceiptRow({
      label, amount,
      quantity:  numOrNull(row.quantity),
      unitPrice: numOrNull(row.unit_price),
    }, overrides)

    if (SUMMARY_MARKERS.has(c.role)) {
      // Only trust the boundary once REAL items have appeared above it. Otherwise
      // a summary row the model emitted first (or a misread) would wrongly demote
      // every genuine item that follows — the "amounts right but no line items"
      // failure. The boundary can now never empty a non-empty item list.
      if (kept.length > 0) seenSummary = true
    } else if (seenSummary && c.role === "item" && !hasStrongItemEvidence(row, amount)) {
      c = decorate("noise")   // past the totals → unrecognised row is footer text
      moved.push(`"${label}"→หลังยอดรวม(ตัด)`)
    }

    switch (c.role) {
      case "item":
      case "freebie":
        kept.push(row)
        break
      case "discount":
        discountFromLines += Math.abs(amount ?? 0)
        moved.push(`"${label}"→ส่วนลด`)
        break
      case "service_charge":
      case "delivery_fee":
        feeFromLines += Math.abs(amount ?? 0)
        moved.push(`"${label}"→ค่าบริการ/ค่าส่ง`)
        break
      case "noise":
        // Already recorded above when demoted by the boundary; skip duplicate note.
        if (label.trim() && !moved.some(m => m.startsWith(`"${label}"`))) moved.push(`"${label}"→noise`)
        break
      default:
        if (label.trim()) moved.push(`"${label}"→${c.role}`)
    }
  }

  doc.line_items = kept
  if (doc.discount_amount === 0 && discountFromLines > 0) doc.discount_amount = +discountFromLines.toFixed(2)
  if (doc.delivery_fee === 0 && feeFromLines > 0)         doc.delivery_fee = +feeFromLines.toFixed(2)
  if (moved.length) {
    doc.extraction_issues = [...(doc.extraction_issues ?? []), `จัดกลุ่มบรรทัดใหม่: ${moved.join(", ")}`]
  }
  return doc
}
