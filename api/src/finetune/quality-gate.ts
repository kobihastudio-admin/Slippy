/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Admission rules for the corpus.
 *
 * A training set is not "every document we have". Each of these rejections
 * corresponds to a document that would actively teach the wrong thing:
 *
 *   - A capture too small to read teaches the model to invent Thai, because
 *     the target says a word the pixels never contained. This is the same
 *     floor the pipeline now enforces at ingest (image-quality.ts) — the two
 *     must agree, or the corpus fills with exactly the documents that
 *     motivated the floor.
 *   - A document whose own arithmetic contradicts itself teaches broken
 *     arithmetic, whichever side of the contradiction the target took.
 *   - A non-financial document is out of scope for the product and out of
 *     scope for the corpus.
 *   - A duplicate silently reweights whatever it duplicates; with 60 documents
 *     total, one receipt scanned twice is 3% of the corpus arguing with itself.
 *
 * Every rule is a rejection with a named reason rather than a silent filter, so
 * a shrinking dataset is explainable instead of mysterious.
 */
import { isResolutionTooLow } from "../pipeline/image-quality"
import { lineItemSumCheck } from "../pipeline/amounts"

export type RejectionReason =
  | "low_resolution"
  | "not_financial"
  | "unverified"
  | "no_verified_fields"
  | "amounts_unreconciled"
  | "line_items_unreconciled"
  | "duplicate"

export interface Candidate {
  id: string
  status: string
  verified_by: string | null
  source_width:  number
  source_height: number
  vendor_name:   string | null
  vendor_tax_id: string | null
  doc_number:    string | null
  doc_date:      string | null
  subtotal:      number | null
  vat_amount:    number | null
  total_amount:  number | null
  line_items: Array<{ description: string; amount: number }>
}

export interface Verdict {
  admitted: boolean
  reasons: RejectionReason[]
}

/** Satang-level slack: a thermal printer's rounding is not a contradiction. */
const AMOUNT_TOLERANCE = 0.02

/**
 * Judges one candidate. `seenHashes` is mutated as duplicates are detected, so
 * callers pass one set across the whole build.
 */
export function admit(candidate: Candidate, seenHashes: Set<string>): Verdict {
  const reasons: RejectionReason[] = []

  // ── Provenance ────────────────────────────────────────────────────────────
  if (!candidate.verified_by?.trim()) reasons.push("unverified")
  if (candidate.status === "rejected") reasons.push("not_financial")

  // ── The capture itself ────────────────────────────────────────────────────
  // Shares the pipeline's floor rather than defining its own. If these two ever
  // disagree, the corpus is training on captures the product refuses to trust.
  if (isResolutionTooLow(candidate.source_width, candidate.source_height)) {
    reasons.push("low_resolution")
  }

  // ── Is there anything to learn from? ──────────────────────────────────────
  const hasAnyField =
    candidate.vendor_name != null || candidate.total_amount != null ||
    candidate.doc_number  != null || candidate.line_items.length > 0
  if (!hasAnyField) reasons.push("no_verified_fields")

  // ── Internal arithmetic ───────────────────────────────────────────────────
  // Accepts both VAT conventions, exactly as the pipeline's validator does: a
  // VAT-inclusive receipt has total == subtotal, an exclusive one has
  // total == subtotal + VAT. Rejecting either would throw away correct
  // documents; accepting neither is the actual contradiction.
  const { subtotal, vat_amount, total_amount } = candidate
  if (subtotal != null && total_amount != null) {
    const vat = vat_amount ?? 0
    const exclusive = Math.abs(total_amount - (subtotal + vat))
    const inclusive = Math.abs(total_amount - subtotal)
    if (Math.min(exclusive, inclusive) > AMOUNT_TOLERANCE) {
      reasons.push("amounts_unreconciled")
    }
  }

  // Line items get the same treatment via the pipeline's own three-convention
  // check (gross / net-of-discount / VAT-inclusive), so the corpus and the
  // extractor cannot drift into disagreeing about what "adds up" means.
  if (candidate.line_items.length > 0 && subtotal != null) {
    const check = lineItemSumCheck({
      subtotal,
      vat_amount: vat_amount ?? 0,
      line_items: candidate.line_items as never,
    })
    if (check?.mismatch) reasons.push("line_items_unreconciled")
  }

  // ── Duplicates ────────────────────────────────────────────────────────────
  const hash = contentHash(candidate)
  if (seenHashes.has(hash)) reasons.push("duplicate")
  else if (reasons.length === 0) seenHashes.add(hash)

  return { admitted: reasons.length === 0, reasons }
}

/**
 * Identity of a receipt's CONTENT, not of its row.
 *
 * Keyed on the printed facts — vendor, document number, date, total — because
 * the same receipt uploaded twice is two document ids and one receipt. Line
 * items are deliberately excluded: two scans of one receipt often differ by an
 * item the OCR dropped, and a hash that changes when the reading changes would
 * fail to spot exactly the duplicate pair worth spotting.
 */
export function contentHash(c: Candidate): string {
  return [
    (c.vendor_tax_id ?? "").replace(/\D/g, ""),
    (c.vendor_name ?? "").trim().toLowerCase(),
    (c.doc_number ?? "").trim().toLowerCase(),
    c.doc_date ?? "",
    c.total_amount ?? "",
  ].join("|")
}

/** Rejection tallies, so a build reports why the corpus is the size it is. */
export function summarise(verdicts: Verdict[]): Record<RejectionReason | "admitted", number> {
  const counts = {
    admitted: 0, low_resolution: 0, not_financial: 0, unverified: 0,
    no_verified_fields: 0, amounts_unreconciled: 0, line_items_unreconciled: 0, duplicate: 0,
  }
  for (const v of verdicts) {
    if (v.admitted) counts.admitted++
    for (const r of v.reasons) counts[r]++
  }
  return counts
}
