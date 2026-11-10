import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { generatePromptPayQR } from "@/lib/promptpay"
import { findDirectConversationId, isUuid } from "@/lib/chat-access"

/**
 * The creator's direct chat with the payer: the existing direct room of EXACTLY these two people, or a new one.
 * It used to reuse "any room both are in", so the payment request (amount and bill title) could be posted into a
 * shared GROUP or TRIP chat and shown to everyone there instead of only to the payer.
 *
 * Returns null when the room cannot be determined or created, and the caller answers 500. A failed LOOKUP never
 * creates a second room (findDirectConversationId fails closed), and a room whose members could not be added is
 * removed again rather than left empty.
 */
async function getOrCreateDirectConversation(
  admin: ReturnType<typeof createAdminClient>,
  userIdA: string,
  userIdB: string,
): Promise<string | null> {
  const found = await findDirectConversationId(admin, userIdA, userIdB)
  if (!found.ok) return null
  if (found.id) return found.id

  const { data: conv, error } = await admin.from("conversations")
    .insert({ type: "direct", created_by: userIdA }).select("id").single()
  if (error || !conv) {
    console.error("[send-qr] creating the direct chat failed:", error?.message)
    return null
  }
  const { error: membersError } = await admin.from("conversation_members").insert([
    { conversation_id: conv.id, user_id: userIdA, role: "admin" },
    { conversation_id: conv.id, user_id: userIdB, role: "member" },
  ])
  if (membersError) {
    console.error("[send-qr] adding the chat members failed:", membersError.message)
    await admin.from("conversations").delete().eq("id", conv.id)
    return null
  }
  return conv.id as string
}

// POST /api/liff/split-groups/[id]/send-qr — { lineUserId, participantId }
// Posts a PromptPay QR + amount as a payment-request message into the
// creator's direct chat with that participant (must be a linked system user).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 })
  let body: { lineUserId?: string; participantId?: string } | null
  try { body = await req.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  if (typeof body !== "object" || body === null) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { participantId } = body
  if (!participantId || !isUuid(participantId)) return NextResponse.json({ error: "participantId required" }, { status: 400 })

  const admin = createAdminClient()

  const { data: bill } = await admin.from("split_bills")
    .select("id, title, creator_id, promptpay_id, organization_id")
    .eq("id", id).eq("category", "general").maybeSingle()
  if (!bill) return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 })

  const { data: conn } = await admin.from("line_connections")
    .select("user_id").eq("line_user_id", lineUserId).maybeSingle()
  if (!conn || conn.user_id !== bill.creator_id) {
    return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่ส่ง QR ได้" }, { status: 403 })
  }

  const { data: participant } = await admin.from("split_participants")
    .select("id, name, amount, paid_at, line_user_id")
    .eq("id", participantId).eq("split_bill_id", id).maybeSingle()
  if (!participant) return NextResponse.json({ error: "ไม่พบผู้เข้าร่วม" }, { status: 404 })
  if (participant.paid_at) return NextResponse.json({ error: "ผู้เข้าร่วมนี้จ่ายแล้ว" }, { status: 400 })
  if (!participant.line_user_id) {
    return NextResponse.json({ error: "ผู้เข้าร่วมนี้ยังไม่เชื่อมต่อระบบ — ส่งทาง LINE แทนได้" }, { status: 400 })
  }

  const { data: payerConn } = await admin.from("line_connections")
    .select("user_id").eq("line_user_id", participant.line_user_id).maybeSingle()
  if (!payerConn) {
    return NextResponse.json({ error: "ผู้เข้าร่วมนี้ยังไม่เชื่อมต่อระบบ — ส่งทาง LINE แทนได้" }, { status: 400 })
  }

  if (!bill.promptpay_id) {
    return NextResponse.json({ error: "กรุณาตั้งค่าเบอร์ PromptPay ก่อนส่ง QR" }, { status: 400 })
  }

  const amount = Number(participant.amount)
  // payment_requests has CHECK (amount > 0); say so instead of failing later.
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "จำนวนเงินของผู้เข้าร่วมไม่ถูกต้อง" }, { status: 400 })
  }
  const qrPayload = generatePromptPayQR(bill.promptpay_id, amount)

  // The private chat of exactly these two people (never a shared group/trip room). If it cannot be found or created
  // nothing is created and nothing is posted.
  const conversationId = await getOrCreateDirectConversation(admin, conn.user_id, payerConn.user_id)
  if (!conversationId) return NextResponse.json({ error: "ไม่สามารถเปิดแชทกับผู้เข้าร่วมได้" }, { status: 500 })

  const { data: pr, error: prError } = await admin.from("payment_requests").insert({
    organization_id: bill.organization_id,
    requester_id:    conn.user_id,
    payer_id:        payerConn.user_id,
    amount,
    description:     `หารบิล: ${bill.title}`,
    promptpay_id:    bill.promptpay_id,
    qr_payload:      qrPayload,
    conversation_id: conversationId,
    split_bill_id:   id,
  }).select("id").single()
  // It used to carry on and post a card with an undefined payment_request_id.
  if (prError || !pr) {
    console.error("[send-qr] creating the payment request failed:", prError?.message)
    return NextResponse.json({ error: "ไม่สามารถสร้างคำขอชำระเงินได้" }, { status: 500 })
  }

  const { error: messageError } = await admin.from("messages").insert({
    conversation_id: conversationId,
    sender_id:       conn.user_id,
    msg_type:        "payment_request",
    body:            `💸 ขอเงิน ฿${amount.toLocaleString("th-TH")} — หารบิล: ${bill.title}`,
    meta:            { payment_request_id: pr.id, amount, split_bill_id: id },
  })
  if (messageError) {
    // The request exists; only its chat card is missing. Report it without failing the whole call.
    console.error("[send-qr] posting the chat card failed:", messageError.message)
    return NextResponse.json({ ok: true, paymentRequestId: pr.id, messagePosted: false })
  }
  const touched = await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId)
  if (touched.error) console.error("[send-qr] touching the conversation failed:", touched.error.message)

  return NextResponse.json({ ok: true, paymentRequestId: pr.id, messagePosted: true })
}
