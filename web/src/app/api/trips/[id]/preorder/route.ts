import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isOrgMember }       from "@/lib/require-org-member"
import { getTripAccess }  from "@/lib/trips/trip-access"
import { recordDenied }   from "@/lib/activity-log"

type Params = { params: Promise<{ id: string }> }

// GET — list pre-order sessions for a trip (open + closed history)
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

  const { data: sessions } = await supabase.from("preorder_sessions")
    .select(`
      id, title, kind, status, created_at, closed_at,
      paid_by:trip_participants!preorder_sessions_paid_by_id_fkey(id, display_name),
      preorder_items(id, participant_id, name, price, qty)
    `)
    .eq("journey_id", tripId)
    .order("created_at", { ascending: false })

  return NextResponse.json({ sessions: sessions ?? [] })
}

// POST — open a new pre-order session
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

  const admin = createAdminClient()
  const { data: trip } = await admin.from("life_journeys").select("organization_id").eq("id", tripId).single()
  if (!trip || !(await isOrgMember(user.id, trip.organization_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json() as { title: string; kind?: "food" | "shopping" }
  if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 })

  const { data: session, error } = await admin.from("preorder_sessions").insert({
    journey_id: tripId,
    title:      body.title,
    kind:       body.kind ?? "food",
    created_by: user.id,
  }).select("id").single()

  if (error || !session) return NextResponse.json({ error: error?.message ?? "เปิดรับออเดอร์ไม่สำเร็จ" }, { status: 500 })
  return NextResponse.json({ sessionId: session.id })
}
