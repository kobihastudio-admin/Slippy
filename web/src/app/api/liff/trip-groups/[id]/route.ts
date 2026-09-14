import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

const TRIP_EMOJI: Record<string, string> = {
  "เที่ยวทะเล": "🏖️", "ทะเล": "🏖️", "beach": "🏖️",
  "แคมป์ปิ้ง": "⛺", "แคมป์": "⛺", "camping": "⛺",
  "ปีนเขา": "🏔️", "เขาใหญ่": "🏔️", "ภูเขา": "🏔️", "hiking": "🏔️", "trekking": "🏔️",
  "ต่างประเทศ": "✈️", "เที่ยวต่างประเทศ": "✈️", "abroad": "✈️", "international": "✈️",
  "เมือง": "🏙️", "ทริปเมือง": "🏙️", "city": "🏙️",
  "เกาะ": "🏝️", "island": "🏝️",
  "น้ำตก": "💦", "waterfall": "💦",
  "วัด": "🛕", "ไหว้พระ": "🛕", "temple": "🛕",
  "สวนสนุก": "🎢", "themepark": "🎢",
  "รถ": "🚗", "ขับรถเที่ยว": "🚗", "roadtrip": "🚗", "road trip": "🚗",
}
function tripEmoji(t: string) { return TRIP_EMOJI[(t ?? "").toLowerCase()] ?? "✈️" }

// Fire-and-forget call to api/trip/notify — pushes pay/unpay/finalize update
// cards back into the LINE group chat where the trip group was created.
// No-op server-side if the bill has no line_group_id (LIFF-only group).
function notifyTripGroup(billId: string, event: "pay" | "unpay" | "finalize", lineUserId: string) {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) return
  fetch(`${process.env.API_BASE_URL}/trip/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
    body: JSON.stringify({ billId, event, lineUserId }),
  }).catch(err => console.error("[trip-notify] failed:", err.message))
}

async function rebalance(admin: ReturnType<typeof createAdminClient>, billId: string, totalAmount: number) {
  const { data: parts } = await admin.from("split_participants")
    .select("id").eq("split_bill_id", billId)
  const n = parts?.length ?? 0
  if (n > 0) {
    const share = Math.round((totalAmount / n) * 100) / 100
    for (const p of parts!) {
      await admin.from("split_participants").update({ amount: share }).eq("id", p.id)
    }
  }
  return n
}

// Resolve a LINE userId → { organization_id, user_id } via line_connections.
async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

async function loadDetail(admin: ReturnType<typeof createAdminClient>, id: string, lineUserId?: string | null) {
  const { data: bill } = await admin.from("split_bills")
    .select("id, title, trip_type, destination, total_amount, status, share_token, organization_id, creator_id, promptpay_id, split_participants(id, name, amount, paid_at, line_user_id)")
    .eq("id", id)
    .eq("category", "trip")
    .maybeSingle()

  if (!bill) return null

  let isCreator = false
  if (lineUserId) {
    const conn = await resolveConnection(admin, lineUserId)
    isCreator = !!conn && conn.user_id === bill.creator_id
  }

  const participants = (bill.split_participants as any[])
    .map(p => ({ id: p.id, name: p.name, amount: Number(p.amount), paid: !!p.paid_at, isMe: lineUserId ? p.line_user_id === lineUserId : false }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))

  return {
    id:          bill.id,
    title:       bill.title,
    emoji:       tripEmoji(bill.trip_type ?? ""),
    tripType:    bill.trip_type,
    destination: bill.destination,
    fee:         Number(bill.total_amount),
    status:      bill.status,
    shareToken:  bill.share_token,
    promptpayId: bill.promptpay_id ?? null,
    isCreator,
    participants,
    paidTotal:   participants.filter(p => p.paid).reduce((s, p) => s + p.amount, 0),
  }
}

// GET /api/liff/trip-groups/[id]?lineUserId=Uxxx — group detail + participants
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const admin = createAdminClient()

  const detail = await loadDetail(admin, id, lineUserId)
  if (!detail) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  return NextResponse.json({ group: detail })
}

// POST /api/liff/trip-groups/[id] — actions: join | pay | unpay | finalize
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    action:      "join" | "pay" | "unpay" | "finalize" | "setPromptPay"
    lineUserId:  string
    displayName?: string
    promptpayId?: string
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action, displayName, promptpayId } = body
  if (!action || !lineUserId) return NextResponse.json({ error: "action and lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const { data: bill } = await admin.from("split_bills")
    .select("id, status, total_amount, category, creator_id")
    .eq("id", id).eq("category", "trip").maybeSingle()

  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  if (action === "join") {
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    const { data: existing } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", id).eq("line_user_id", lineUserId).maybeSingle()
    if (!existing) {
      await admin.from("split_participants").insert({
        split_bill_id: id, name: displayName ?? "ผู้เข้าร่วม",
        line_user_id: lineUserId, line_display: displayName, is_non_line: false, amount: 0,
      })
      await rebalance(admin, id, Number(bill.total_amount))
    }
  }

  if (action === "pay" || action === "unpay") {
    const { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", id).eq("line_user_id", lineUserId).maybeSingle()
    if (!me) return NextResponse.json({ error: "คุณยังไม่ได้เข้าร่วมกลุ่มนี้" }, { status: 400 })
    await admin.from("split_participants")
      .update({ paid_at: action === "pay" ? new Date().toISOString() : null })
      .eq("id", me.id)
  }

  if (action === "setPromptPay") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ตั้งค่า PromptPay ได้" }, { status: 403 })
    }
    await admin.from("split_bills")
      .update({ promptpay_id: promptpayId?.trim() || null })
      .eq("id", id)
  }

  if (action === "finalize") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ปิดกลุ่มได้" }, { status: 403 })
    }
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดไปแล้วครับ" }, { status: 400 })
    await rebalance(admin, id, Number(bill.total_amount))
    await admin.from("split_bills").update({ status: "finalized" }).eq("id", id)
  }

  // Push a "KhunThong-style" update card back into the LINE group chat (if this
  // trip group was created from one) — fire-and-forget, never block the response.
  if (action === "pay" || action === "unpay" || action === "finalize") {
    notifyTripGroup(id, action, lineUserId)
  }

  const detail = await loadDetail(admin, id, lineUserId)
  return NextResponse.json({ ok: true, group: detail })
}
