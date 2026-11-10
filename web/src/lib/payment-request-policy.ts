/**
 * Who may see or change a payment request (pure: no Next, no Supabase), so it can be unit-tested with
 * `node --experimental-strip-types --test src/lib/payment-request-policy.test.mjs`.
 *
 * Why this exists: /api/payment-requests/[id] reads and writes with the ADMIN client, which bypasses RLS. It used to
 * return any request to any signed-in user, let any signed-in user mark any request paid (and attach any document id
 * as the slip), and answer { ok: true } whatever happened. These rules are what RLS would have said
 * (payment_requests_participant: requester or payer), plus the room the card was posted in.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PaymentRequestRow {
  requester_id: string
  payer_id: string | null
  conversation_id: string | null
  status: string
}

// ── PATCH body ──────────────────────────────────────────────────────────────

export type PatchAction = "mark_paid" | "cancel"

export type PatchBody =
  | { ok: true; action: PatchAction; slipDocId: string | null }
  | { ok: false; error: string }

export function parsePatchBody(body: unknown): PatchBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be an object" }
  const { action, slipDocId } = body as Record<string, unknown>
  if (action !== "mark_paid" && action !== "cancel") return { ok: false, error: "unknown action" }

  let slip: string | null = null
  if (slipDocId !== undefined && slipDocId !== null) {
    if (action !== "mark_paid") return { ok: false, error: "slipDocId is only valid with mark_paid" }
    if (typeof slipDocId !== "string" || !UUID_RE.test(slipDocId)) return { ok: false, error: "invalid slipDocId" }
    slip = slipDocId
  }
  return { ok: true, action, slipDocId: slip }
}

// ── who can see it ──────────────────────────────────────────────────────────

/**
 * The requester, the designated payer, or a member of the room the request's card was posted in
 * (`isRoomMember` is only meaningful when the request has a conversation; the caller computes it from membership).
 * A request with no payer and no room is visible to its requester only.
 */
export function canViewPaymentRequest(pr: PaymentRequestRow, userId: string, isRoomMember: boolean): boolean {
  if (pr.requester_id === userId) return true
  if (pr.payer_id !== null && pr.payer_id === userId) return true
  return pr.conversation_id !== null && isRoomMember
}

// ── who can change it ───────────────────────────────────────────────────────

export type PatchDecision =
  | "apply"       // do the update
  | "already"     // already in the requested state: answer ok, change nothing (idempotent)
  | "conflict"    // the status does not allow it (e.g. paying a cancelled request): 409
  | "forbidden"   // not allowed for this caller: answer 404, the same as a request they cannot see

/**
 * mark_paid: the requester or the designated payer (a room member who is neither cannot; an open request with no
 *            payer can only be marked by its requester). Allowed from `pending` only.
 * cancel:    the requester only. Allowed from `pending` only.
 * Authorization is decided BEFORE the status, so a stranger learns nothing about the state of a request.
 */
export function decidePatch(action: PatchAction, pr: PaymentRequestRow, userId: string): PatchDecision {
  const isRequester = pr.requester_id === userId
  const isPayer = pr.payer_id !== null && pr.payer_id === userId

  if (action === "mark_paid") {
    if (!isRequester && !isPayer) return "forbidden"
    if (pr.status === "pending") return "apply"
    return pr.status === "paid" ? "already" : "conflict"
  }
  if (!isRequester) return "forbidden"
  if (pr.status === "pending") return "apply"
  return pr.status === "cancelled" ? "already" : "conflict"
}

// ── slip document ───────────────────────────────────────────────────────────

/**
 * A document may be attached as the slip if the caller uploaded it or belongs to its organization. `orgIds` are the
 * organizations the caller is a member of. A missing document is never attachable.
 */
export function canAttachSlipDocument(
  doc: { uploaded_by: string | null; organization_id: string | null } | null | undefined,
  userId: string,
  orgIds: string[],
): boolean {
  if (!doc) return false
  if (doc.uploaded_by !== null && doc.uploaded_by === userId) return true
  return doc.organization_id !== null && orgIds.includes(doc.organization_id)
}
