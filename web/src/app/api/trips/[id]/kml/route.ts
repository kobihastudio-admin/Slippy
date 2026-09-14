/**
 * Download the trip as a .kml file — for Google My Maps.
 *
 * See lib/trips/trip-kml.ts for why KML rather than a Google Maps directions
 * link: a directions link caps out at 3 stops on a phone, and a trip has more
 * stops than that.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createClient } from "@/lib/supabase/server"
import { getTripAccess } from "@/lib/trips/trip-access"
import { buildTripKml } from "@/lib/trips/trip-kml"
import type { JourneyDay } from "@/lib/trips/journey"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params

  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(id, user.id)
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const supabase = await createClient()

  const { data: trip } = await supabase.from("life_journeys")
    .select("title").eq("id", id).single()
  if (!trip) return NextResponse.json({ error: "not found" }, { status: 404 })

  const { data: days } = await supabase.from("trip_itinerary_days")
    .select(`
      id, day_number, date, title, city, summary,
      trip_itinerary_items(
        id, sort_order, type, title, subtitle, location, lat, lng,
        end_location, end_lat, end_lng, time_from, time_to, starts_at, ends_at,
        status, provider, confirmation_code, notes,
        amount, currency, exchange_rate, amount_base_currency, details, expense_id, route_geometry
      )
    `)
    .eq("journey_id", id)
    .order("day_number")
    .order("sort_order", { referencedTable: "trip_itinerary_items" })

  const hasAnyPin = (days ?? []).some(d => d.trip_itinerary_items.some((i: { lat: unknown }) => i.lat != null))
  if (!hasAnyPin) {
    return NextResponse.json(
      { error: "ทริปนี้ยังไม่มีพิกัดให้ส่งออก — เพิ่มจุดในแท็บแผนที่ก่อน" }, { status: 400 })
  }

  const kml = buildTripKml({ title: trip.title, days: (days ?? []) as unknown as JourneyDay[] })

  const safe = trip.title.replace(/[/\\?%*:|"<>]/g, "-")
  return new NextResponse(kml, {
    headers: {
      "Content-Type": "application/vnd.google-earth.kml+xml",
      "Content-Disposition": `attachment; filename="trip.kml"; filename*=UTF-8''${encodeURIComponent(safe)}.kml`,
      "Cache-Control": "no-store",
    },
  })
}
