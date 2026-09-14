/**
 * One-click PDF of a trip.
 *
 * Renders the SAME component the /trips/[id]/print page uses to static HTML,
 * inlines the stylesheet, and hands it to the api's headless-Chrome renderer.
 * Sharing the component is the point — a downloaded PDF that differs from the
 * page it claims to be a copy of is worse than no download at all.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { buildTripDocumentHtml } from "@/lib/trips/trip-document-html"
import type { JourneyDay, ChecklistItem, TripNote, JourneyParticipant } from "@/lib/trips/journey"
import { PRINT_CSS } from "@/lib/trips/print-css"
import { internalApiError } from "@/lib/trips/internal-api"

type Params = { params: Promise<{ id: string }> }

const INTERNAL_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000"

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  // Cookie or Bearer — the iOS app sends the latter. See lib/authed-user.ts.
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(id, user.id)
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const key = process.env.INTERNAL_API_KEY
  if (!key) return NextResponse.json({ error: "ระบบสร้าง PDF ยังไม่ได้ตั้งค่า" }, { status: 503 })

  const { data: trip } = await supabase.from("life_journeys")
    .select(`
      id, title, destination, description, status, started_at, ended_at,
      base_currency, cover_emoji, notes,
      trip_participants(id, display_name, is_host, amount_owed, amount_paid)
    `)
    .eq("id", id).single()
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

  const [{ data: checklist }, { data: notes }] = await Promise.all([
    supabase.from("trip_checklist_items")
      .select("id, title, category, is_done, sort_order")
      .eq("journey_id", id).order("sort_order"),
    supabase.from("trip_notes")
      .select("id, title, body, tag, is_pinned")
      .eq("journey_id", id).order("is_pinned", { ascending: false }).order("created_at"),
  ])

  const { trip_participants, ...journeyTrip } = trip as typeof trip & {
    trip_participants: JourneyParticipant[]
  }

  const markup = buildTripDocumentHtml({
    trip: journeyTrip,
    days: (days ?? []) as unknown as JourneyDay[],
    participants: trip_participants ?? [],
    checklist: (checklist ?? []) as ChecklistItem[],
    notes: (notes ?? []) as TripNote[],
  })

  // The CSP meta is belt-and-braces: the renderer already blocks every network
  // request, and this makes the document inert even if it is opened elsewhere.
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<title>${escapeHtml(trip.title)}</title>
<style>html,body{margin:0;padding:0;background:#fff}${PRINT_CSS}</style>
</head><body>${markup}</body></html>`

  try {
    const res = await fetch(`${INTERNAL_URL}/pdf/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify({ html }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error ?? "สร้าง PDF ไม่สำเร็จ" }, { status: 502 })
    }
    const pdf = await res.arrayBuffer()

    // RFC 5987 filename* so a Thai trip title survives the header intact;
    // the plain `filename` is an ASCII fallback for older clients.
    const safe = trip.title.replace(/[/\\?%*:|"<>]/g, "-")
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          `attachment; filename="trip.pdf"; filename*=UTF-8''${encodeURIComponent(safe)}.pdf`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: internalApiError(err, "สร้าง PDF", INTERNAL_URL) }, { status: 502 })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}
