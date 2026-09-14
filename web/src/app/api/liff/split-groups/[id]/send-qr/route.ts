import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { generatePromptPayQR } from "@/lib/promptpay"

// Finds the creator's existing direct conversation with payerUserId, or creates one.
async function getOrCreateDirectConversation(
  admin: ReturnType<typeof createAdminClient>,
  userIdA: string,
  userIdB: string,
) {
  const { data: aConvs } = await admin.from("conversation_members")
    .select("conversation_id").eq("user_id", userIdA)
  const aIds = (aConvs ?? []).map((r: any) => r.conversation_id)
  if (aIds.length > 0) {
    const { data: shared } = await admin.from("conversation_members")
      .select("conversation_id").eq("user_id", userIdB).in("conversation_id", aIds).limit(1).maybeSingle()
    if (shared) return (shared as any).conversation_id as string
  }

  const { data: conv } = await admin.from("conversations")
    .insert({ type: "direct", created_by: userIdA }).select("id").single()
  await admin.from("conversation_members").insert([
    { conversation_id: conv!.id, user_id: userIdA, role: "admin" },
    { conversation_id: conv!.id, user_id: userIdB, role: "member" },
  ])
  return conv!.id as string
}

// POST /api/liff/split-groups/[id]/send-qr — { lineUserId, participantId }
// Posts a PromptPay QR + amount as a payment-request message into the
// creator's direct chat with that participant (must be a linked system user).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as { lineUserId: string; participantId: string }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { participantId } = body
  if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })

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
  const qrPayload = generatePromptPayQR(bill.promptpay_id, amount)
  const conversationId = await getOrCreateDirectConversation(admin, conn.user_id, payerConn.user_id)

  const { data: pr } = await admin.from("payment_requests").insert({
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

  await Promise.all([
    admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id:       conn.user_id,
      msg_type:        "payment_request",
      body:            `💸 ขอเงิน ฿${amount.toLocaleString("th-TH")} — หารบิล: ${bill.title}`,
      meta:            { payment_request_id: pr?.id, amount, split_bill_id: id },
    }),
    admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId),
  ])

  return NextResponse.json({ ok: true, paymentRequestId: pr?.id })
}
