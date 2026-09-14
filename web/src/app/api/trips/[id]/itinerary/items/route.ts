/**
 * Itinerary items, edited from the map.
 *
 * PATCH — move a pin, retime a stop, rename it, change its day, reorder it.
 * POST  — add a stop at a dropped point.
 * DELETE— remove one.
 *
 * Every write goes through getTripAccess() on the service-role client, the same
 * gate the rest of the trip API uses: a trip belongs to whoever is on it, which
 * is not the same set as the owning organization's members.
 *
 * The item id is verified to belong to THIS trip before anything is written.
 * Without that check, a valid trip id plus somebody else's item id would let a
 * participant edit an itinerary they are not on — the id alone is not authority.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"

type Params = { params: Promise<{ id: string }> }

/** Columns a client is allowed to set. Anything else in the body is ignored. */
const EDITABLE = [
  "title", "subtitle", "type", "status", "location", "notes",
  "lat", "lng", "end_location", "end_lat", "end_lng",
  "time_from", "time_to", "provider", "confirmation_code",
] as const

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Reject coordinates that are not coordinates before they reach the database. */
function validCoords(lat: unknown, lng: unknown): boolean {
  return isNum(lat) && isNum(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

async function guard(tripId: string, req: NextRequest) {
  // getAuthedUser, not auth.getUser: the iOS app sends a Bearer token and has
  // no cookie jar, so a cookie-only check works in the browser and rejects
  // every request from the phone.
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  return { admin: createAdminClient(), userId: user.id }
}

const SELECT_COLUMNS = "id, day_id, sort_order, type, title, subtitle, location, lat, lng, end_location, end_lat, end_lng, time_from, time_to, status, provider, confirmation_code, notes, amount, currency, exchange_rate, amount_base_currency, details, expense_id, starts_at, ends_at, checked_in_at, checked_in_by"

/** Is this item actually part of this trip? */
async function itemBelongs(admin: ReturnType<typeof createAdminClient>, tripId: string, itemId: string) {
  const { data } = await admin
    .from("trip_itinerary_items")
    .select("id, trip_itinerary_days!inner(journey_id)")
    .eq("id", itemId)
    .single()
  const day = (data as { trip_itinerary_days?: { journey_id?: string } } | null)?.trip_itinerary_days
  return day?.journey_id === tripId
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.itemId !== "string") {
    return NextResponse.json({ error: "itemId required" }, { status: 400 })
  }
  if (!(await itemBelongs(admin, tripId, body.itemId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) patch[k] = body[k]

  // A pin is moved as a pair. Accepting one half would leave a row whose
  // latitude belongs to the new place and longitude to the old one.
  if ("lat" in patch || "lng" in patch) {
    if (!validCoords(patch.lat, patch.lng)) {
      return NextResponse.json({ error: "lat and lng must be sent together and be valid" }, { status: 400 })
    }
  }
  if (("end_lat" in patch || "end_lng" in patch) && patch.end_lat !== null) {
    if (!validCoords(patch.end_lat, patch.end_lng)) {
      return NextResponse.json({ error: "end_lat and end_lng must be sent together and be valid" }, { status: 400 })
    }
  }

  // Moving a stop to another day, or reordering within one.
  if (typeof body.dayId === "string") {
    const { data: day } = await admin.from("trip_itinerary_days")
      .select("id").eq("id", body.dayId).eq("journey_id", tripId).single()
    if (!day) return NextResponse.json({ error: "day not in this trip" }, { status: 400 })
    patch.day_id = body.dayId
  }
  if (isNum(body.sortOrder)) patch.sort_order = body.sortOrder

  // Check-in — the timestamp and who is server-computed, never taken from the
  // client, the same way a login timestamp would be.
  if (typeof body.checkedIn === "boolean") {
    patch.checked_in_at = body.checkedIn ? new Date().toISOString() : null
    patch.checked_in_by = body.checkedIn ? g.userId : null
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 })
  }

  const { data: item, error } = await admin.from("trip_itinerary_items")
    .update(patch).eq("id", body.itemId)
    .select(SELECT_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.dayId !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "dayId and title required" }, { status: 400 })
  }
  const { data: day } = await admin.from("trip_itinerary_days")
    .select("id").eq("id", body.dayId).eq("journey_id", tripId).single()
  if (!day) return NextResponse.json({ error: "day not in this trip" }, { status: 400 })

  if (body.lat != null && !validCoords(body.lat, body.lng)) {
    return NextResponse.json({ error: "invalid coordinates" }, { status: 400 })
  }

  // Append to the end of the day unless a position was asked for.
  const { data: last } = await admin.from("trip_itinerary_items")
    .select("sort_order").eq("day_id", body.dayId)
    .order("sort_order", { ascending: false }).limit(1)
  const sortOrder = isNum(body.sortOrder) ? body.sortOrder : (last?.[0]?.sort_order ?? -1) + 1

  // Money in both currencies or not at all — see the alignment migration.
  const { data: journey } = await admin.from("life_journeys")
    .select("base_currency").eq("id", tripId).single()
  const amount = isNum(body.amount) ? body.amount : 0

  const { data: item, error } = await admin.from("trip_itinerary_items").insert({
    day_id:     body.dayId,
    sort_order: sortOrder,
    type:       typeof body.type === "string" ? body.type : "activity",
    title:      body.title.trim(),
    subtitle:   typeof body.subtitle === "string" ? body.subtitle : null,
    location:   typeof body.location === "string" ? body.location : null,
    lat: body.lat ?? null, lng: body.lng ?? null,
    time_from:  typeof body.timeFrom === "string" ? body.timeFrom : null,
    time_to:    typeof body.timeTo   === "string" ? body.timeTo   : null,
    status:     typeof body.status === "string" ? body.status : "planned",
    notes:      typeof body.notes === "string" ? body.notes : null,
    amount,
    currency:   journey?.base_currency ?? "THB",
    exchange_rate: 1,
    amount_base_currency: amount,
  }).select(SELECT_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const itemId = req.nextUrl.searchParams.get("itemId")
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })
  if (!(await itemBelongs(admin, tripId, itemId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const { error } = await admin.from("trip_itinerary_items").delete().eq("id", itemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
