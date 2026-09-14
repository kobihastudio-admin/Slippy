import { getMembership } from "@/lib/get-membership"
import { createClient }  from "@/lib/supabase/server"
import { notFound }      from "next/navigation"
import { TripJourneyClient, type JourneyTrip } from "@/components/trips/trip-journey-client"
import type { JourneyDay, ChecklistItem, TripNote, JourneyParticipant, TripDocument, TripPhoto } from "@/lib/trips/journey"
import { tripFeatures } from "@/lib/trips/trip-features"

/**
 * The trip screen — the Journey design running on real rows.
 *
 * Not filtered by organization_id any more. Migration 094 moved the trip tables
 * to participant-scoped RLS to match getTripAccess(): a trip belongs to whoever
 * is actually on it, and a friend invited to a trip is not necessarily a member
 * of the organization that owns it. The org filter that used to sit here would
 * have hidden the trip from exactly those people, so RLS is left to decide and
 * a row that comes back is a row this user is allowed to see.
 *
 * The full expense manager lives at ./expenses.
 */
export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await getMembership()          // still required: unauthenticated users get bounced
  const supabase = await createClient()

  // Profile-sharing migration 096 is now part of the deployed Journey schema.
  // Read the fields here (rather than issuing a client-side follow-up query) so
  // the first Crew render never flashes initials before its selected avatar.
  const { data: trip } = await supabase.from("life_journeys")
    .select(`
      id, title, destination, description, status, started_at, ended_at,
      base_currency, cover_emoji, notes,
      trip_participants(id, display_name, avatar_url, trip_role,
                        profile_shared_with_trip, is_host, amount_owed, amount_paid)
    `)
    .eq("id", id)
    .single()

  if (!trip) notFound()

  // The whole itinerary in one round trip. Ordering is done here rather than in
  // the client because the client renders it in three different ways and none of
  // them should have to re-sort.
  const { data: days } = await supabase.from("trip_itinerary_days")
    .select(`
      id, day_number, date, title, city, summary,
      trip_itinerary_items(
        id, sort_order, type, title, subtitle, location, lat, lng,
        end_location, end_lat, end_lng, time_from, time_to, starts_at, ends_at,
        status, provider, confirmation_code, notes,
        amount, currency, exchange_rate, amount_base_currency, details, expense_id, route_geometry,
        checked_in_at, checked_in_by
      )
    `)
    .eq("journey_id", id)
    .order("day_number")
    .order("sort_order", { referencedTable: "trip_itinerary_items" })

  const [{ data: checklist }, { data: notes }, { data: documents }, { data: photoRows }] = await Promise.all([
    supabase.from("trip_checklist_items")
      .select("id, title, category, is_done, sort_order")
      .eq("journey_id", id).order("sort_order"),
    supabase.from("trip_notes")
      .select("id, title, body, tag, is_pinned")
      .eq("journey_id", id).order("is_pinned", { ascending: false }).order("created_at"),
    supabase.from("trip_documents")
      .select("id, kind, title, file_path, file_type, file_size, created_at")
      .eq("journey_id", id).order("created_at", { ascending: false }),
    supabase.from("trip_photos")
      .select("id, item_id, storage_path, caption, taken_at")
      .eq("journey_id", id).order("taken_at", { ascending: false }),
  ])

  const photos: TripPhoto[] = (photoRows ?? []).map(p => ({
    ...p,
    url: supabase.storage.from("trip-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }))

  const { trip_participants, ...journeyTrip } = trip as typeof trip & {
    trip_participants: JourneyParticipant[]
  }

  return (
    <TripJourneyClient
      trip={journeyTrip as JourneyTrip}
      days={(days ?? []) as unknown as JourneyDay[]}
      participants={trip_participants ?? []}
      checklist={(checklist ?? []) as ChecklistItem[]}
      notes={(notes ?? []) as TripNote[]}
      documents={(documents ?? []) as TripDocument[]}
      photos={photos}
      // trip-features.ts reads process.env directly, which is only safe in
      // server code — this page is the server component in the tree, so the
      // resolved booleans are passed down rather than the client component
      // reading tripFeatures itself (that would either throw on undefined
      // envs in the client bundle or silently read `undefined`, always off).
      featureLiveLocation={tripFeatures.liveLocation}
      featureCalls={tripFeatures.calls}
    />
  )
}
