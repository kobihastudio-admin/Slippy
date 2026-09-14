import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/trip-groups/[id]/itinerary?lineUserId=X
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  const { data: days, error } = await admin.from("trip_itinerary_days")
    .select("id, day_number, date, title, trip_itinerary_items(id, sort_order, type, title, location, notes, amount, time_from, time_to, image_url, booking_ref)")
    .eq("split_bill_id", id)
    .order("day_number", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (days ?? []).map(d => ({
    id: d.id,
    dayNumber: d.day_number,
    date: d.date,
    title: d.title,
    items: ((d.trip_itinerary_items as any[]) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(item => ({
        id: item.id,
        sortOrder: item.sort_order,
        type: item.type,
        title: item.title,
        location: item.location,
        notes: item.notes,
        amount: item.amount ? Number(item.amount) : null,
        timeFrom: item.time_from,
        timeTo: item.time_to,
        imageUrl: item.image_url,
        bookingRef: item.booking_ref,
      })),
  }))

  return NextResponse.json({ days: result })
}

// POST /api/liff/trip-groups/[id]/itinerary
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { action } = body as { action: string; lineUserId: string }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 })

  const admin = createAdminClient()

  // Verify creator for mutating actions
  const { data: bill } = await admin.from("split_bills")
    .select("id, creator_id").eq("id", id).eq("category", "trip").maybeSingle()
  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const conn = await resolveConnection(admin, lineUserId)
  if (!conn || conn.user_id !== bill.creator_id) {
    return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่แก้ไขแผนการเดินทางได้" }, { status: 403 })
  }

  if (action === "add_day") {
    const { title, date } = body as { title?: string; date?: string }
    // Get max day_number
    const { data: existing } = await admin.from("trip_itinerary_days")
      .select("day_number").eq("split_bill_id", id).order("day_number", { ascending: false }).limit(1)
    const nextDay = ((existing?.[0]?.day_number) ?? 0) + 1
    const { data: newDay, error } = await admin.from("trip_itinerary_days")
      .insert({ split_bill_id: id, day_number: nextDay, title: title ?? `วันที่ ${nextDay}`, date: date ?? null })
      .select("id, day_number, date, title").single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ day: { ...newDay, items: [] } })
  }

  if (action === "add_item") {
    const { dayId, type, title, location, notes, amount, timeFrom, timeTo } = body as {
      dayId: string; type: string; title: string; location?: string; notes?: string
      amount?: number; timeFrom?: string; timeTo?: string
    }
    if (!dayId || !type || !title) return NextResponse.json({ error: "dayId, type, title required" }, { status: 400 })
    const { data: existing } = await admin.from("trip_itinerary_items")
      .select("sort_order").eq("day_id", dayId).order("sort_order", { ascending: false }).limit(1)
    const nextSort = ((existing?.[0]?.sort_order) ?? 0) + 1
    const { data: item, error } = await admin.from("trip_itinerary_items")
      .insert({ day_id: dayId, sort_order: nextSort, type, title, location: location ?? null, notes: notes ?? null, amount: amount ?? null, time_from: timeFrom ?? null, time_to: timeTo ?? null })
      .select("id, sort_order, type, title, location, notes, amount, time_from, time_to").single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item })
  }

  if (action === "remove_item") {
    const { itemId } = body as { itemId: string }
    if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })
    await admin.from("trip_itinerary_items").delete().eq("id", itemId)
    return NextResponse.json({ ok: true })
  }

  if (action === "remove_day") {
    const { dayId } = body as { dayId: string }
    if (!dayId) return NextResponse.json({ error: "dayId required" }, { status: 400 })
    await admin.from("trip_itinerary_items").delete().eq("day_id", dayId)
    await admin.from("trip_itinerary_days").delete().eq("id", dayId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
