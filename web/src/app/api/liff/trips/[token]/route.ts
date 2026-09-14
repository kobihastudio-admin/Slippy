/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * LIFF-facing endpoint for the multi-payer trip expense system
 * (life_journeys/trip_participants/trip_expenses/expense_splits — migrations
 * 030, 060). Mirrors the dashboard's /api/trips/[id]/* routes but resolves
 * identity from a verified LINE userId (via middleware.ts) instead of a
 * Supabase session, and looks the trip up by its public share_token rather
 * than its internal id — same pattern as /api/liff/trip-groups/[id].
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"
import { createTripExpense, type SplitMode } from "@/lib/trip-settlement"

async function loadDetail(admin: ReturnType<typeof createAdminClient>, token: string, lineUserId?: string | null) {
  const { data: trip } = await admin.from("life_journeys")
    .select(`
      id, title, trip_type, sport_type, destination, venue, event_date,
      status, share_token, base_fee, cover_emoji, notes, line_group_id,
      trip_participants(id, display_name, is_host, line_user_id, amount_owed, amount_paid,
                         promptpay_type, promptpay_value, qr_image_url)
    `)
    .eq("share_token", token)
    .maybeSingle()

  if (!trip) return null

  const participants = (trip.trip_participants as any[]).map(p => ({
    id: p.id, displayName: p.display_name, isHost: p.is_host,
    amountOwed: Number(p.amount_owed), amountPaid: Number(p.amount_paid),
    promptpayType: p.promptpay_type, promptpayValue: p.promptpay_value, qrImageUrl: p.qr_image_url,
    isMe: lineUserId ? p.line_user_id === lineUserId : false,
  }))

  const { data: expenses } = await admin.from("trip_expenses")
    .select(`
      id, title, amount, category, split_mode, split_values, note, expense_date,
      paid_by_id,
      trip_participants!trip_expenses_paid_by_id_fkey(id, display_name),
      expense_splits(participant_id, amount, is_paid)
    `)
    .eq("journey_id", trip.id)
    .order("expense_date", { ascending: false })

  const { data: settlement } = await admin.rpc("calculate_trip_settlement", { p_journey_id: trip.id })

  const { data: preorderSessions } = await admin.from("preorder_sessions")
    .select("id, title, kind, status, created_at, paid_by_id, preorder_items(id, participant_id, name, price, qty, trip_participants(display_name))")
    .eq("journey_id", trip.id)
    .order("created_at", { ascending: false })

  return {
    id: trip.id, title: trip.title, tripType: trip.trip_type, destination: trip.destination,
    venue: trip.venue, eventDate: trip.event_date, status: trip.status, shareToken: trip.share_token,
    coverEmoji: trip.cover_emoji, notes: trip.notes,
    participants,
    expenses: (expenses ?? []).map((e: any) => ({
      id: e.id, title: e.title, amount: Number(e.amount), category: e.category,
      splitMode: e.split_mode, splitValues: e.split_values ?? {}, note: e.note, expenseDate: e.expense_date,
      paidById: e.paid_by_id, paidByName: e.trip_participants?.display_name,
      splits: (e.expense_splits ?? []).map((s: any) => ({ participantId: s.participant_id, amount: Number(s.amount), isPaid: s.is_paid })),
    })),
    settlement: (settlement ?? []).map((s: any) => ({
      fromId: s.from_id, fromName: s.from_name, toId: s.to_id, toName: s.to_name, amount: Number(s.amount),
    })),
    preorderSessions: (preorderSessions ?? []).map((s: any) => ({
      id: s.id, title: s.title, kind: s.kind, status: s.status, paidById: s.paid_by_id,
      items: (s.preorder_items ?? []).map((it: any) => ({
        id: it.id, participantId: it.participant_id, participantName: it.trip_participants?.display_name,
        name: it.name, price: Number(it.price), qty: it.qty,
      })),
    })),
  }
}

