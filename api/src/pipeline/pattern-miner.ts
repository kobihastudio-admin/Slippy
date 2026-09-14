import { createClient } from "../lib/supabase"

/**
 * OCR Error Pattern Miner — ระบบเรียนรู้อัตโนมัติ
 *
 * วิเคราะห์ receipt_corrections เพื่อหา pattern ที่ AI อ่านผิดซ้ำๆ:
 *   - digit_swap  : "1" → "7", "3" → "8" ในตัวเลข
 *   - char_swap   : "น" → "ม", "เ" → "แ" ในข้อความไทย
 *   - vendor_alias: ชื่อร้านที่อ่านผิดซ้ำ
 *   - date_format : รูปแบบวันที่ที่แปลงผิด
 *
 * เรียกจาก:
 *   1. หลัง approve document (trigger เบาๆ)
 *   2. Cron job รายวัน (mine ทั้ง org)
 *
 * ผลลัพธ์เข้า ocr_error_patterns table
 * → few-shot.ts ดึงมาเตือน AI ในครั้งถัดไป
 */

interface CorrectionRow {
  id:              string
  document_id:     string
  field_name:      string
  ai_value:        string | null
  corrected_value: string | null
  vendor_name:     string | null
  doc_category:    string | null
}

interface ErrorPattern {
  field_name:      string
  wrong_value:     string
  correct_value:   string
  pattern_type:    "digit_swap" | "char_swap" | "vendor_alias" | "date_format" | "amount_format"
  occurrence_count: number
  example_doc_ids: string[]
}

// ── Pattern detectors ─────────────────────────────────────────────────────────

/** ตัวเลขที่สับสนบ่อยใน Thai thermal receipts */
const DIGIT_CONFUSION_PAIRS: [string, string][] = [
  ["1", "7"], ["7", "1"],
  ["3", "8"], ["8", "3"],
  ["0", "6"], ["6", "0"],
  ["5", "6"], ["6", "5"],
  ["1", "4"], ["4", "1"],
]

/** Thai characters ที่สับสนบ่อย */
const THAI_CHAR_CONFUSION_PAIRS: [string, string][] = [
  ["น", "ม"], ["ม", "น"],
  ["เ", "แ"], ["แ", "เ"],
  ["ใ", "ไ"], ["ไ", "ใ"],
  ["ก", "า"], ["า", "ก"],
  ["ว", "อ"], ["ด", "ต"],
  ["ร", "ย"], ["ย", "ร"],
]

