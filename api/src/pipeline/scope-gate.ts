/**
 * Decides whether what we just read is a financial document at all.
 *
 * Slippy accepts bills, receipts, slips, invoices and credit notes — nothing
 * else. Without a gate, a selfie or a screenshot walks the whole pipeline:
 * sliced, sent to the model, paid for in full, and only then classified as
 * `other`. It also consumes one of the user's monthly documents, which is the
 * part that turns a mistaken photo into a complaint.
 *
 * The check runs AFTER extraction because there is no cheaper way to know — the
 * cost is already spent by then. What the gate saves is the quota slot, the
 * storage, and the confusion of a junk row sitting in someone's accounts. It
 * also produces the signal that makes repeated junk uploads visible.
 */

/** The categories the product exists to handle. Single source of truth. */
export const FINANCIAL_CATEGORIES = [
  "tax_invoice_full",
  "tax_invoice_simplified",
  "receipt_with_tax",
  "receipt",
  "consumer_receipt",
  "invoice",
  "credit_note",
] as const

export type FinancialCategory = typeof FINANCIAL_CATEGORIES[number]

export interface ScopeCandidate {
  doc_category?: string | null
  total_amount?: number | null
  subtotal?:     number | null
  line_items?:   Array<unknown> | null
  vendor_name?:  string | null
}

export interface ScopeVerdict {
  accepted: boolean
  /** Thai, user-facing. Says what we accept, not merely that this failed. */
  reason?:  string
}

/**
 * Financial documents are recognised by evidence, not by the label alone.
 *
 * A receipt the classifier could not name is still a receipt if it carries a
 * total or itemised lines, and rejecting it would throw away a real document
 * over a labelling miss. What has none of those AND no recognised category is
 * not something this product can do anything useful with.
 *
 * The bar is deliberately generous: a wrongly rejected receipt is a far worse
 * outcome than a junk row that reaches review, because the user has already
 * taken the photo and believes the work is done.
 */
export function checkDocumentScope(doc: ScopeCandidate | null | undefined): ScopeVerdict {
  if (!doc) {
    return { accepted: false, reason: rejectionMessage() }
  }

  const category = String(doc.doc_category ?? "").trim()
  if ((FINANCIAL_CATEGORIES as readonly string[]).includes(category)) {
    return { accepted: true }
  }

  const hasMoney = Number(doc.total_amount) > 0 || Number(doc.subtotal) > 0
  const hasItems = Array.isArray(doc.line_items) && doc.line_items.length > 0
  if (hasMoney || hasItems) return { accepted: true }

  return { accepted: false, reason: rejectionMessage() }
}

function rejectionMessage(): string {
  return (
    "ไฟล์นี้ไม่ใช่เอกสารทางการเงิน จึงไม่ได้บันทึกเข้าระบบ และ" +
    "ไม่ถูกหักโควตาเอกสารของคุณ — ระบบรองรับใบเสร็จ ใบกำกับภาษี ใบแจ้งหนี้ " +
    "สลิปโอนเงิน และใบลดหนี้ ถ้าคิดว่าไฟล์นี้ควรอ่านได้ ลองถ่ายใหม่ให้เห็นยอดเงิน" +
    "และรายการให้ชัดขึ้น"
  )
}