// Fire-and-forget push to the trip's LINE group — mirrors notifyPreorder()
// in the dashboard's api/trips/preorder/[sessionId] route.
async function notifyPreorder(body: {
  sessionId: string; event: "item_added" | "item_removed" | "closed"
  participantName?: string; itemName?: string; price?: number; totalAmount?: number
}) {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) return
  try {
    await fetch(`${process.env.API_BASE_URL}/trips/preorder/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error("[liff-preorder:notify] failed:", err)
  }
}

// GET /api/liff/trips/[token] — trip + participants + expenses + settlement
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const lineUserId = getVerifiedLineUserId(req, req.nextUrl.searchParams.get("lineUserId"))

  const admin = createAdminClient()
  const detail = await loadDetail(admin, token, lineUserId)
  if (!detail) return NextResponse.json({ error: "ไม่พบทริปนี้" }, { status: 404 })

  return NextResponse.json({ trip: detail })
}

// POST /api/liff/trips/[token] — actions: join | addExpense | recordPayment | confirmPayment
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json() as {
    action: "join" | "addExpense" | "recordPayment" | "confirmPayment"
      | "openPreorder" | "addPreorderItem" | "removePreorderItem" | "closePreorder" | "cancelPreorder"
    lineUserId: string
    displayName?: string
    // addExpense
    title?: string; amount?: number; category?: string; note?: string
    paidById?: string; splitMode?: SplitMode
    splitWith?: string[]; splitValues?: Record<string, number>
    currency?: string; exchangeRate?: number
    // recordPayment
    fromParticipantId?: string; toParticipantId?: string; payAmount?: number; payNote?: string
    // confirmPayment
    paymentId?: string
    // preorder
    sessionId?: string; kind?: "food" | "shopping"
    itemName?: string; price?: number; qty?: number; itemId?: string
  }

  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  const admin = createAdminClient()
  const { data: trip } = await admin.from("life_journeys")
    .select("id, status").eq("share_token", token).maybeSingle()
  if (!trip) return NextResponse.json({ error: "ไม่พบทริปนี้" }, { status: 404 })
  if (trip.status === "settled" || trip.status === "cancelled") {
    return NextResponse.json({ error: "ทริปนี้ปิดแล้วครับ" }, { status: 400 })
  }

  const { data: me } = await admin.from("trip_participants")
    .select("id, line_user_id").eq("journey_id", trip.id).eq("line_user_id", lineUserId).maybeSingle()

  if (body.action === "join") {
    if (!me) {
      await admin.from("trip_participants").insert({
        journey_id: trip.id, display_name: body.displayName ?? "ผู้เข้าร่วม",
        line_user_id: lineUserId, is_non_line: false, amount_owed: 0, amount_paid: 0,
      })
    }
  }

  if (body.action === "addExpense") {
    if (!me) return NextResponse.json({ error: "ต้องเข้าร่วมทริปนี้ก่อนถึงจะเพิ่มรายจ่ายได้" }, { status: 403 })
    if (!body.title?.trim() || !body.amount || !body.paidById) {
      return NextResponse.json({ error: "title, amount, paidById required" }, { status: 400 })
    }

    try {
      await createTripExpense({
        tripId: trip.id, paidById: body.paidById, title: body.title, amount: body.amount,
        category: body.category, splitMode: body.splitMode, splitWith: body.splitWith,
        splitValues: body.splitValues, note: body.note,
        currency: body.currency, exchangeRate: body.exchangeRate,
      }, admin)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "หารเงินไม่สำเร็จ" }, { status: 400 })
    }
  }

  if (body.action === "recordPayment") {
    if (!body.fromParticipantId || !body.toParticipantId || !body.payAmount) {
      return NextResponse.json({ error: "fromParticipantId, toParticipantId, payAmount required" }, { status: 400 })
    }
    if (!me || me.id !== body.fromParticipantId) {
      return NextResponse.json({ error: "บันทึกการจ่ายได้แค่ของตัวเองเท่านั้น" }, { status: 403 })
    }
    await admin.from("trip_payments").insert({
      journey_id: trip.id, from_participant: body.fromParticipantId, to_participant: body.toParticipantId,
      amount: body.payAmount, note: body.payNote ?? null, status: "pending",
    })
  }

  // ── Pre-order (self-service — every participant adds their OWN items) ──────
  if (body.action === "openPreorder") {
    if (!me) return NextResponse.json({ error: "ต้องเข้าร่วมทริปนี้ก่อน" }, { status: 403 })
    if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 })
    await admin.from("preorder_sessions").insert({
      journey_id: trip.id, title: body.title, kind: body.kind ?? "food",
    })
  }

  if (body.action === "addPreorderItem") {
    if (!me) return NextResponse.json({ error: "ต้องเข้าร่วมทริปนี้ก่อนถึงจะเพิ่มรายการได้" }, { status: 403 })
    if (!body.sessionId || !body.itemName?.trim() || !body.price) {
      return NextResponse.json({ error: "sessionId, itemName, price required" }, { status: 400 })
    }
    const { data: session } = await admin.from("preorder_sessions").select("status").eq("id", body.sessionId).single()
    if (session?.status !== "open") return NextResponse.json({ error: "รอบนี้ปิดรับออเดอร์แล้ว" }, { status: 400 })

    // Always tags the item to the LIFF caller's OWN participant record —
    // this is the self-service path, unlike the dashboard's admin-facing
    // version which can add on behalf of anyone.
    await admin.from("preorder_items").insert({
      session_id: body.sessionId, participant_id: me.id,
      name: body.itemName, price: body.price, qty: body.qty ?? 1,
    })
    notifyPreorder({ sessionId: body.sessionId, event: "item_added", participantName: undefined, itemName: body.itemName, price: body.price })
  }

  if (body.action === "removePreorderItem") {
    if (!me || !body.itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })
    // Only your own item — same self-service boundary as adding.
    const { data: item } = await admin.from("preorder_items")
      .select("id, name, session_id, participant_id").eq("id", body.itemId).single()
    if (!item || item.participant_id !== me.id) {
      return NextResponse.json({ error: "ลบได้เฉพาะรายการของตัวเองเท่านั้น" }, { status: 403 })
    }
    await admin.from("preorder_items").delete().eq("id", body.itemId)
    notifyPreorder({ sessionId: item.session_id, event: "item_removed", itemName: item.name })
  }

  if (body.action === "closePreorder") {
    if (!me || !body.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    if (!body.paidById) return NextResponse.json({ error: "ระบุคนที่จ่ายเงินไปก่อน" }, { status: 400 })

    const { data: session } = await admin.from("preorder_sessions").select("status, title, kind").eq("id", body.sessionId).single()
    if (session?.status !== "open") return NextResponse.json({ error: "รอบนี้ปิดไปแล้ว" }, { status: 400 })

    const { data: items } = await admin.from("preorder_items")
      .select("participant_id, price, qty").eq("session_id", body.sessionId)
    if (!items?.length) return NextResponse.json({ error: "ยังไม่มีใครสั่งเลย" }, { status: 400 })

    const totals: Record<string, number> = {}
    for (const it of items) totals[it.participant_id] = (totals[it.participant_id] ?? 0) + Number(it.price) * it.qty
    const grandTotal = Math.round(Object.values(totals).reduce((s, v) => s + v, 0) * 100) / 100

    try {
      const expenseId = await createTripExpense({
        tripId: trip.id, paidById: body.paidById, title: session.title,
        amount: grandTotal, category: session.kind === "shopping" ? "other" : "food",
        splitMode: "individual", splitWith: Object.keys(totals), splitValues: totals,
        note: "รวมจากรายการที่แต่ละคนสั่งเอง",
      }, admin)
      await admin.from("preorder_sessions").update({
        status: "closed", paid_by_id: body.paidById, expense_id: expenseId, closed_at: new Date().toISOString(),
      }).eq("id", body.sessionId)
      notifyPreorder({ sessionId: body.sessionId, event: "closed", totalAmount: grandTotal })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "ปิดรับออเดอร์ไม่สำเร็จ" }, { status: 400 })
    }
  }

  if (body.action === "cancelPreorder") {
    if (!body.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    await admin.from("preorder_sessions").update({ status: "cancelled" }).eq("id", body.sessionId)
  }

  if (body.action === "confirmPayment") {
    if (!body.paymentId) return NextResponse.json({ error: "paymentId required" }, { status: 400 })
    const { data: payment } = await admin.from("trip_payments")
      .select("id, from_participant, to_participant, amount").eq("id", body.paymentId).maybeSingle()
    if (!payment) return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 })
    if (!me || me.id !== payment.to_participant) {
      return NextResponse.json({ error: "ยืนยันได้แค่ผู้รับเงินเท่านั้น" }, { status: 403 })
    }
    await admin.from("trip_payments").update({
      status: "confirmed", confirmed_at: new Date().toISOString(),
    }).eq("id", body.paymentId)

    const { data: p } = await admin.from("trip_participants")
      .select("amount_paid").eq("id", payment.from_participant).single()
    await admin.from("trip_participants").update({
      amount_paid: Number(p?.amount_paid ?? 0) + Number(payment.amount),
      paid_at: new Date().toISOString(),
    }).eq("id", payment.from_participant)
  }

  const detail = await loadDetail(admin, token, lineUserId)
  return NextResponse.json({ ok: true, trip: detail })
}
