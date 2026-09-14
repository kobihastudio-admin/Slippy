import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

// Pushes a "ตอนนี้มีใครอยู่บ้าง" roster card into the bill's LINE group
// (no-op server-side if it has no line_group_id). Returns a diagnostic
// result instead of swallowing everything — fetch() only rejects on
// network-level failures, never on non-2xx HTTP responses, so a
// misconfigured INTERNAL_API_KEY or a Fastify-side error would otherwise
// fail completely silently.
type NotifyResult = { attempted: boolean; ok?: boolean; status?: number; skipped?: string; error?: string }
async function notifyRoster(billId: string): Promise<NotifyResult> {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) {
    return { attempted: false, skipped: "API_BASE_URL or INTERNAL_API_KEY not set on the web server" }
  }
  try {
    const res = await fetch(`${process.env.API_BASE_URL}/split/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
      body: JSON.stringify({ billId, event: "rosterUpdate" }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error("[split-groups:notifyRoster] non-OK response:", res.status, data)
      return { attempted: true, ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}` }
    }
    return { attempted: true, ok: true, skipped: data?.skipped }
  } catch (err: any) {
    console.error("[split-groups:notifyRoster] failed:", err.message)
    return { attempted: true, ok: false, error: err.message }
  }
}

// Splits `totalAmount` evenly per head, folding each named guest's share
// (added via the public join-link guest form) onto whoever added them —
// guests get amount=0 and settle directly with their adder ("จัดการกันเอาเอง").
async function rebalance(admin: ReturnType<typeof createAdminClient>, billId: string, totalAmount: number) {
  const { data: parts } = await admin.from("split_participants")
    .select("id, added_by_participant_id").eq("split_bill_id", billId)
  const all = parts ?? []
  if (all.length === 0) return 0

  const guestCountByParent = new Map<string, number>()
  for (const p of all) {
    if (p.added_by_participant_id) {
      guestCountByParent.set(p.added_by_participant_id, (guestCountByParent.get(p.added_by_participant_id) ?? 0) + 1)
    }
  }

  const share = Math.round((totalAmount / all.length) * 100) / 100
  for (const p of all) {
    const amount = p.added_by_participant_id ? 0 : share * (1 + (guestCountByParent.get(p.id) ?? 0))
    await admin.from("split_participants").update({ amount }).eq("id", p.id)
  }
  return all.length
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
    .select("id, title, note, total_amount, status, share_token, organization_id, creator_id, promptpay_id, receipt_url, split_mode, allocation_details, split_participants(id, name, amount, paid_at, line_user_id, line_picture_url, added_by_participant_id)")
    .eq("id", id)
    .eq("category", "general")
    .maybeSingle()

  if (!bill) return null

  let isCreator = false
  if (lineUserId) {
    const conn = await resolveConnection(admin, lineUserId)
    isCreator = !!conn && conn.user_id === bill.creator_id
  }

  const lineIds = (bill.split_participants as any[])
    .map(p => p.line_user_id).filter(Boolean)
  let userIdByLineId: Record<string, string> = {}
  if (lineIds.length > 0) {
    const { data: conns } = await admin.from("line_connections")
      .select("line_user_id, user_id").in("line_user_id", lineIds)
    userIdByLineId = Object.fromEntries((conns ?? []).map((c: any) => [c.line_user_id, c.user_id]))
  }

  const allParticipants = (bill.split_participants as any[])
    .map(p => ({
      id: p.id, name: p.name, amount: Number(p.amount), paid: !!p.paid_at,
      isMe: lineUserId ? p.line_user_id === lineUserId : false,
      userId: p.line_user_id ? (userIdByLineId[p.line_user_id] ?? null) : null,
      avatarUrl: p.line_picture_url ?? null,
      addedByParticipantId: p.added_by_participant_id ?? null,
    }))

  // Named guests (added via the public join-link guest form) nest under
  // whoever added them instead of showing as flat rows — tree, not a list.
  const guestsByParent = new Map<string, typeof allParticipants>()
  for (const p of allParticipants) {
    if (!p.addedByParticipantId) continue
    const list = guestsByParent.get(p.addedByParticipantId) ?? []
    list.push(p)
    guestsByParent.set(p.addedByParticipantId, list)
  }

  const participants = allParticipants
    .filter(p => !p.addedByParticipantId)
    .map(p => ({ ...p, guests: (guestsByParent.get(p.id) ?? []).map(g => ({ id: g.id, name: g.name })) }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))

  const { data: receiptRows } = await admin.from("split_bill_receipts")
    .select("id, document_id, receipt_url, title, amount, expense_date, meal_type, paid_by_participant_id")
    .eq("split_bill_id", id).order("created_at", { ascending: true })
  const participantNameById = Object.fromEntries(allParticipants.map(p => [p.id, p.name]))
  const receipts = (receiptRows ?? []).map((r: any) => ({
    id: r.id,
    url: r.receipt_url ?? null,
    title: r.title ?? null,
    amount: Number(r.amount),
    expenseDate: r.expense_date,
    mealType: r.meal_type ?? "other",
    payerName: r.paid_by_participant_id ? (participantNameById[r.paid_by_participant_id] ?? null) : null,
    documentId: r.document_id ?? null,
  }))

  return {
    id:         bill.id,
    title:      bill.title,
    note:       bill.note,
    fee:        Number(bill.total_amount),
    status:     bill.status,
    shareToken: bill.share_token,
    promptpayId: bill.promptpay_id ?? null,
    receiptUrl: bill.receipt_url ?? null,
    splitMode: (bill.allocation_details as any)?.mode ?? bill.split_mode ?? "equal",
    allocationDetails: bill.allocation_details ?? {},
    receipts,
    isCreator,
    participants,
    paidTotal:  participants.filter(p => p.paid).reduce((s, p) => s + p.amount, 0),
  }
}

