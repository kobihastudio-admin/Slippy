import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isOrgMember }       from "@/lib/require-org-member"
import { getTripAccess }  from "@/lib/trips/trip-access"
import { recordDenied }   from "@/lib/activity-log"

type Params = { params: Promise<{ id: string }> }

async function requireMember(tripId: string, userId: string) {
  const admin = createAdminClient()
  const { data: trip } = await admin.from("life_journeys").select("organization_id").eq("id", tripId).single()
  if (!trip || !(await isOrgMember(userId, trip.organization_id))) return null
  return admin
}

// GET — list itinerary days + items for a trip
export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: days, error } = await supabase.from("trip_itinerary_days")
    .select(`
      id, day_number, date, title,
      trip_itinerary_items(id, sort_order, type, title, location, notes, amount, time_from, time_to, image_url, booking_ref)
    `)
    .eq("journey_id", tripId)
    .order("day_number", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (days ?? []).map(d => ({
    id: d.id, dayNumber: d.day_number, date: d.date, title: d.title,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: ((d.trip_itinerary_items as any[]) ?? []).sort((a, b) => a.sort_order - b.sort_order),
  }))

  return NextResponse.json({ days: result })
}

// POST — add_day | add_item | remove_item | remove_day | reorder_items
export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const admin = await requireMember(tripId, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { action } = body as { action: string }

  if (action === "add_day") {
    const { title, date } = body as { title?: string; date?: string }
    const { data: existing } = await admin.from("trip_itinerary_days")
      .select("day_number").eq("journey_id", tripId).order("day_number", { ascending: false }).limit(1)
    const nextDay = (existing?.[0]?.day_number ?? 0) + 1
    const { data: newDay, error } = await admin.from("trip_itinerary_days")
      .insert({ journey_id: tripId, day_number: nextDay, title: title ?? `วันที่ ${nextDay}`, date: date ?? null })
      .select("id, day_number, date, title").single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ day: { ...newDay, items: [] } })
  }

  if (action === "add_item") {
    const { dayId, type, title, location, notes, amount, timeFrom, timeTo } = body as {
      dayId: string; type: string; title: string; location?: string; notes?: string
      amount?: number; timeFrom?: string; timeTo?: string
    }
    if (!dayId || !type || !title?.trim()) return NextResponse.json({ error: "dayId, type, title required" }, { status: 400 })
    const { data: existing } = await admin.from("trip_itinerary_items")
      .select("sort_order").eq("day_id", dayId).order("sort_order", { ascending: false }).limit(1)
    const nextSort = (existing?.[0]?.sort_order ?? 0) + 1

    // Money has to be written in BOTH currencies or not at all. `amount` is
    // what was charged and `amount_base_currency` is what totals are computed
    // from (see 20260822130000_trip_item_money_alignment.sql); the base column
    // defaults to 0, so writing only `amount` here produced an item that showed
    // its price on the timeline and ฿0 in the Budget tab.
    //
    // This endpoint has no currency field, so the amount is by definition
    // already in the trip's base currency — rate 1, base = amount. Add a
    // `currency` to the request body and this is the one place to convert.
    const { data: journey } = await admin.from("life_journeys")
      .select("base_currency").eq("id", tripId).single()

    const { data: item, error } = await admin.from("trip_itinerary_items").insert({
      day_id: dayId, sort_order: nextSort, type, title,
      location: location ?? null, notes: notes ?? null,
      amount: amount ?? 0,
      currency: journey?.base_currency ?? "THB",
      exchange_rate: 1,
      amount_base_currency: amount ?? 0,
      time_from: timeFrom ?? null, time_to: timeTo ?? null,
    }).select("id, sort_order, type, title, location, notes, amount, amount_base_currency, time_from, time_to").single()
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
