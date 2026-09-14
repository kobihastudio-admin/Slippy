import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"
import { ensureTripConversation, postTripSystemMessage } from "@/lib/trips/trip-conversation"

function generateShareToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

// GET — list trips for an org
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  const { data: trips } = await supabase
    .from("life_journeys")
    .select(`
      id, title, trip_type, sport_type, destination, venue,
      event_date, started_at, ended_at, status, split_mode,
      share_token, base_fee, cover_emoji, notes, created_at,
      trip_participants(id, display_name, amount_owed, amount_paid, is_host, promptpay_type, qr_image_url)
    `)
    .eq("organization_id", orgId)
    // trip_type defaults to 'general' (never actually null), so the old
    // `.not("trip_type", "is", null)` filter matched every life_journeys
    // row regardless of type — including plain Life Graph entries (event/
    // experience/milestone/business) created via /api/life/journeys, which
    // showed up here as phantom zero-participant "general" trips. trip_type
    // is only meaningful when journey_type='trip' (enforced by the
    // life_journeys_trip_type_requires_trip_journey CHECK constraint) —
    // filtering on journey_type directly is the correct, and only correct, way to
    // scope this list to actual bill-splitting trips.
    .eq("journey_type", "trip")
    .order("created_at", { ascending: false })

  const enriched = (trips ?? []).map(t => ({
    ...t,
    participant_count: (t.trip_participants as any[]).length,
    total_owed: (t.trip_participants as any[]).reduce((s, p) => s + Number(p.amount_owed), 0),
    total_paid: (t.trip_participants as any[]).reduce((s, p) => s + Number(p.amount_paid), 0),
  }))

  return NextResponse.json({ trips: enriched })
}

// POST — create a new trip/activity/food order
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    orgId:        string
    title:        string
    trip_type:    "travel" | "food_order" | "sport" | "general"
    sport_type?:  string
    destination?: string
    venue?:       string
    event_date?:  string
    started_at?:  string
    ended_at?:    string
    split_mode:   "equal" | "individual" | "custom"
    base_fee?:    number
    cover_emoji?: string
    notes?:       string
    base_currency?: string   // defaults to THB — see migration 073
    participants: Array<{
      display_name:    string
      line_user_id?:   string
      is_host?:        boolean
      promptpay_type?: string
      promptpay_value?: string
    }>
  }

  const { orgId, title, trip_type, participants, ...rest } = body
  if (!orgId || !title || !trip_type) {
    return NextResponse.json({ error: "orgId, title, trip_type required" }, { status: 400 })
  }
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()

  // Create journey
  const { data: journey, error: jErr } = await admin.from("life_journeys").insert({
    organization_id: orgId,
    user_id:         user.id,
    title,
    trip_type,
    sport_type:      rest.sport_type ?? null,
    destination:     rest.destination ?? null,
    venue:           rest.venue ?? null,
    event_date:      rest.event_date ?? null,
    started_at:      rest.started_at ?? null,
    ended_at:        rest.ended_at ?? null,
    split_mode:      rest.split_mode ?? "equal",
    base_fee:        rest.base_fee ?? 0,
    base_currency:   rest.base_currency ?? "THB",
    cover_emoji:     rest.cover_emoji ?? (trip_type === "travel" ? "✈️" : trip_type === "sport" ? "🏸" : trip_type === "food_order" ? "🍽️" : "💰"),
    notes:           rest.notes ?? null,
    // trip_type (travel/food_order/sport/general) is only meaningful when
    // journey_type='trip' — matches create_trip_full's RPC convention.
    // "event"/other journey_types are created via the journeys endpoint
    // directly, not here.
    journey_type:    "trip",
    share_token:     generateShareToken(),
    status:          "active",
  }).select("id, share_token").single()

  if (jErr || !journey) return NextResponse.json({ error: jErr?.message }, { status: 500 })

  // Create participants
  if (participants?.length) {
    await admin.from("trip_participants").insert(
      participants.map(p => ({
        journey_id:      journey.id,
        display_name:    p.display_name,
        line_user_id:    p.line_user_id ?? null,
        is_host:         p.is_host ?? false,
        is_non_line:     !p.line_user_id,
        promptpay_type:  p.promptpay_type ?? null,
        promptpay_value: p.promptpay_value ?? null,
        amount_owed:     0,
        amount_paid:     0,
      }))
    )
  }

  // Give the trip its group chat (Phase 1 — handoff §9). Best-effort: a chat
  // that failed to appear is recoverable at any time via
  // POST /api/trips/[id]/conversation, whereas failing the whole request would
  // throw away a journey and its participants that are already committed.
  let conversationId: string | null = null
  try {
    const conv = await ensureTripConversation(journey.id, user.id)
    conversationId = conv.conversationId
    await postTripSystemMessage({
      journeyId: journey.id,
      event:     "trip_created",
      body:      `สร้างทริป “${title}” แล้ว`,
      detail:    { title, trip_type },
      actorId:   user.id,
    })
  } catch (err) {
    console.error("[trips] conversation setup failed:", (err as Error).message)
  }

  return NextResponse.json({
    tripId: journey.id,
    shareToken: journey.share_token,
    conversationId,
  })
}