// GET /api/liff/split-groups/[id]?lineUserId=Uxxx — bill detail + participants
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const admin = createAdminClient()

  const detail = await loadDetail(admin, id, lineUserId)
  if (!detail) return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 })

  return NextResponse.json({ group: detail })
}

// POST /api/liff/split-groups/[id] — actions: join | pay | unpay | finalize
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    action:      "join" | "pay" | "unpay" | "finalize" | "setPromptPay" | "addParticipant" | "setAmount" | "removeGuest" | "attachDocument"
    lineUserId:  string
    displayName?: string
    promptpayId?: string
    name?:          string  // addParticipant (manual)
    friendUserId?:  string  // addParticipant (from in-app friends list)
    amount?:        number  // addParticipant | setAmount
    participantId?: string  // setAmount
    documentId?:    string  // attachDocument: receipt from the general document inbox
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action, displayName, promptpayId, name, friendUserId, amount, participantId, documentId } = body
  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 })

  let lineNotify: NotifyResult | undefined
  const admin = createAdminClient()
  const { data: bill } = await admin.from("split_bills")
    .select("id, status, total_amount, category, creator_id, organization_id")
    .eq("id", id).eq("category", "general").maybeSingle()

  if (!bill) return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 })

  // Connect an existing receipt/document to this bill. This is the bridge used
  // by the normal document inbox and scanner when several travellers upload
  // their own receipts. The selected participant is the person who paid first.
  if (action === "attachDocument") {
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดแล้วครับ" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่แนบใบเสร็จได้" }, { status: 403 })
    if (!documentId || !participantId) return NextResponse.json({ error: "documentId and participantId required" }, { status: 400 })

    const [{ data: document }, { data: payer }] = await Promise.all([
      admin.from("documents").select("id, vendor_name, total_amount").eq("id", documentId).eq("organization_id", bill.organization_id).maybeSingle(),
      admin.from("split_participants").select("id").eq("id", participantId).eq("split_bill_id", id).maybeSingle(),
    ])
    if (!document) return NextResponse.json({ error: "ไม่พบใบเสร็จในองค์กรนี้" }, { status: 404 })
    if (!payer) return NextResponse.json({ error: "ไม่พบผู้จ่ายในบิลนี้" }, { status: 404 })

    const receiptRecord = {
      split_bill_id: id,
      document_id: document.id,
      paid_by_participant_id: payer.id,
      title: document.vendor_name ?? "ใบเสร็จทั่วไป",
      amount: Number(document.total_amount ?? 0),
      source: "document",
    }
    const { data: existingReceipt } = await admin.from("split_bill_receipts")
      .select("id").eq("split_bill_id", id).eq("document_id", document.id).maybeSingle()
    const { error: attachError } = existingReceipt
      ? await admin.from("split_bill_receipts").update(receiptRecord).eq("id", existingReceipt.id)
      : await admin.from("split_bill_receipts").insert(receiptRecord)
    if (attachError) return NextResponse.json({ error: attachError.message }, { status: 500 })
  }

  // "เข้าร่วม" — re-sends the roster card to the LINE group every time it's
  // pressed, even on a repeat tap from someone already in the list.
  if (action === "join") {
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดแล้วครับ" }, { status: 400 })
    const { data: existing } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", id).eq("line_user_id", lineUserId).maybeSingle()
    if (!existing) {
      await admin.from("split_participants").insert({
        split_bill_id: id, name: displayName ?? "ผู้เข้าร่วม",
        line_user_id: lineUserId, line_display: displayName, is_non_line: false, amount: 0,
      })
      await rebalance(admin, id, Number(bill.total_amount))
    }
    lineNotify = await notifyRoster(id)
  }

  if (action === "pay" || action === "unpay") {
    const { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", id).eq("line_user_id", lineUserId).maybeSingle()
    if (!me) return NextResponse.json({ error: "คุณยังไม่ได้เข้าร่วมบิลนี้" }, { status: 400 })
    await admin.from("split_participants")
      .update({ paid_at: action === "pay" ? new Date().toISOString() : null })
      .eq("id", me.id)
  }

  if (action === "setPromptPay") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่ตั้งค่า PromptPay ได้" }, { status: 403 })
    }
    await admin.from("split_bills")
      .update({ promptpay_id: promptpayId?.trim() || null })
      .eq("id", id)
  }

  // เพิ่มรายชื่อผู้ที่จะหารด้วย — เฉพาะผู้สร้างบิล
  // รองรับ 2 ทาง: (1) เลือกเพื่อนในระบบ (friendUserId) — ลิงก์ line_user_id ให้อัตโนมัติถ้าเพื่อนเชื่อมต่อ LINE ไว้แล้ว
  //              (2) พิมพ์ชื่อเอง (name) — ผู้เข้าร่วมแบบไม่ผูกบัญชี
  if (action === "addParticipant") {
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดแล้วครับ" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่เพิ่มรายชื่อได้" }, { status: 403 })
    }
    const safeAmount = Number.isFinite(amount) ? Math.max(0, amount!) : 0

    if (friendUserId) {
      const { data: friendship } = await admin.from("friendships")
        .select("id")
        .eq("status", "accepted")
        .or(`and(requester_id.eq.${conn.user_id},addressee_id.eq.${friendUserId}),and(requester_id.eq.${friendUserId},addressee_id.eq.${conn.user_id})`)
        .maybeSingle()
      if (!friendship) return NextResponse.json({ error: "ไม่พบเพื่อนคนนี้ในระบบ" }, { status: 400 })

      const [{ data: friendUser }, { data: friendConn }] = await Promise.all([
        admin.from("users").select("full_name").eq("id", friendUserId).maybeSingle(),
        admin.from("line_connections").select("line_user_id, display_name").eq("user_id", friendUserId).maybeSingle(),
      ])
      // Prefer the LINE display name (set when they ran /connect, always
      // current) over users.full_name, which is only ever populated from
      // signup metadata and is commonly null for LINE-first accounts.
      const friendName = friendConn?.display_name ?? friendUser?.full_name ?? "เพื่อน"
      await admin.from("split_participants").insert({
        split_bill_id: id, name: friendName,
        line_user_id: friendConn?.line_user_id ?? null,
        is_non_line: !friendConn?.line_user_id, amount: safeAmount,
      })
    } else {
      if (!name?.trim()) return NextResponse.json({ error: "กรุณาระบุชื่อ" }, { status: 400 })
      await admin.from("split_participants").insert({
        split_bill_id: id, name: name.trim(),
        is_non_line: true, amount: safeAmount,
      })
    }
    lineNotify = await notifyRoster(id)
  }

  // Remove/cancel a participant — allowed only for: whoever added that guest
  // (added_by_participant_id), or the participant themselves ("ยกเลิกการ
  // เข้าร่วม" — self-cancel). Someone who joined on their own can't be
  // removed by anyone else, not even the bill creator.
  if (action === "removeGuest") {
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดแล้วครับ" }, { status: 400 })
    if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })

    const { data: target } = await admin.from("split_participants")
      .select("id, added_by_participant_id").eq("id", participantId).eq("split_bill_id", id).maybeSingle()
    if (!target) return NextResponse.json({ error: "ไม่พบผู้เข้าร่วม" }, { status: 404 })

    const { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", id).eq("line_user_id", lineUserId).maybeSingle()
    const isMyGuest = !!target.added_by_participant_id && target.added_by_participant_id === me?.id
    const isSelf    = !!me && me.id === target.id
    if (!isMyGuest && !isSelf) {
      return NextResponse.json({ error: "ลบได้แค่ตัวเอง หรือคนที่คุณเพิ่มเข้ามาเท่านั้น — คนที่เข้าร่วมเองไม่มีสิทธิ์ลบ" }, { status: 403 })
    }

    await admin.from("split_participants").delete().eq("id", participantId)
    await rebalance(admin, id, Number(bill.total_amount))
    lineNotify = await notifyRoster(id)
  }

  // ปรับยอดที่ต้องชำระของผู้ร่วมบิล — เฉพาะผู้สร้างบิล
  if (action === "setAmount") {
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดแล้วครับ" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่ปรับยอดได้" }, { status: 403 })
    }
    if (!participantId || !Number.isFinite(amount) || amount! < 0) {
      return NextResponse.json({ error: "participantId and amount required" }, { status: 400 })
    }
    await admin.from("split_participants")
      .update({ amount })
      .eq("id", participantId).eq("split_bill_id", id)
  }

  if (action === "finalize") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างบิลเท่านั้นที่ปิดบิลได้" }, { status: 403 })
    }
    if (bill.status === "finalized") return NextResponse.json({ error: "บิลนี้ปิดไปแล้วครับ" }, { status: 400 })
    await rebalance(admin, id, Number(bill.total_amount))
    await admin.from("split_bills").update({ status: "finalized" }).eq("id", id)
  }

  const detail = await loadDetail(admin, id, lineUserId)
  return NextResponse.json({ ok: true, group: detail, lineNotify })
}