function detectPatternType(
  fieldName: string,
  wrong:     string,
  correct:   string,
): "digit_swap" | "char_swap" | "vendor_alias" | "date_format" | "amount_format" | null {
  if (!wrong || !correct) return null
  if (wrong === correct)  return null

  // Amount fields — look for digit swaps
  const amountFields = new Set(["total_amount", "subtotal", "vat_amount", "discount_amount", "wht_amount", "delivery_fee"])
  if (amountFields.has(fieldName)) {
    // Check if amounts differ only in single digit substitution
    const wDigits  = wrong.replace(/[^0-9]/g, "")
    const cDigits  = correct.replace(/[^0-9]/g, "")
    if (wDigits.length === cDigits.length && wDigits.length > 0) {
      let diffCount = 0
      for (let i = 0; i < wDigits.length; i++) {
        if (wDigits[i] !== cDigits[i]) diffCount++
      }
      if (diffCount <= 2) return "digit_swap"
    }
    return "amount_format"
  }

  // Date fields
  if (fieldName === "doc_date" || fieldName === "due_date") {
    return "date_format"
  }

  // Vendor name — Thai char confusion or OCR alias
  if (fieldName === "vendor_name") {
    // Check if mostly same characters with Thai char swap
    const wrongClean   = wrong.replace(/\s+/g, "").toLowerCase()
    const correctClean = correct.replace(/\s+/g, "").toLowerCase()
    const longer       = Math.max(wrongClean.length, correctClean.length)
    if (longer === 0) return null

    // Levenshtein distance — if close → char_swap; if far → vendor_alias
    const dist = levenshtein(wrongClean, correctClean)
    return dist <= 3 ? "char_swap" : "vendor_alias"
  }

  // Text fields — Thai char detection
  const hasThai = /[฀-๿]/.test(wrong + correct)
  if (hasThai) return "char_swap"

  return "char_swap"
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

// ── Main miner function ───────────────────────────────────────────────────────

/**
 * Mine corrections for an org and upsert error patterns.
 * Safe to call multiple times — uses UPSERT with occurrence_count increment.
 * Designed to run in < 2 seconds for normal orgs.
 *
 * @param organizationId  Target org (null = mine global patterns across all orgs)
 * @param since           Only mine corrections newer than this date
 */

/** A correction only becomes a pattern once this many DISTINCT documents show it. */
const MIN_DISTINCT_DOCUMENTS = 2

/**
 * Groups corrections into candidate patterns and keeps only the significant ones.
 *
 * Pure, and separated out because the counting was quietly wrong in a way no
 * runtime error could reveal: `occurrence_count` incremented per correction
 * ROW while only `example_doc_ids` de-duplicated by document. Saving one
 * receipt's edits twice — fourteen seconds apart, which is exactly what
 * happened in production — pushed a one-off to a count of 4 and promoted it to
 * a standing rule injected into every future prompt. All six patterns in the
 * production table came from a single document.
 *
 * The count now means what its name says: how many different documents showed
 * this mistake.
 */
export function minePatterns(corrections: CorrectionRow[]): ErrorPattern[] {
  const patternMap = new Map<string, ErrorPattern>()

  for (const row of corrections) {
    const wrong   = (row.ai_value        ?? "").trim()
    const correct = (row.corrected_value ?? "").trim()
    if (!wrong || !correct || wrong === correct) continue

    const patternType = detectPatternType(row.field_name, wrong, correct)
    if (!patternType) continue

    const key = `${row.field_name}::${wrong}::${correct}`
    const existing = patternMap.get(key)
    if (existing) {
      if (!existing.example_doc_ids.includes(row.document_id)) {
        existing.example_doc_ids.push(row.document_id)
      }
    } else {
      patternMap.set(key, {
        field_name:       row.field_name,
        wrong_value:      wrong,
        correct_value:    correct,
        pattern_type:     patternType,
        occurrence_count: 0,
        example_doc_ids:  [row.document_id],
      })
    }
  }

  return Array.from(patternMap.values())
    .map(p => ({ ...p, occurrence_count: p.example_doc_ids.length }))
    .filter(p => p.example_doc_ids.length >= MIN_DISTINCT_DOCUMENTS)
}

export async function mineErrorPatterns(
  organizationId: string | null,
  since?: Date,
): Promise<{ mined: number; upserted: number }> {
  const supabase = createClient()

  // A null org means "global" to the reader (see the RLS policy in migration
  // 034) and cannot be de-duplicated by the upsert below, because Postgres
  // treats every NULL in a unique constraint as distinct. Mining is always
  // per-organisation; a global pattern is a deliberate act, not a side effect.
  if (!organizationId) {
    console.warn("[pattern-miner] refusing to mine without an organisation id")
    return { mined: 0, upserted: 0 }
  }

  // ── Fetch recent corrections ──────────────────────────────────────────────
  let query = supabase
    .from("receipt_corrections")
    .select("id, document_id, field_name, ai_value, corrected_value, vendor_name, doc_category")
    .not("ai_value", "is", null)
    .not("corrected_value", "is", null)
    // Newest first, so the 500-row cap keeps the most relevant corrections
    // rather than an arbitrary slice.
    .order("created_at", { ascending: false })
    .limit(500)

  if (organizationId) {
    query = query.eq("organization_id", organizationId)
  }
  if (since) {
    query = query.gte("created_at", since.toISOString())
  }

  const { data: corrections, error } = await query
  if (error || !corrections?.length) return { mined: 0, upserted: 0 }

  const significant = minePatterns(corrections as CorrectionRow[])

  if (!significant.length) return { mined: corrections.length, upserted: 0 }

  // ── Upsert into ocr_error_patterns ────────────────────────────────────────
  const rows = significant.map(p => ({
    organization_id:  organizationId,
    field_name:       p.field_name,
    wrong_value:      p.wrong_value,
    correct_value:    p.correct_value,
    pattern_type:     p.pattern_type,
    occurrence_count: p.occurrence_count,
    example_doc_ids:  p.example_doc_ids.slice(0, 5),
    last_mined_at:    new Date().toISOString(),
    is_active:        true,
  }))

  const { error: upsertErr } = await supabase
    .from("ocr_error_patterns")
    .upsert(rows, {
      onConflict:        "organization_id,field_name,wrong_value,correct_value",
      ignoreDuplicates:  false,
    })

  if (upsertErr) {
    console.error("[pattern-miner] upsert error:", upsertErr.message)
  }

  return { mined: corrections.length, upserted: rows.length }
}

/**
 * Fetch active error patterns for an org (for injection into prompt).
 * Returns top patterns sorted by occurrence_count descending.
 */
export async function fetchErrorPatterns(
  organizationId: string,
  limit = 15,
): Promise<ErrorPattern[]> {
  try {
    const supabase = createClient()

    // Fetch both org-specific and global patterns
    const { data } = await supabase
      .from("ocr_error_patterns")
      .select("field_name, wrong_value, correct_value, pattern_type, occurrence_count")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .eq("is_active", true)
      .gte("occurrence_count", 2)
      .order("occurrence_count", { ascending: false })
      .limit(limit)

    return (data ?? []) as ErrorPattern[]
  } catch {
    return []
  }
}

/**
 * Format error patterns into a prompt warning block.
 */
export function formatErrorPatternBlock(patterns: ErrorPattern[]): string {
  if (!patterns.length) return ""

  const byField = new Map<string, ErrorPattern[]>()
  for (const p of patterns) {
    const group = byField.get(p.field_name) ?? []
    group.push(p)
    byField.set(p.field_name, group)
  }

  const sections: string[] = []

  // Amounts are deliberately NOT fed back.
  //
  // A corrected amount says something true about ONE receipt and nothing about
  // any other. Production had mined three of them — subtotal 579.44→620,
  // vat 40.56→0, total 620→663.4 — which are not misreadings at all: a reviewer
  // had reconciled a VAT-inclusive receipt. Telling the model "620 was misread,
  // the correct value is 663.4" would make it rewrite an unrelated ฿620 receipt
  // to ฿663.4, turning a learning loop into a corruption loop. The damage would
  // be silent, and in the one place — money — where it is least acceptable.
  //
  // Text confusions are the opposite: ไฟแรงได้รุ่ง→ไฟแรงโต้รุ่ง is a property of
  // the glyphs, so it generalises to every future receipt from that shop.
  // Reconciliation is already handled by reconcileAmounts(), which reasons from
  // the arithmetic on the page rather than from remembered numbers.

  // Vendor name errors
  const vendorPatterns = byField.get("vendor_name") ?? []
  if (vendorPatterns.length) {
    const examples = vendorPatterns
      .slice(0, 5)
      .map(p => `"${p.wrong_value}" → should be "${p.correct_value}"`)
    sections.push(`Vendor names: ${examples.join("; ")}`)
  }

  // Date errors
  const datePatterns = [
    ...byField.get("doc_date") ?? [],
    ...byField.get("due_date") ?? [],
  ]
  if (datePatterns.length) {
    const examples = datePatterns
      .slice(0, 3)
      .map(p => `"${p.wrong_value}" → "${p.correct_value}"`)
    sections.push(`Dates: ${examples.join("; ")}`)
  }

  // Line item / menu name errors — Thai thermal-receipt OCR misreads
  const lineItemPatterns = byField.get("line_items.description") ?? []
  if (lineItemPatterns.length) {
    const examples = lineItemPatterns
      .slice(0, 10)
      .map(p => `"${p.wrong_value}" → should be "${p.correct_value}"`)
    sections.push(`Menu/item names: ${examples.join("; ")}`)
  }

  if (!sections.length) return ""

  return `## ⚠️ Known OCR errors for this organisation — you have made these mistakes before:\n` +
    sections.map(s => `  • ${s}`).join("\n") + "\n" +
    `  Double-check these fields especially carefully.\n\n`
}
