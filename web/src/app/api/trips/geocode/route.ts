/**
 * Place lookup for the trip map — search by name, or name a dropped pin.
 *
 * Proxied through the server rather than called from the browser, for three
 * reasons that all point the same way:
 *   • the CSP would otherwise need Nominatim in connect-src, widening what
 *     every page in the app may talk to for the sake of one screen;
 *   • Nominatim's usage policy wants an identifying User-Agent, which a browser
 *     will not let a page set;
 *   • it keeps the viewer's IP and the coordinates they are looking at between
 *     this app and the tile/geocode provider, instead of every client
 *     contacting a third party directly.
 *
 * Requires a signed-in user. It is a small proxy to a shared free service, and
 * an open one would be someone else's rate limit to burn.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const NOMINATIM = "https://nominatim.openstreetmap.org"
// Nominatim asks for a real contact address so they can get in touch before
// blocking. Matches the one already used by api/src/pipeline/vendor.ts.
const USER_AGENT = "Slippy/1.0 (trip itinerary planner; contact@solutionx.co.th)"

interface Place { label: string; name: string; lat: number; lng: number; kind: string | null }

function toPlace(r: Record<string, unknown>): Place | null {
  const lat = Number(r.lat), lng = Number(r.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const display = String(r.display_name ?? "")
  const addr = (r.address ?? {}) as Record<string, string>
  // Nominatim's display_name is the full postal chain; the first segment is the
  // place itself, which is what belongs in a stop's title.
  const name = String(r.name || addr.attraction || addr.tourism || addr.amenity ||
                      addr.building || addr.road || display.split(",")[0] || "").trim()
  return { label: display, name: name || display, lat, lng, kind: (r.type as string) ?? null }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const q    = req.nextUrl.searchParams.get("q")
  const lat  = req.nextUrl.searchParams.get("lat")
  const lng  = req.nextUrl.searchParams.get("lng")
  const lang = req.nextUrl.searchParams.get("lang") ?? "th,en"

  try {
    let url: URL
    if (lat && lng) {
      // Reverse: the user dropped a pin and we need something to call it.
      url = new URL(`${NOMINATIM}/reverse`)
      url.searchParams.set("lat", lat)
      url.searchParams.set("lon", lng)
      url.searchParams.set("zoom", "18")
    } else if (q && q.trim().length >= 2) {
      url = new URL(`${NOMINATIM}/search`)
      url.searchParams.set("q", q.trim())
      url.searchParams.set("limit", "8")
      // Bias toward the map the user is looking at, when the client says where
      // that is. Without it "station" returns a station on another continent.
      const vb = req.nextUrl.searchParams.get("viewbox")
      if (vb) { url.searchParams.set("viewbox", vb); url.searchParams.set("bounded", "0") }
    } else {
      return NextResponse.json({ error: "q (min 2 chars) or lat+lng required" }, { status: 400 })
    }
    url.searchParams.set("format", "jsonv2")
    url.searchParams.set("addressdetails", "1")
    url.searchParams.set("accept-language", lang)

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `geocoder returned ${res.status}`, places: [] }, { status: 502 })
    }

    const json = await res.json()
    const rows = Array.isArray(json) ? json : [json]
    const places = rows.map(toPlace).filter((p): p is Place => p !== null)
    return NextResponse.json({ places })
  } catch (err) {
    // A geocoder that is slow or down must not break placing a pin by hand —
    // the caller falls back to letting the user type the name themselves.
    const msg = err instanceof Error ? err.message : "geocode failed"
    return NextResponse.json({ error: msg, places: [] }, { status: 502 })
  }
}
