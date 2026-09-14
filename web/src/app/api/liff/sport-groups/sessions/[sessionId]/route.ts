import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadSessionDetail, rebalance, resolveConnection, isRegistrationClosed } from "../../_lib"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

// Call to api/sport/notify — pushes pay/unpay/finalize/rosterUpdate cards
// back into the LINE group chat where the sport group was created. No-op
// server-side if the bill has no line_group_id (LIFF-only group).
//
// Returns a diagnostic result instead of swallowing everything — fetch()
// only rejects on network-level failures, never on non-2xx HTTP responses,
// so a misconfigured INTERNAL_API_KEY or a Fastify-side error would
// otherwise fail completely silently (no exception, nothing logged). Call
// sites that need to surface this to the client (addParticipant, removeGuest)
// await it and include the result in the JSON response; others may still
// fire-and-forget by simply not awaiting.
type NotifyResult = { attempted: boolean; ok?: boolean; status?: number; skipped?: string; error?: string }
async function notifySportGroup(
  billId: string, event: "pay" | "unpay" | "finalize" | "sendBill" | "rosterUpdate", lineUserId: string,
): Promise<NotifyResult> {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) {
    return { attempted: false, skipped: "API_BASE_URL or INTERNAL_API_KEY not set on the web server" }
  }
  try {
    const res = await fetch(`${process.env.API_BASE_URL}/sport/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
      body: JSON.stringify({ billId, event, lineUserId }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error("[sport-notify] non-OK response:", res.status, data)
      return { attempted: true, ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}` }
    }
    return { attempted: true, ok: true, skipped: data?.skipped }
  } catch (err: any) {
    console.error("[sport-notify] failed:", err.message)
    return { attempted: true, ok: false, error: err.message }
  }
}

// GET /api/liff/sport-groups/sessions/[sessionId]?lineUserId=Uxxx — session detail + participants
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const admin = createAdminClient()

  const detail = await loadSessionDetail(admin, sessionId, lineUserId)
  if (!detail) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  return NextResponse.json({ group: detail })
}

