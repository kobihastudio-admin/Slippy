import { createClient }        from "../../lib/supabase"
import { decrypt }             from "../../lib/crypto"
import { FlowAccountClient, type FlowAccountExpense } from "./client"
import { resolveContact }      from "./contact-resolver"

// Default expense account codes (configurable per org via account_mappings)
const DEFAULT_EXPENSE_ACCOUNT = "5000"   // General Expenses
const DEFAULT_VAT_ACCOUNT     = "2110"   // VAT Payable / Input Tax

export interface PushResult {
  success:        boolean
  externalId?:    string
  externalRef?:   string
  error?:         string
}

/**
 * Push an approved document to FlowAccount as a Purchase Invoice.
 */
export async function pushToFlowAccount(
  documentId:     string,
  integrationId:  string,
): Promise<PushResult> {
  const supabase = createClient()

  // ── Load document with line items ─────────────────────────────────────────
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select(`
      *,
      document_line_items (*)
    `)
    .eq("id", documentId)
    .single()

  if (docErr || !doc) {
    return { success: false, error: `Document not found: ${docErr?.message}` }
  }

  // ── Load integration + decrypt API key ────────────────────────────────────
  const { data: integration, error: intErr } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .single()

  if (intErr || !integration) {
    return { success: false, error: `Integration not found: ${intErr?.message}` }
  }

  let apiKey: string
  try {
    apiKey = decrypt(integration.api_key_enc)
  } catch {
    return { success: false, error: "Failed to decrypt API key" }
  }

  const faClient = new FlowAccountClient(apiKey)

  // ── Load account mappings for this org ───────────────────────────────────
  const { data: mappings } = await supabase
    .from("account_mappings")
    .select("*")
    .eq("organization_id", doc.organization_id)
    .eq("integration_id",  integrationId)

  const accountMap = new Map(
    (mappings ?? []).map(m => [m.local_account_code, m.external_account_code])
  )

  // ── Resolve / create supplier contact ────────────────────────────────────
  const contactId = await resolveContact(
    faClient,
    integrationId,
    doc.vendor_name,
    doc.vendor_tax_id,
  )

  // ── Build expense payload ─────────────────────────────────────────────────
  const lineItems = (doc.document_line_items ?? []).map((item: {
    description: string
    quantity: number
    unit_price: number
    amount: number
  }) => ({
    description:  item.description,
    quantity:     item.quantity,
    unitPrice:    item.unit_price,
    taxRate:      doc.vat_amount > 0 ? 7 : 0,
    whtRate:      doc.wht_amount > 0 ? deriveWhtRate(doc.wht_amount, doc.subtotal) : 0,
    accountCode:  accountMap.get("expense") ?? DEFAULT_EXPENSE_ACCOUNT,
  }))

  // If no line items were extracted, create a single summary line
  if (lineItems.length === 0) {
    lineItems.push({
      description:  doc.vendor_name ?? "ค่าใช้จ่าย",
      quantity:     1,
      unitPrice:    doc.subtotal ?? doc.total_amount,
      taxRate:      doc.vat_amount > 0 ? 7 : 0,
      whtRate:      doc.wht_amount > 0 ? deriveWhtRate(doc.wht_amount, doc.subtotal) : 0,
      accountCode:  accountMap.get("expense") ?? DEFAULT_EXPENSE_ACCOUNT,
    })
  }

  const vatType: FlowAccountExpense["vatType"] =
    doc.vat_amount > 0 ? "VAT_EXCLUDE" : "NO_VAT"

  const expense: FlowAccountExpense = {
    contactId,
    referenceNo: doc.doc_number ?? `SL-${documentId.slice(0, 8)}`,
    issueDate:   doc.doc_date   ?? toISODate(new Date()),
    dueDate:     doc.due_date   ?? undefined,
    note:        doc.notes      ?? undefined,
    vatType,
    items:       lineItems,
  }

  // ── Call FlowAccount API ──────────────────────────────────────────────────
  let externalId: string
  let externalRef: string
  try {
    const created = await faClient.createExpense(expense)
    externalId    = created.id
    externalRef   = created.referenceNo
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `FlowAccount API error: ${msg}` }
  }

  // ── Update document status + log ─────────────────────────────────────────
  await supabase
    .from("documents")
    .update({
      status:                  "pushed",
      integration_id:          integrationId,
      external_ref:            externalRef,
      pushed_at:               new Date().toISOString(),
      updated_at:              new Date().toISOString(),
    })
    .eq("id", documentId)

  await supabase.from("document_push_logs").insert({
    document_id:    documentId,
    integration_id: integrationId,
    external_id:    externalId,
    external_ref:   externalRef,
    status:         "success",
    payload:        expense,
    pushed_at:      new Date().toISOString(),
  })

  await supabase.from("document_audit_logs").insert({
    document_id: documentId,
    action:      "pushed",
    actor:       "system",
    metadata:    { integration: "flowaccount", externalId, externalRef },
  })

  return { success: true, externalId, externalRef }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveWhtRate(whtAmount: number, subtotal: number): number {
  if (!subtotal) return 3
  const rate = (whtAmount / subtotal) * 100
  // Snap to nearest valid Thai WHT rate
  const valid = [1, 1.5, 3, 5]
  return valid.reduce((best, r) => Math.abs(r - rate) < Math.abs(best - rate) ? r : best, 3)
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
