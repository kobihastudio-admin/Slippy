import { getMembership } from "@/lib/get-membership"
import { createClient }  from "@/lib/supabase/server"
import { notFound }      from "next/navigation"
import { TripPrintClient } from "@/components/trips/trip-print-client"
import { buildTripDocumentHtml } from "@/lib/trips/trip-document-html"
import type { JourneyDay, ChecklistItem, TripNote, JourneyParticipant } from "@/lib/trips/journey"

/**
 * The printable trip document.
 *
 * Its own route rather than a dialog, so it can be opened in a tab, bookmarked,
 * shared with a travel companion, and printed without the app chrome around it.
 * `?print=1` opens the browser's print dialog on arrival — that is the link the
 * "Export PDF" button uses.
 *
 * Same participant-scoped access as the trip page: RLS decides, and a row that
 * comes back is one this user may see.
 */
export default async function TripPrintPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ print?: string }>
}) {
  const { id } = await params
  const { print } = await searchParams
  await getMembership()
  const supabase = await createClient()

  const { data: trip } = await supabase.from("life_journeys")
    .select(`
      id, title, destination, description, status, started_at, ended_at,
      base_currency, cover_emoji, notes,
      trip_participants(id, display_name, is_host, amount_owed, amount_paid)
    `)
    .eq("id", id).single()
  if (!trip) notFound()

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

  const html = buildTripDocumentHtml({
    trip: journeyTrip,
    days: (days ?? []) as unknown as JourneyDay[],
    participants: trip_participants ?? [],
    checklist: (checklist ?? []) as ChecklistItem[],
    notes: (notes ?? []) as TripNote[],
  })

  return (
    <TripPrintClient
      tripId={trip.id}
      tripTitle={trip.title}
      html={html}
      autoPrint={print === "1"}
    />
  )
}
