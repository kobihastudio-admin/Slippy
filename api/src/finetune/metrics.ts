/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Scoring — the piece whose absence made every previous change unmeasurable.
 *
 * Two metrics, because Thai receipts fail in two different ways and one number
 * hides that:
 *
 *   Amounts, tax ids, dates → EXACT match. ฿58 read as ฿59 is simply wrong;
 *   there is no partial credit for a total that is nearly right.
 *
 *   Vendor and item names → CHARACTER ERROR RATE. Exact match is the wrong bar
 *   for Thai: "ขนมปังเนยเยื่ม" for "ขนมปังเนยเยิ้ม" is one misplaced tone mark,
 *   and scoring it identically to "ก๋วยสลอมหมอง" (which shares almost nothing
 *   with the real name) throws away the signal that tells you whether a change
 *   helped. CER separates a near-miss from an invention.
 */

/** Levenshtein distance over Unicode code points. */
export function editDistance(a: string, b: string): number {
  // Code points, not UTF-16 units: `.length` would count a surrogate pair as
  // two edits and make emoji or rare glyphs score as double errors.
  const s = Array.from(a)
  const t = Array.from(b)
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length

  // Two rows rather than the full matrix — a long receipt against a long
  // reading is O(n·m) cells, and only the previous row is ever read.
  let prev = new Array<number>(t.length + 1)
  let curr = new Array<number>(t.length + 1)
  for (let j = 0; j <= t.length; j++) prev[j] = j

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    for (let j = 1; j <= t.length; j++) {
      const substitution = prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, substitution)
    }
    const swap = prev; prev = curr; curr = swap
  }
  return prev[t.length]
}

/**
 * Character error rate: edits ÷ length of the expected string, capped at 1.
 *
 * Both sides are NFC-normalised first. Thai composes the same visible word from
 * different code point sequences depending on the input method, and without
 * normalisation two identical-looking strings score as errors — a measurement
 * artefact that would read as a regression.
 *
 * Convention at the edges: two empty strings score 0 (nothing to get wrong);
 * an empty expectation against any output scores 1 (everything is invented).
 */
export function characterErrorRate(expected: string, actual: string): number {
  const e = (expected ?? "").normalize("NFC")
  const a = (actual   ?? "").normalize("NFC")
  if (e.length === 0) return a.length === 0 ? 0 : 1
  const chars = Array.from(e).length
  return Math.min(1, editDistance(e, a) / chars)
}

/** Amounts compare at satang precision — float noise is not an OCR error. */
export function amountsEqual(expected: number | null, actual: number | null): boolean {
  if (expected == null || actual == null) return expected === actual
  return Math.abs(expected - actual) < 0.005
}

export interface FieldScores {
  /** Exact-match rate per scalar field, over the examples where a ground truth exists. */
  vendor_tax_id: number
  doc_number:    number
  doc_date:      number
  subtotal:      number
  vat_amount:    number
  total_amount:  number
}

export interface EvalReport {
  examples: number
  /** Mean CER across vendor names. The headline Thai-legibility number. */
  vendor_name_cer: number
  /** Mean CER across matched line-item descriptions. */
  line_item_cer: number
  /** Share of examples where every line item was matched 1:1 with the truth. */
  line_item_count_match: number
  fields: FieldScores
  /** Every field correct AND every item name exact. The bar a document must clear to need no review. */
  perfect_documents: number
}

interface Scored {
  vendor_name:   string | null
  vendor_tax_id: string | null
  doc_number:    string | null
  doc_date:      string | null
  subtotal:      number | null
  vat_amount:    number | null
  total_amount:  number | null
  line_items:    Array<{ description: string; amount: number }>
}

/**
 * Scores predictions against ground truth, pairwise by index.
 *
 * Line items are compared in printed order rather than matched greedily by
 * similarity: order is information on a receipt, and a greedy matcher would
 * quietly forgive a model that returned the right names in the wrong places.
 */
export function scoreAll(pairs: Array<{ truth: Scored; predicted: Scored }>): EvalReport {
  if (pairs.length === 0) {
    return {
      examples: 0, vendor_name_cer: 0, line_item_cer: 0, line_item_count_match: 0,
      fields: {
        vendor_tax_id: 0, doc_number: 0, doc_date: 0,
        subtotal: 0, vat_amount: 0, total_amount: 0,
      },
      perfect_documents: 0,
    }
  }

  const vendorCers: number[] = []
  const itemCers:   number[] = []
  let countMatches = 0
  let perfect = 0

  // Denominators are per-field: a field the receipt never had is not a field the
  // model got wrong, so it is excluded rather than counted as a miss.
  const hit:   Record<keyof FieldScores, number> = {
    vendor_tax_id: 0, doc_number: 0, doc_date: 0, subtotal: 0, vat_amount: 0, total_amount: 0,
  }
  const total: Record<keyof FieldScores, number> = { ...hit }

  const stringFields = ["vendor_tax_id", "doc_number", "doc_date"] as const
  const numberFields = ["subtotal", "vat_amount", "total_amount"] as const

  for (const { truth, predicted } of pairs) {
    let allCorrect = true

    if (truth.vendor_name != null) {
      const cer = characterErrorRate(truth.vendor_name, predicted.vendor_name ?? "")
      vendorCers.push(cer)
      if (cer > 0) allCorrect = false
    }

    for (const f of stringFields) {
      if (truth[f] == null) continue
      total[f]++
      if ((truth[f] ?? "").trim() === (predicted[f] ?? "").trim()) hit[f]++
      else allCorrect = false
    }
    for (const f of numberFields) {
      if (truth[f] == null) continue
      total[f]++
      if (amountsEqual(truth[f], predicted[f])) hit[f]++
      else allCorrect = false
    }

    const sameCount = truth.line_items.length === predicted.line_items.length
    if (sameCount) countMatches++
    else allCorrect = false

    const pairCount = Math.min(truth.line_items.length, predicted.line_items.length)
    for (let i = 0; i < pairCount; i++) {
      const cer = characterErrorRate(truth.line_items[i].description, predicted.line_items[i].description)
      itemCers.push(cer)
      if (cer > 0) allCorrect = false
      if (!amountsEqual(truth.line_items[i].amount, predicted.line_items[i].amount)) allCorrect = false
    }
    // Items the model never produced are total misses, not absent comparisons.
    for (let i = pairCount; i < truth.line_items.length; i++) itemCers.push(1)

    if (allCorrect) perfect++
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const rate = (f: keyof FieldScores) => (total[f] ? hit[f] / total[f] : 0)

  return {
    examples: pairs.length,
    vendor_name_cer: mean(vendorCers),
    line_item_cer:   mean(itemCers),
    line_item_count_match: countMatches / pairs.length,
    fields: {
      vendor_tax_id: rate("vendor_tax_id"),
      doc_number:    rate("doc_number"),
      doc_date:      rate("doc_date"),
      subtotal:      rate("subtotal"),
      vat_amount:    rate("vat_amount"),
      total_amount:  rate("total_amount"),
    },
    perfect_documents: perfect / pairs.length,
  }
}
