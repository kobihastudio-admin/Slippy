/**
 * Validation of the body of POST /api/payment-requests (pure: no Next, no Supabase), so it can be unit-tested with
 * `node --experimental-strip-types --test src/lib/payment-request-access.test.mjs`.
 *
 * The route writes with the ADMIN client, so everything it forwards must be checked here first. Limits come from the
 * table: `amount numeric(14,2)` with CHECK > 0, `payer_id` / `conversation_id` / `split_bill_id` uuids.
 */

// Same rule as isUuid() in chat-access.ts. Inlined: a runtime import of a sibling module cannot be resolved by the
// plain-node test runner (the "@/" alias and extensionless imports are Next/TypeScript features).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_AMOUNT = 999_999_999_999.99   // numeric(14,2)
const MAX_DESCRIPTION = 200

export interface PaymentRequestInput {
  amount: number
  payerId: string | null
  description: string | null
  promptpayId: string | null
  conversationId: string | null
  splitBillId: string | null
}

export type PaymentRequestValidation =
  | { ok: true; value: PaymentRequestInput }
  | { ok: false; error: string }

/**
 * PromptPay ids the QR builder understands (lib/promptpay.ts): a mobile number (10 digits, leading 0), a national /
 * tax id (13 digits) or an e-wallet id (15 digits). Spaces and dashes are allowed as formatting. Anything else would
 * silently produce a QR for the wrong account.
 */
function validPromptPayId(raw: string): boolean {
  if (!/^[0-9 -]+$/.test(raw)) return false
  const digits = raw.replace(/[^0-9]/g, "")
  return (digits.length === 10 && digits.startsWith("0")) || digits.length === 13 || digits.length === 15
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined
}

export function validatePaymentRequestBody(body: unknown): PaymentRequestValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" }
  }
  const b = body as Record<string, unknown>

  if (typeof b.amount !== "number" || !Number.isFinite(b.amount)) return { ok: false, error: "invalid amount" }
  // Round once, here: the QR and the stored value must be the same number (the column keeps 2 decimals).
  const amount = Math.round(b.amount * 100) / 100
  if (!(amount > 0) || amount > MAX_AMOUNT) return { ok: false, error: "invalid amount" }

  let description: string | null = null
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== "string") return { ok: false, error: "description must be a string" }
    const trimmed = b.description.trim()
    if (trimmed.length > MAX_DESCRIPTION) return { ok: false, error: "description is too long" }
    description = trimmed || null
  }

  let promptpayId: string | null = null
  if (b.promptpayId !== undefined && b.promptpayId !== null) {
    if (typeof b.promptpayId !== "string") return { ok: false, error: "invalid promptpayId" }
    const trimmed = b.promptpayId.trim()
    if (trimmed) {
      if (!validPromptPayId(trimmed)) return { ok: false, error: "invalid promptpayId" }
      promptpayId = trimmed
    }
  }

  const payerId = optionalUuid(b.payerId)
  if (payerId === undefined) return { ok: false, error: "invalid payerId" }
  const conversationId = optionalUuid(b.conversationId)
  if (conversationId === undefined) return { ok: false, error: "invalid conversationId" }
  const splitBillId = optionalUuid(b.splitBillId)
  if (splitBillId === undefined) return { ok: false, error: "invalid splitBillId" }

  return { ok: true, value: { amount, payerId, description, promptpayId, conversationId, splitBillId } }
}
