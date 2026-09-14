/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * On-device OCR hint — the iOS app runs Apple's Vision framework locally
 * (`SlipOCRService.swift`) before a photo ever reaches the server, purely to
 * pre-fill the review screen instantly. That result used to be discarded
 * once the server's AI pipeline ran. This module lets it be reused two ways:
 *   1. Injected into the AI extraction prompt as a second, independent OCR
 *      reading (same pattern the pipeline already uses for the Google
 *      Document AI fallback pass) — most useful on blurry/skewed photos
 *      where the AI vision model and on-device OCR can cross-check each other.
 *   2. Compared against the final AI result in the validator — if the two
 *      independently-produced readings disagree on vendor name or total
 *      amount, that's a real signal worth flagging for human review, even
 *      though the on-device parser alone is much less reliable than the
 *      cloud AI (it's a hand-written regex/keyword parser, not a model).
 */

export interface LocalOcrHint {
  /** Raw text lines Apple Vision recognized, top-to-bottom (capped client-side). */
  rawText?:     string | null
  vendorName?:  string | null
  totalAmount?: number | null
  docDate?:     string | null   // ISO yyyy-MM-dd
  docNumber?:   string | null
  /** 0–1 heuristic confidence from the on-device parser. */
  confidence?:  number | null
  /** e.g. "ios_vision" — which client/engine produced this. */
  source?:      string | null
}

/**
 * Fields the user explicitly reviewed and saved before upload (iOS
 * CameraPickerView → OCRFullDetailView "บันทึก"), distinct from
 * `LocalOcrHint` above: a hint is just a second OCR reading the AI can
 * cross-check against, while these are the user's actual confirmed values.
 * Previously there was no way to express "the user already fixed this" —
 * the pipeline's own extraction always won, silently discarding any
 * pre-upload edit the moment processing finished. See runPipeline's merge
 * in pipeline/index.ts.
 */
export interface UserConfirmedFields {
  vendor_name?:      string | null
  vendor_tax_id?:    string | null   // authoritative when read from a Bill-Payment QR
  doc_type?:         string | null
  doc_number?:       string | null
  doc_date?:         string | null
  subtotal?:         number | null
  vat_amount?:       number | null
  wht_amount?:       number | null
  total_amount?:     number | null
  payment_method?:   string | null
  expense_category?: string | null
}

const MAX_RAW_TEXT_CHARS = 3000

/**
 * Formats the hint into the same kind of "### <source> OCR" block the
 * extractor already builds for Haiku/Google DocAI passes — see
 * `buildOcrSection` in extractor.ts, which wraps whatever this returns.
 */
export function formatLocalOcrHintText(hint: LocalOcrHint | null | undefined): string {
  if (!hint) return ""
  const fields: string[] = []
  if (hint.vendorName)  fields.push(`ชื่อร้าน/ผู้ขาย: ${hint.vendorName}`)
  if (hint.totalAmount != null) fields.push(`ยอดรวม: ${hint.totalAmount}`)
  if (hint.docDate)     fields.push(`วันที่: ${hint.docDate}`)
  if (hint.docNumber)   fields.push(`เลขที่เอกสาร: ${hint.docNumber}`)

  const rawText = (hint.rawText ?? "").slice(0, MAX_RAW_TEXT_CHARS)
  if (!fields.length && !rawText.trim()) return ""

  const fieldBlock = fields.length ? fields.join("\n") + "\n\n" : ""
  return `${fieldBlock}ข้อความดิบที่อ่านได้ (เรียงบนลงล่าง):\n${rawText}`
}

/** Simple normalization for fuzzy vendor-name comparison — strips spacing/punctuation noise. */
function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[\s.,()ๆ-]/g, "")
}

export interface ClientOcrDiscrepancy {
  field:    "vendor_name" | "total_amount"
  message:  string
}

/**
 * Cross-checks the AI's final extraction against the on-device hint.
 * Deliberately conservative — the on-device parser is a regex/keyword
 * heuristic, not a model, so this only flags clear disagreements rather
 * than minor formatting differences, to avoid drowning real warnings in
 * false positives from a weaker secondary source.
 */
export function compareWithLocalOcr(
  extracted: { vendor_name?: string | null; total_amount?: number | null },
  hint:      LocalOcrHint | null | undefined,
): ClientOcrDiscrepancy[] {
  if (!hint) return []
  const out: ClientOcrDiscrepancy[] = []

  if (hint.vendorName?.trim() && extracted.vendor_name?.trim()) {
    const a = normalizeForCompare(hint.vendorName)
    const b = normalizeForCompare(extracted.vendor_name)
    if (a.length >= 2 && b.length >= 2 && !a.includes(b) && !b.includes(a)) {
      out.push({
        field:   "vendor_name",
        message: `ชื่อร้านไม่ตรงกับที่อ่านได้บนเครื่อง — เซิร์ฟเวอร์: "${extracted.vendor_name}", บนเครื่อง: "${hint.vendorName}"`,
      })
    }
  }

  if (hint.totalAmount != null && hint.totalAmount > 0 && extracted.total_amount != null && extracted.total_amount > 0) {
    const diff = Math.abs(hint.totalAmount - extracted.total_amount)
    const relTolerance = Math.max(1, extracted.total_amount * 0.02) // 2%, min ฿1
    if (diff > relTolerance) {
      out.push({
        field:   "total_amount",
        message: `ยอดรวมไม่ตรงกับที่อ่านได้บนเครื่อง — เซิร์ฟเวอร์: ${extracted.total_amount}, บนเครื่อง: ${hint.totalAmount}`,
      })
    }
  }

  return out
}
