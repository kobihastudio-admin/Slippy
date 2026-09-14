import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generatePromptPayQR } from "@/lib/promptpay"

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

  const { payerId, amount, description, promptpayId, conversationId, splitBillId }: {
    payerId?: string; amount: number; description?: string
    promptpayId?: string; conversationId?: string; splitBillId?: string
  } = await req.json()

  if (!amount || amount <= 0)
    return NextResponse.json({ error: "invalid amount" }, { status: 400 })

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

  const { data: pr } = await admin.from("payment_requests").insert({
    requester_id:    user.id,
    payer_id:        payerId ?? null,
    amount,
    description:     description ?? null,
    promptpay_id:    ppId ?? null,
    qr_payload:      qrPayload,
    conversation_id: conversationId ?? null,
    split_bill_id:   splitBillId ?? null,
  }).select("id, qr_payload").single()

  if (conversationId && pr) {
    await Promise.all([
      admin.from("messages").insert({
        conversation_id: conversationId,
        sender_id:       user.id,
        msg_type:        "payment_request",
        body:            `💸 ขอเงิน ฿${Number(amount).toLocaleString("th-TH")} — ${description ?? ""}`,
        meta:            { payment_request_id: pr.id, amount, description },
      }),
      admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId),
    ])
  }

  return NextResponse.json({ ok: true, id: pr?.id, qrPayload: pr?.qr_payload })
}
