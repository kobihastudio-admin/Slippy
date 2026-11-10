import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isUuid } from "@/lib/chat-access"
import { checkConversationMembership } from "@/lib/conversation-membership"
import {
  canAttachSlipDocument,
  canViewPaymentRequest,
  decidePatch,
  parsePatchBody,
} from "@/lib/payment-request-policy"

/**
 * Both handlers use the ADMIN client (it needs the profile joins), which bypasses RLS, so who may see or change a
 * request is decided explicitly by src/lib/payment-request-policy.ts. Anyone who is not allowed gets the same 404 as
 * a request that does not exist, so ids cannot be probed.
 */

// GET /api/payment-requests/[id] — the requester, the designated payer, or a member of the room the card is in.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 })

  const admin  = createAdminClient()
  const { data, error } = await admin.from("payment_requests")
    .select("*, requester:requester_id(id,full_name,avatar_url), payer:payer_id(id,full_name,avatar_url)")
    .eq("id", id).maybeSingle()
  if (error) {
    console.error("[payment-requests/id] load failed:", error.message)
    return NextResponse.json({ error: "Could not load payment request" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })

  let isRoomMember = false
  const involved = data.requester_id === user.id || data.payer_id === user.id
  if (!involved && data.conversation_id) {
    const membership = await checkConversationMembership(sb, data.conversation_id, user.id)
    if (membership === "error") return NextResponse.json({ error: "Could not check access" }, { status: 500 })
    isRoomMember = membership === "member"
  }
  if (!canViewPaymentRequest(data, user.id, isRoomMember)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  return NextResponse.json({ request: data })
}

// PATCH /api/payment-requests/[id] — { action: "mark_paid", slipDocId? } by the requester or the designated payer,
// or { action: "cancel" } by the requester. Only a pending request can change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 })

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const parsed = parsePatchBody(payload)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = createAdminClient()
  const { data: pr, error: loadError } = await admin.from("payment_requests")
    .select("requester_id, payer_id, conversation_id, status")
    .eq("id", id).maybeSingle()
  if (loadError) {
    console.error("[payment-requests/id] load failed:", loadError.message)
    return NextResponse.json({ error: "Could not load payment request" }, { status: 500 })
  }
  if (!pr) return NextResponse.json({ error: "not found" }, { status: 404 })

  const decision = decidePatch(parsed.action, pr, user.id)
  if (decision === "forbidden") return NextResponse.json({ error: "not found" }, { status: 404 })
  if (decision === "conflict")  return NextResponse.json({ error: "request is not pending" }, { status: 409 })
  if (decision === "already")   return NextResponse.json({ ok: true, unchanged: true })

  const update: Record<string, unknown> = parsed.action === "mark_paid"
    ? { status: "paid", paid_at: new Date().toISOString() }
    : { status: "cancelled" }

  if (parsed.action === "mark_paid" && parsed.slipDocId) {
    // The slip must be a document the caller could see themselves, not any document id.
    const [docResult, orgResult] = await Promise.all([
      admin.from("documents").select("uploaded_by, organization_id").eq("id", parsed.slipDocId).maybeSingle(),
      admin.from("organization_members").select("organization_id").eq("user_id", user.id),
    ])
    if (docResult.error || orgResult.error) {
      console.error("[payment-requests/id] slip check failed:", docResult.error?.message ?? orgResult.error?.message)
      return NextResponse.json({ error: "Could not check the slip document" }, { status: 500 })
    }
    const orgIds = (orgResult.data ?? []).map((m: { organization_id: string }) => m.organization_id)
    if (!canAttachSlipDocument(docResult.data, user.id, orgIds)) {
      return NextResponse.json({ error: "slip document not found" }, { status: 400 })
    }
    update.slip_doc_id = parsed.slipDocId
  }

  // Conditional on `pending`, so two concurrent calls cannot both succeed or overwrite each other.
  const { data: updated, error: updateError } = await admin.from("payment_requests")
    .update(update).eq("id", id).eq("status", "pending").select("id")
  if (updateError) {
    console.error("[payment-requests/id] update failed:", updateError.message)
    return NextResponse.json({ error: "Could not update payment request" }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "request is not pending" }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
