import { createClient } from "../lib/supabase"
import type { ExtractedDocument } from "./extractor"
import { amountBase, vatModel, lineItemSumCheck, VAT_RATE } from "./amounts"
import { compareWithLocalOcr, type LocalOcrHint } from "./local-ocr-hint"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */


// Categories where strict tax-invoice checks are relaxed
const CONSUMER_CATEGORIES = new Set([
  "consumer_receipt",
  "receipt",
  "tax_invoice_simplified",
])

export interface ValidationResult {
  is_valid:         boolean
  confidence_score: number
  warnings:         ValidationWarning[]
  is_duplicate:     boolean
  duplicate_doc_id?: string
  machine_verification_status: MachineVerificationStatus
  reconciliation: ReconciliationSummary
}

export type MachineVerificationStatus = "unverified" | "needs_review" | "verified"
export type ReconciliationStatus = "not_checked" | "balanced" | "mismatch"

export interface ReconciliationCheck {
  checked: boolean
  balanced: boolean | null
  expected?: number
  actual?: number
  difference?: number
}

export interface ReconciliationSummary {
  status: ReconciliationStatus
  total: ReconciliationCheck
  line_items: ReconciliationCheck
}

const roundMoney = (value: number) => Math.round(value * 100) / 100


/**
 * Whether the document's VAT figure matches either convention on the correct
 * base. Thin wrapper over ./amounts so the validator and the reconciler can
 * never again disagree about what the base is — which they did, and it flagged
 * a correct ฿1,039 bill as TOTAL_MISMATCH.
 */
export interface VatCheck { ok: boolean; base: number; exclusive: number; inclusive: number }

export function checkVat(d: {
  subtotal: number; vat_amount: number; delivery_fee?: number; discount_amount?: number
}): VatCheck {
  // Floor of 1 baht, as this check has always used. The core defaults to 0.50
  // for the reconciler; taking that default here silently doubled the strictness
  // on every receipt under ฿1,000 — a behaviour change smuggled in by a refactor
  // that was supposed to preserve behaviour, and no test would have caught it.
  const m = vatModel(d, 0.001 / VAT_RATE, 1)
  return { ok: m.convention !== "unresolved", base: m.base, exclusive: m.exclusive, inclusive: m.inclusive }
}

export { amountBase }


export function classifyMachineVerification(
  isValid: boolean,
  confidenceScore: number,
  reconciliation: ReconciliationSummary,
  warnings: ValidationWarning[],
): MachineVerificationStatus {
  if (!isValid || confidenceScore < 0.4) return "unverified"
  const blockers = new Set(["DUPLICATE", "ZERO_TOTAL", "TOTAL_MISMATCH", "LINE_ITEM_SUM_MISMATCH"])
  if (confidenceScore >= 0.85 && reconciliation.status === "balanced" &&
      !warnings.some(w => blockers.has(w.code))) return "verified"
  return "needs_review"
}

export interface ValidationWarning {
  code:    string
  message: string
  field?:  string
}

/**
 * Validate extracted document data.
 *
 * Rules are tiered by document category:
 *  • tax_invoice_full / receipt_with_tax / credit_note  → full strict checks
 *  • tax_invoice_simplified / receipt / consumer_receipt → relaxed (no doc_number,
 *    no VAT math, no tax-ID check)
 *  • invoice / other → basic checks only
 */