// POST /api/liff/sport-groups/sessions/[sessionId] — actions: join | pay | unpay | finalize | setGuests | sendBill | setAmount | approvePayment | rejectPayment
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const body = await req.json() as {
    action:      "join" | "pay" | "unpay" | "finalize" | "setGuests" | "sendBill" | "setAmount" | "approvePayment" | "rejectPayment" | "setPromptPay" | "addParticipant" | "removeGuest"
    lineUserId:  string
    displayName?: string
    guestCount?:  number
    participantId?: string
    amount?:      number
    promptpayId?: string
    friendUserId?: string  // addParticipant — invite a friend already in Slippy
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action, displayName, guestCount, participantId, amount, promptpayId, friendUserId } = body
  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 })

  let lineNotify: NotifyResult | undefined
  const admin = createAdminClient()
  const { data: bill } = await admin.from("split_bills")
    .select("id, status, total_amount, category, booking_date, start_time, end_time, line_group_id, creator_id")
    .eq("id", sessionId).eq("category", "sport").maybeSingle()

  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const isCreator = async () => {
    const conn = await resolveConnection(admin, lineUserId)
    return !!conn && conn.user_id === bill.creator_id
  }

  if (action === "sendBill") {
    if (!await isCreator()) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ส่งบิลได้" }, { status: 403 })
    }
    if (!bill.line_group_id) return NextResponse.json({ error: "เซสชันนี้ไม่ได้เชื่อมกับกลุ่ม LINE" }, { status: 400 })
    notifySportGroup(sessionId, "sendBill", lineUserId)
    const detail = await loadSessionDetail(admin, sessionId, lineUserId)
    return NextResponse.json({ ok: true, group: detail })
  }

  // Set an individual participant's amount directly — used when costs/items
  // differ per person and an even split (rebalance) doesn't apply.
  if (action === "setAmount") {
    if (!await isCreator()) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ปรับยอดได้" }, { status: 403 })
    }
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    if (!participantId || amount === undefined || amount < 0) {
      return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 })
    }
    await admin.from("split_participants")
      .update({ amount: Math.round(amount * 100) / 100 })
      .eq("id", participantId).eq("split_bill_id", sessionId)
    const detail = await loadSessionDetail(admin, sessionId, lineUserId)
    return NextResponse.json({ ok: true, group: detail })
  }

  // "เข้าร่วม" — re-sends the roster card to the LINE group every time it's
  // pressed, even on a repeat tap from someone already in the list. Tapping
  // it again is a reasonable way to ask "who's in right now?", especially
  // once the chat history has scrolled past the last card.
  if (action === "join") {
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    if (isRegistrationClosed(bill.booking_date, bill.start_time, bill.end_time)) {
      return NextResponse.json({ error: "เกินกำหนดการลงทะเบียนแล้วครับ" }, { status: 400 })
    }
    const { data: existing } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()
    if (!existing) {
      await admin.from("split_participants").insert({
        split_bill_id: sessionId, name: displayName ?? "ผู้เข้าร่วม",
        line_user_id: lineUserId, line_display: displayName, is_non_line: false, amount: 0,
        guest_count: Math.max(0, Math.min(guestCount ?? 0, 5)),
      })
      await rebalance(admin, sessionId, Number(bill.total_amount))
    }
    lineNotify = bill.line_group_id
      ? await notifySportGroup(sessionId, "rosterUpdate", lineUserId)
      : { attempted: false, skipped: "session has no line_group_id — not linked to a LINE group" }
  }

  // Creator adds a friend already in Slippy directly as a participant — skips
  // the join-link flow since their identity (and LINE connection, if any) is
  // already known. Validated against the creator's accepted friendships.
  if (action === "addParticipant") {
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่เพิ่มผู้เข้าร่วมได้" }, { status: 403 })
    }
    if (!friendUserId) return NextResponse.json({ error: "friendUserId required" }, { status: 400 })

    const { data: friendship } = await admin.from("friendships")
      .select("id")
      .eq("status", "accepted")
      .or(`and(requester_id.eq.${conn.user_id},addressee_id.eq.${friendUserId}),and(requester_id.eq.${friendUserId},addressee_id.eq.${conn.user_id})`)
      .maybeSingle()
    if (!friendship) return NextResponse.json({ error: "ไม่พบเพื่อนคนนี้ในระบบ" }, { status: 400 })

    const { data: existing } = await admin.from("split_participants")
      .select("id, line_user_id").eq("split_bill_id", sessionId)
    const [{ data: friendUser }, { data: friendConn }] = await Promise.all([
      admin.from("users").select("full_name").eq("id", friendUserId).maybeSingle(),
      admin.from("line_connections").select("line_user_id, display_name").eq("user_id", friendUserId).maybeSingle(),
    ])
    // Prefer the LINE display name (set when they ran /connect, always
    // current) over users.full_name, which is only ever populated from
    // signup metadata and is commonly null for LINE-first accounts.
    const friendName = friendConn?.display_name ?? friendUser?.full_name ?? "เพื่อน"
    const alreadyIn = friendConn?.line_user_id && (existing ?? []).some(p => p.line_user_id === friendConn.line_user_id)
    if (!alreadyIn) {
      await admin.from("split_participants").insert({
        split_bill_id: sessionId, name: friendName,
        line_user_id: friendConn?.line_user_id ?? null,
        is_non_line: !friendConn?.line_user_id, amount: 0, guest_count: 0,
      })
      await rebalance(admin, sessionId, Number(bill.total_amount))
      lineNotify = bill.line_group_id
        ? await notifySportGroup(sessionId, "rosterUpdate", lineUserId)
        : { attempted: false, skipped: "session has no line_group_id — not linked to a LINE group" }
    }
  }

  // Remove/cancel a participant — allowed only for: whoever added that guest
  // (added_by_participant_id), or the participant themselves ("ยกเลิกการ
  // เข้าร่วม" — self-cancel). Someone who joined on their own can't be
  // removed by anyone else, not even the bill creator.
  if (action === "removeGuest") {
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })

    const { data: target } = await admin.from("split_participants")
      .select("id, added_by_participant_id").eq("id", participantId).eq("split_bill_id", sessionId).maybeSingle()
    if (!target) return NextResponse.json({ error: "ไม่พบผู้เข้าร่วม" }, { status: 404 })

    const { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()
    const isMyGuest = !!target.added_by_participant_id && target.added_by_participant_id === me?.id
    const isSelf    = !!me && me.id === target.id
    if (!isMyGuest && !isSelf) {
      return NextResponse.json({ error: "ลบได้แค่ตัวเอง หรือคนที่คุณเพิ่มเข้ามาเท่านั้น — คนที่เข้าร่วมเองไม่มีสิทธิ์ลบ" }, { status: 403 })
    }

    await admin.from("split_participants").delete().eq("id", participantId)
    await rebalance(admin, sessionId, Number(bill.total_amount))
    lineNotify = bill.line_group_id
      ? await notifySportGroup(sessionId, "rosterUpdate", lineUserId)
      : { attempted: false, skipped: "session has no line_group_id — not linked to a LINE group" }
  }

  // Update my own "+1" guest count (e.g. "8. ฟิว +1")
  if (action === "setGuests") {
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
    const { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()
    if (!me) return NextResponse.json({ error: "คุณยังไม่ได้เข้าร่วมกลุ่มนี้" }, { status: 400 })
    await admin.from("split_participants")
      .update({ guest_count: Math.max(0, Math.min(guestCount ?? 0, 5)) })
      .eq("id", me.id)
    await rebalance(admin, sessionId, Number(bill.total_amount))
  }

  if (action === "pay" || action === "unpay") {
    let { data: me } = await admin.from("split_participants")
      .select("id").eq("split_bill_id", sessionId).eq("line_user_id", lineUserId).maybeSingle()

    // First-time visitors (haven't pressed "เข้าร่วมกลุ่มนี้" yet) — auto-join
    // them on the spot so "จ่ายเงิน" doesn't hard-fail with a 400.
    if (!me) {
      if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดแล้วครับ" }, { status: 400 })
      if (isRegistrationClosed(bill.booking_date, bill.start_time, bill.end_time)) {
        return NextResponse.json({ error: "เกินกำหนดการลงทะเบียนแล้วครับ" }, { status: 400 })
      }
      const { data: inserted } = await admin.from("split_participants").insert({
        split_bill_id: sessionId, name: displayName ?? "ผู้เข้าร่วม",
        line_user_id: lineUserId, line_display: displayName, is_non_line: false, amount: 0,
      }).select("id").single()
      await rebalance(admin, sessionId, Number(bill.total_amount))
      me = inserted
    }

    if (!me) return NextResponse.json({ error: "เข้าร่วมกลุ่มไม่สำเร็จ" }, { status: 400 })
    await admin.from("split_participants")
      .update({ paid_at: action === "pay" ? new Date().toISOString() : null })
      .eq("id", me.id)
  }

  // Host reviews an uploaded slip — approve marks the participant as paid,
  // reject clears the slip so they can re-upload.
  if (action === "approvePayment" || action === "rejectPayment") {
    if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ตรวจสอบสลิปได้" }, { status: 403 })
    }
    const { data: target } = await admin.from("split_participants")
      .select("id, payment_proof_url").eq("id", participantId).eq("split_bill_id", sessionId).maybeSingle()
    if (!target) return NextResponse.json({ error: "ไม่พบผู้เข้าร่วม" }, { status: 404 })

    if (action === "approvePayment") {
      await admin.from("split_participants")
        .update({ paid_at: new Date().toISOString() })
        .eq("id", participantId)
    } else {
      if (target.payment_proof_url) {
        for (const ext of ["jpg", "png", "webp"]) {
          await admin.storage.from("payment-proofs").remove([`${sessionId}/${participantId}.${ext}`])
        }
      }
      await admin.from("split_participants")
        .update({ payment_proof_url: null, paid_at: null })
        .eq("id", participantId)
    }
  }

  // Host sets/updates this session's PromptPay ID (used to generate the
  // dynamic QR shown to participants). Falls back to the recurring group's
  // PromptPay ID when null.
  if (action === "setPromptPay") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ตั้งค่า PromptPay ได้" }, { status: 403 })
    }
    await admin.from("split_bills")
      .update({ promptpay_id: promptpayId?.trim() || null })
      .eq("id", sessionId)
  }

  if (action === "finalize") {
    if (!await isCreator()) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ปิดกลุ่มได้" }, { status: 403 })
    }
    if (bill.status === "finalized") return NextResponse.json({ error: "กลุ่มนี้ปิดไปแล้วครับ" }, { status: 400 })
    await admin.from("split_bills").update({ status: "finalized" }).eq("id", sessionId)
  }

  // Push a "KhunThong-style" update card back into the LINE group chat (if this
  // sport group was created from one) — fire-and-forget, never block the response.
  if (action === "pay" || action === "unpay" || action === "finalize") {
    notifySportGroup(sessionId, action, lineUserId)
  }

  const detail = await loadSessionDetail(admin, sessionId, lineUserId)
  return NextResponse.json({ ok: true, group: detail, lineNotify })
}

// DELETE /api/liff/sport-groups/sessions/[sessionId]?lineUserId=Uxxx — delete a
// standalone session (e.g. duplicate created during testing). Only the creator
// may delete it. Cascades to split_participants/session_expenses.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const { data: bill } = await admin.from("split_bills")
    .select("id, creator_id")
    .eq("id", sessionId).eq("category", "sport").maybeSingle()
  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const conn = await resolveConnection(admin, lineUserId)
  if (!conn || conn.user_id !== bill.creator_id) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ลบกลุ่มนี้" }, { status: 403 })
  }

  await admin.from("split_bills").delete().eq("id", sessionId)

  return NextResponse.json({ ok: true })
}
