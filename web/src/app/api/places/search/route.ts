/**
 * Name search for the trip map's search bar — "type a name, get suggestions
 * with photos", the one thing the existing places endpoints don't cover:
 *   • /api/places is Nearby Search (category/radius), not name search.
 *   • /api/trips/geocode is name search, but via free Nominatim — no photos,
 *     no ratings, so a place found there would need a second lookup anyway.
 *
 * Same Google key, same place_cache table, same upsert pattern as
 * /api/places — see that file's Step 3 for the sibling implementation this
 * one is deliberately kept parallel to.
 */
import type { NextRequest } from "next/server"
import { toSearchResult, type GoogleTextSearchResult } from "@/lib/places/search"

const GOOGLE_TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json"
const GOOGLE_KEY = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""

export async function GET(req: NextRequest) {
  const { NextResponse } = await import("next/server")
  const q   = req.nextUrl.searchParams.get("q")?.trim()
  const lat = req.nextUrl.searchParams.get("lat")
  const lng = req.nextUrl.searchParams.get("lng")

  if (!q || q.length < 2) {
    return NextResponse.json({ error: "q (min 2 chars) required", results: [] }, { status: 400 })
  }
  if (!GOOGLE_KEY()) {
    return NextResponse.json({ results: [], has_google_key: false })
  }

  const url = new URL(GOOGLE_TEXT_SEARCH)
  url.searchParams.set("query", q)
  url.searchParams.set("language", "th")
  url.searchParams.set("key", GOOGLE_KEY())
  if (lat && lng) {
    // Bias, not restrict — a 50km radius nudges results toward the trip's
    // area without hiding a place the user is deliberately searching for
    // outside it (e.g. planning tomorrow's city while still in today's).
    url.searchParams.set("location", `${lat},${lng}`)
    url.searchParams.set("radius", "50000")
  }

  const { createAdminClient } = await import("@/lib/supabase/admin")
  const admin = createAdminClient()
  try {
    const gRes = await fetch(url.toString())
    const gData = await gRes.json() as { results: GoogleTextSearchResult[]; status: string }

    if (gData.status !== "OK" && gData.status !== "ZERO_RESULTS") {
      console.error("[places/search] Google API status:", gData.status)
      return NextResponse.json({ error: `Google: ${gData.status}`, results: [] }, { status: 502 })
    }

    const results = (gData.results ?? []).map(r => toSearchResult(r, GOOGLE_KEY()))

    // Cache every result (fire-and-forget, same posture as /api/places).
    for (const r of results) {
      try {
        await admin.from("place_cache").upsert({
          google_place_id: r.id, name: r.name, place_type: r.type,
          address: r.address, latitude: r.lat, longitude: r.lng,
          rating: r.rating, user_ratings_total: r.user_ratings,
          photo_url: r.photo_url, price_level: r.price_level,
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        }, { onConflict: "google_place_id" })
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ results, has_google_key: true })
  } catch (err: any) {
    console.error("[places/search] error:", err.message)
    return NextResponse.json({ error: err.message, results: [] }, { status: 502 })
  }
}
