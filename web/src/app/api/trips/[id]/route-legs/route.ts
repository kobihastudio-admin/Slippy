/**
 * Compute and store the drawn path for a trip's transport legs.
 *
 * POST { itemIds?: string[] } — routes the named legs, or every stale leg in the
 * trip when the list is omitted. Returns the geometry so the caller can draw it
 * without a second read.
 *
 * Runs on the server rather than in the browser for the usual three reasons:
 * the CSP would otherwise need the router in connect-src, the answer is cached
 * in the database where every client benefits, and the routing provider sees one
 * server instead of every viewer.
 *
 * A leg that cannot be routed is not an error. It gets a direct line, which is
 * the correct drawing for a flight, a ferry or a rail hop regardless, and the
 * stored `provider` records which kind of line it is.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"
import { buildRoute, isStale, type RouteGeometry } from "@/lib/trips/routing"

type Params = { params: Promise<{ id: string }> }

/** Enough legs for a long trip, few enough to bound one request's fan-out. */
const MAX_LEGS = 40

interface LegRow {
  id: string
  type: string
  lat: number | null
  lng: number | null
  end_lat: number | null
  end_lng: number | null
  route_geometry: RouteGeometry | null
  trip_itinerary_days: { journey_id: string } | null
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params

  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as { itemIds?: string[] } | null

  // Only legs — a stop with one coordinate has no path to draw.
  let query = admin.from("trip_itinerary_items")
    .select("id, type, lat, lng, end_lat, end_lng, route_geometry, trip_itinerary_days!inner(journey_id)")
    .eq("trip_itinerary_days.journey_id", tripId)
    .not("lat", "is", null)
    .not("end_lat", "is", null)
    .limit(MAX_LEGS)

  if (Array.isArray(body?.itemIds) && body.itemIds.length) {
    query = query.in("id", body.itemIds.slice(0, MAX_LEGS))
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const legs = (data ?? []) as unknown as LegRow[]
  const routed: Record<string, RouteGeometry> = {}
  let computed = 0

  for (const leg of legs) {
    if (leg.lat == null || leg.lng == null || leg.end_lat == null || leg.end_lng == null) continue
    const from: [number, number] = [leg.lat, leg.lng]
    const to:   [number, number] = [leg.end_lat, leg.end_lng]

    // Already correct for where the pins are now — leave it alone. This is what
    // keeps a map render from being a burst of routing requests.
    if (!isStale(leg.route_geometry, from, to)) {
      routed[leg.id] = leg.route_geometry!
      continue
    }

    // Sequential, not Promise.all: this fans out to someone else's routing
    // service, and forty simultaneous requests is how a free service decides to
    // stop answering. A trip's legs are tens, not thousands.
    const route = await buildRoute(leg.type, from, to)
    const { error: writeErr } = await admin.from("trip_itinerary_items")
      .update({ route_geometry: route }).eq("id", leg.id)
    // A failed write is not fatal — the caller still gets the geometry and the
    // next request will simply compute it again.
    if (writeErr) console.warn("[route-legs] could not store route", leg.id, writeErr.message)

    routed[leg.id] = route
    computed++
  }

  return NextResponse.json({ routes: routed, computed, total: legs.length })
}
