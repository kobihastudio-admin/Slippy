import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generatePromptPayQR } from "@/lib/promptpay"
import { validatePaymentRequestBody } from "@/lib/payment-request-input"
import { checkConversationMembership } from "@/lib/conversation-membership"

// GET /api/payment-requests?role=received|sent
export async function GET(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role  = req.nextUrl.searchParams.get("role") ?? "received"
  const admin = createAdminClient()
  const col   = role === "sent" ? "requester_id" : "payer_id"

  const { data } = await admin.from("payment_requests")
    .select("*, requester:requester_id(id,full_name,avatar_url), payer:payer_id(id,full_name,avatar_url)")
    .eq(col, user.id)
    .order("created_at", { ascending: false })
    .limit(30)

  return NextResponse.json({ requests: data ?? [] })
}

// POST /api/payment-requests
export async function POST(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const parsed = validatePaymentRequestBody(payload)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { payerId, amount, description, promptpayId, conversationId, splitBillId } = parsed.value

  // This route writes with the ADMIN client, which bypasses RLS, so posting a card into a room is only allowed for
  // a member of that room (checked with the caller's own client, before anything is created). A stranger used to be
  // able to drop a "💸 ขอเงิน" card with their own PromptPay QR into any room whose id they knew. Same answer as a
  // room that does not exist, so ids cannot be probed.
  if (conversationId) {
    const membership = await checkConversationMembership(sb, conversationId, user.id)
    if (membership === "error") return NextResponse.json({ error: "Could not check access" }, { status: 500 })
    if (membership === "not-member") return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const admin = createAdminClient()
  let ppId = promptpayId

  if (!ppId) {
    const { data: member } = await admin.from("organization_members")
      .select("organization_id").eq("user_id", user.id).limit(1).maybeSingle()
    if (member) {
      const { data: org } = await admin.from("organizations")
        .select("settings").eq("id", (member as any).organization_id).maybeSingle()
      ppId = (org?.settings as any)?.promptpay_id
    }
  }

  const qrPayload = ppId ? generatePromptPayQR(ppId, amount) : null

  const { data: pr, error: insertError } = await admin.from("payment_requests").insert({
    requester_id:    user.id,
    payer_id:        payerId,
    amount,
    description,
    promptpay_id:    ppId ?? null,
    qr_payload:      qrPayload,
    conversation_id: conversationId,
    split_bill_id:   splitBillId,
  }).select("id, qr_payload").single()

  // It used to answer { ok: true, id: undefined } when the insert failed.
  if (insertError || !pr) {
    console.error("[payment-requests] insert failed:", insertError?.message)
    // 23503 = foreign key violation: a payer or bill that does not exist.
    if (insertError?.code === "23503") return NextResponse.json({ error: "payer or bill not found" }, { status: 400 })
    return NextResponse.json({ error: "Could not create payment request" }, { status: 500 })
  }

  let messagePosted = false
  if (conversationId) {
    const { error: messageError } = await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id:       user.id,
      msg_type:        "payment_request",
      body:            `💸 ขอเงิน ฿${amount.toLocaleString("th-TH")} — ${description ?? ""}`,
      meta:            { payment_request_id: pr.id, amount, description },
    })
    if (messageError) {
      // The request exists (and is returned); only its chat card is missing. Do not fail the whole call for that.
      console.error("[payment-requests] chat card failed:", messageError.message)
    } else {
      messagePosted = true
      const touched = await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId)
      if (touched.error) console.error("[payment-requests] touching the conversation failed:", touched.error.message)
    }
  }

  return NextResponse.json({ ok: true, id: pr.id, qrPayload: pr.qr_payload, messagePosted })
}