export async function validateDocument(
  extracted:       ExtractedDocument,
  organizationId:  string,
  excludeDocId?:   string,
  localOcrHint?:   LocalOcrHint | null,
): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = []
  let score = extracted.confidence_score

  const isConsumer = CONSUMER_CATEGORIES.has(extracted.doc_category)
  const isTaxInvoiceFull = extracted.doc_category === "tax_invoice_full" ||
                           extracted.doc_category === "receipt_with_tax"

  // ── 1. Required field checks ─────────────────────────────────────────────────
  if (!extracted.vendor_name?.trim()) {
    warnings.push({ code: "MISSING_VENDOR", message: "ไม่พบชื่อผู้ขาย/ผู้ให้บริการ", field: "vendor_name" })
    score = Math.max(0, score - 0.2)
  }

  // doc_number: required only for full tax invoices
  if (isTaxInvoiceFull && !extracted.doc_number?.trim()) {
    warnings.push({ code: "MISSING_DOC_NUM", message: "ไม่พบเลขที่ใบกำกับภาษี", field: "doc_number" })
    score = Math.max(0, score - 0.1)
  }

  if (!extracted.doc_date) {
    warnings.push({ code: "MISSING_DATE", message: "ไม่พบวันที่เอกสาร", field: "doc_date" })
    score = Math.max(0, score - 0.1)
  }

  if (extracted.total_amount <= 0) {
    warnings.push({ code: "ZERO_TOTAL", message: "ยอดรวมเป็น 0 หรือไม่ถูกต้อง", field: "total_amount" })
    score = Math.max(0, score - 0.25)
  }

  // ── 2. VAT math — only for full tax invoices that show VAT explicitly ────────
  if (isTaxInvoiceFull && extracted.vat_amount > 0 && extracted.subtotal > 0) {
    const vat = checkVat(extracted)
    if (!vat.ok) {
      warnings.push({
        code:    "VAT_MISMATCH",
        message: `VAT ไม่ตรงกับ 7% ของฐาน ${vat.base.toFixed(2)} ` +
                 `(VAT-excluded ${vat.exclusive.toFixed(2)} / VAT-included ${vat.inclusive.toFixed(2)}, ` +
                 `ได้ ${extracted.vat_amount.toFixed(2)})`,
        field:   "vat_amount",
      })
      score = Math.max(0, score - 0.1)
    }
  }

  // ── 3. Total consistency ─────────────────────────────────────────────────────
  // Accept EITHER VAT model: exclusive (total = subtotal + VAT − WHT) or inclusive
  // ("VAT Included" — total = subtotal − WHT, VAT already inside subtotal). Runs
  // for consumer receipts too, but with a looser bar so ordinary discounts/fees
  // don't false-flag — while a gross misread (e.g. 523 on a ฿420 receipt) still
  // trips it instead of sailing through at 100% confidence.
  // null = couldn't be checked (no subtotal), true/false = checked result.
  let mathConsistent: boolean | null = null
  let totalExpected: number | undefined

  if (extracted.subtotal > 0 && extracted.total_amount > 0) {
    // The base is subtotal PLUS fees MINUS discount — the same model
    // reconcileAmounts uses. Omitting them flagged a correct ฿1,039 CoCo bill
    // (service charge ฿94) as TOTAL_MISMATCH the moment the extractor started
    // reading service charges properly: the reconciler had been taught the
    // full formula and this check had not, so fixing one surfaced the other.
    const base              = amountBase(extracted)
    const expectedExclusive = base + extracted.vat_amount - extracted.wht_amount
    const expectedInclusive = base - extracted.wht_amount
    const relTol = isConsumer ? 0.15 : 0.005
    const tolExc = Math.max(isConsumer ? 5 : 1, expectedExclusive * relTol)
    const tolInc = Math.max(isConsumer ? 5 : 1, expectedInclusive * relTol)

    mathConsistent = !(Math.abs(extracted.total_amount - expectedExclusive) > tolExc &&
                       Math.abs(extracted.total_amount - expectedInclusive) > tolInc)
    totalExpected = Math.abs(extracted.total_amount - expectedExclusive) <=
      Math.abs(extracted.total_amount - expectedInclusive) ? expectedExclusive : expectedInclusive

    if (!mathConsistent) {
      warnings.push({
        code:    "TOTAL_MISMATCH",
        message: `ยอดรวมไม่ตรงกัน: subtotal+VAT = ${expectedExclusive.toFixed(2)} หรือ VAT-included = ${expectedInclusive.toFixed(2)}, แต่ยอดที่อ่านได้ ${extracted.total_amount.toFixed(2)}`,
        field:   "total_amount",
      })
      score = Math.max(0, score - (isConsumer ? 0.2 : 0.15))
    }
  }

  // ── 3b. Line-item sum consistency ────────────────────────────────────────────
  // TOTAL_MISMATCH above catches subtotal+VAT-WHT vs total disagreeing, but
  // says nothing about whether the individual line_items actually add up to
  // that subtotal — a receipt can pass that check while its line items were
  // split/categorized wrong (e.g. a combo meal read as two separate items at
  // the wrong prices) as long as the top-level totals happen to still read
  // correctly. This catches that case directly.
  //
  // Shares `lineItemSumMismatch` with the extractor rather than re-deriving it.
  // This used to be its own one-line comparison against `subtotal`, which knew
  // nothing about the discount and VAT-inclusive conventions the extractor had
  // already learned — so a KOFUKU or 7-Eleven receipt that the routing logic
  // correctly considered fine still told the user its items didn't add up.
  let lineItemsConsistent: boolean | null = null
  let lineItemSum: number | undefined
  let lineItemExpected: number | undefined
  const sumCheck = lineItemSumCheck(extracted)
  if (sumCheck) {
    lineItemSum         = sumCheck.sum
    lineItemExpected    = sumCheck.expected
    lineItemsConsistent = !sumCheck.mismatch

    if (!lineItemsConsistent) {
      warnings.push({
        code:    "LINE_ITEM_SUM_MISMATCH",
        message: `รายการสินค้ารวมกันได้ ${lineItemSum.toFixed(2)} แต่ควรได้ ${lineItemExpected.toFixed(2)} — ตรวจสอบรายการสินค้าอีกครั้ง`,
        field:   "line_items",
      })
      score = Math.max(0, score - 0.15)
    }
  }

  // ── 4. Date sanity ───────────────────────────────────────────────────────────
  if (extracted.doc_date) {
    const docDate     = new Date(extracted.doc_date)
    const now         = new Date()
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())

    if (isNaN(docDate.getTime())) {
      warnings.push({ code: "INVALID_DATE", message: "รูปแบบวันที่ไม่ถูกต้อง", field: "doc_date" })
      score = Math.max(0, score - 0.1)
    } else if (docDate > now) {
      warnings.push({ code: "FUTURE_DATE", message: "วันที่เอกสารอยู่ในอนาคต", field: "doc_date" })
      score = Math.max(0, score - 0.05)
    } else if (docDate < twoYearsAgo) {
      warnings.push({ code: "OLD_DATE", message: "วันที่เอกสารเก่ากว่า 2 ปี", field: "doc_date" })
    }
  }

  // ── 5. Duplicate detection ───────────────────────────────────────────────────
  let is_duplicate    = false
  let duplicate_doc_id: string | undefined

  const supabase = createClient()

  // 5a. Platform ref check — highest confidence, unique per org
  if (extracted.platform_ref?.trim()) {
    const { data: refMatch } = await supabase
      .from("documents")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("platform_ref",    extracted.platform_ref.trim())
      .in("status",          ["reviewing", "approved", "pushed"])
      .neq("id",             excludeDocId ?? "00000000-0000-0000-0000-000000000000")
      .limit(1)

    if (refMatch && refMatch.length > 0) {
      is_duplicate     = true
      duplicate_doc_id = refMatch[0].id
      warnings.push({ code: "DUPLICATE", message: `พบเอกสารซ้ำ — Delivery ref ซ้ำกัน (id: ${refMatch[0].id})` })
      score = Math.max(0, score - 0.3)
    }
  }

  // 5b. Doc number standalone check — highest-confidence for receipts/invoices
  // เลขที่ใบเสร็จซ้ำ = ซ้ำแน่ๆ (ไม่ต้องรอเทียบ vendor/amount)
  if (!is_duplicate && extracted.doc_number?.trim()) {
    let docNumQuery = supabase
      .from("documents")
      .select("id, vendor_name, doc_number")
      .eq("organization_id", organizationId)
      .eq("doc_number",       extracted.doc_number.trim())
      .in("status",           ["reviewing", "approved", "pushed"])
      .limit(1)

    if (excludeDocId) {
      docNumQuery = docNumQuery.neq("id", excludeDocId)
    }

    const { data: docNumMatch } = await docNumQuery
    if (docNumMatch && docNumMatch.length > 0) {
      is_duplicate     = true
      duplicate_doc_id = docNumMatch[0].id
      warnings.push({
        code:    "DUPLICATE",
        message: `พบเอกสารซ้ำ — เลขที่ใบเสร็จ "${extracted.doc_number}" ซ้ำกับเอกสาร id: ${docNumMatch[0].id}`,
      })
      score = Math.max(0, score - 0.3)
    }
  }

  // 5c. Fallback: vendor + amount (when no doc_number or doc_number not matched)
  if (!is_duplicate && extracted.vendor_name && extracted.total_amount > 0) {
    let query = supabase
      .from("documents")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("vendor_name",  extracted.vendor_name.trim())
      .eq("total_amount",    extracted.total_amount)
      .in("status",          ["reviewing", "approved", "pushed"])
      .limit(1)

    if (excludeDocId) {
      query = query.neq("id", excludeDocId)
    }

    const { data } = await query
    if (data && data.length > 0) {
      is_duplicate      = true
      duplicate_doc_id  = data[0].id
      warnings.push({ code: "DUPLICATE", message: `พบเอกสารซ้ำ — vendor + ยอดซ้ำ (id: ${data[0].id})` })
      score = Math.max(0, score - 0.3)
    }
  }

  // ── 6. Tax ID format — only for full tax invoices ────────────────────────────
  if (isTaxInvoiceFull && extracted.vendor_tax_id) {
    const taxId = extracted.vendor_tax_id.replace(/[-\s]/g, "")
    if (!/^\d{13}$/.test(taxId)) {
      warnings.push({
        code:    "INVALID_TAX_ID",
        message: "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องมี 13 หลัก)",
        field:   "vendor_tax_id",
      })
      score = Math.max(0, score - 0.05)
    }
  }

  // ── 7. Consumer-receipt specific: note if no VAT claimed ────────────────────
  if (isConsumer && !extracted.vat_claimable) {
    // Not a warning — just informational — don't deduct score
    // (already captured in business_use_note on the extracted document)
  }

  // ── 8. On-device OCR cross-check (iOS Vision pre-read, see local-ocr-hint.ts) ─
  // The on-device parser is far weaker than the cloud AI (regex/keywords, no
  // model), so a disagreement here is treated as a softer signal than the
  // internal math checks above — small score deduction, but always surfaced
  // so the reviewer sees exactly which value each source produced.
  for (const d of compareWithLocalOcr(extracted, localOcrHint)) {
    warnings.push({ code: "CLIENT_OCR_MISMATCH", message: d.message, field: d.field })
    score = Math.max(0, score - (d.field === "total_amount" ? 0.1 : 0.05))
  }

  // ── 9. Corroboration ceiling — confidence must be EARNED, not self-reported ──
  // `score` starts life as extracted.confidence_score, i.e. the model grading its
  // own homework — it happily returned 1.0 on a receipt whose total it misread
  // (฿420 read as 523). A number is only trustworthy when an *independent*
  // source agrees, so the self-report is capped by how much corroboration we
  // actually have. Agreement raises the ceiling; absence or conflict lowers it.
  let ceiling = 1.0

  const hintTotal = localOcrHint?.totalAmount
  const hasHintTotal = hintTotal != null && hintTotal > 0
  const hasExtTotal  = extracted.total_amount > 0

  if (hasHintTotal && hasExtTotal) {
    const agrees = Math.abs(hintTotal - extracted.total_amount)
      <= Math.max(1, extracted.total_amount * 0.02)
    // Two independent readings disagreeing on the key number is the strongest
    // negative signal we have — cap hard so it can never auto-approve.
    if (!agrees) ceiling = Math.min(ceiling, 0.50)
  } else {
    // Only one source ever saw this number — genuine uncertainty, not 100%.
    ceiling = Math.min(ceiling, 0.80)
  }

  if (mathConsistent === false)     ceiling = Math.min(ceiling, 0.70)
  else if (mathConsistent === null) ceiling = Math.min(ceiling, 0.90)

  const finalScore = Math.min(1, Math.max(0, Math.min(score, ceiling)))
  const is_valid   = finalScore >= 0.4 && !warnings.some(w => w.code === "ZERO_TOTAL")
  const checked = [mathConsistent, lineItemsConsistent].filter(v => v !== null)
  const reconciliationStatus: ReconciliationStatus = checked.length === 0
    ? "not_checked"
    : checked.some(v => v === false) ? "mismatch" : "balanced"
  const reconciliation: ReconciliationSummary = {
    status: reconciliationStatus,
    total: {
      checked: mathConsistent !== null,
      balanced: mathConsistent,
      ...(totalExpected != null ? {
        expected: roundMoney(totalExpected), actual: roundMoney(extracted.total_amount),
        difference: roundMoney(extracted.total_amount - totalExpected),
      } : {}),
    },
    line_items: {
      checked: lineItemsConsistent !== null,
      balanced: lineItemsConsistent,
      ...(lineItemSum != null && lineItemExpected != null ? {
        expected: roundMoney(lineItemExpected), actual: roundMoney(lineItemSum),
        difference: roundMoney(lineItemSum - lineItemExpected),
      } : {}),
    },
  }

  return {
    is_valid,
    confidence_score: finalScore,
    warnings,
    is_duplicate,
    duplicate_doc_id,
    machine_verification_status: classifyMachineVerification(is_valid, finalScore, reconciliation, warnings),
    reconciliation,
  }
}

/**
 * Auto-approve threshold.
 * Consumer/simplified receipts have a slightly lower bar (0.80) since they
 * naturally lack some fields required of full tax invoices.
 */
// Auto-approve thresholds — set to 1.0 to disable (require human review for all docs)
// Set back to 0.85 / 0.80 when ready to enable auto-approval
export const AUTO_APPROVE_THRESHOLD         = 1.0   // disabled — always require review
export const AUTO_APPROVE_THRESHOLD_RECEIPT = 1.0   // disabled — always require review

export function shouldAutoApprove(
  result:   ValidationResult,
  category?: string,
): boolean {
  const blockingCodes = new Set(["DUPLICATE", "ZERO_TOTAL", "TOTAL_MISMATCH", "LINE_ITEM_SUM_MISMATCH"])
  const hasBlocker    = result.warnings.some(w => blockingCodes.has(w.code))
  if (hasBlocker) return false

  const isConsumer = category &&
    ["consumer_receipt", "receipt", "tax_invoice_simplified"].includes(category)

  const threshold = isConsumer
    ? AUTO_APPROVE_THRESHOLD_RECEIPT
    : AUTO_APPROVE_THRESHOLD

  return result.confidence_score >= threshold
}
