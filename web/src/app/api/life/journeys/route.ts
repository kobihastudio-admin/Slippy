import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"

// GET — list journeys
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  const { data: journeys } = await supabase
    .from("life_journeys")
    .select(`
      id, title, description, journey_type, cover_emoji,
      started_at, ended_at, destination, metadata, created_at
    `)
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })

  // For each journey, count linked expenses
  const journeyIds = (journeys ?? []).map(j => j.id)
  let expenseCounts: Record<string, number> = {}
  let expenseTotals: Record<string, number> = {}
  if (journeyIds.length > 0) {
    const { data: events } = await supabase
      .from("life_events")
      .select("journey_id, amount")
      .in("journey_id", journeyIds)
      .eq("event_type", "expense")
    for (const e of events ?? []) {
      if (!e.journey_id) continue
      expenseCounts[e.journey_id] = (expenseCounts[e.journey_id] ?? 0) + 1
      expenseTotals[e.journey_id] = (expenseTotals[e.journey_id] ?? 0) + Number(e.amount ?? 0)
    }
  }

  const enriched = (journeys ?? []).map(j => ({
    ...j,
    expense_count: expenseCounts[j.id] ?? 0,
    total_spent:   expenseTotals[j.id] ?? 0,
  }))

  return NextResponse.json({ journeys: enriched })
}

// POST — create journey
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { orgId, title, description, journey_type, cover_emoji,
          started_at, ended_at, destination } = body

  if (!orgId || !title) return NextResponse.json({ error: "orgId and title required" }, { status: 400 })
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from("life_journeys").insert({
    organization_id: orgId,
    user_id:         user.id,
    title,
    description:     description ?? null,
    journey_type:    journey_type ?? "trip",
    cover_emoji:     cover_emoji ?? "✈️",
    started_at:      started_at ?? null,
    ended_at:        ended_at   ?? null,
    destination:     destination ?? null,
  }).select("id").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ journeyId: data?.id })
}

// PATCH — link expenses to journey or update journey
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { journeyId, action, eventIds, ...updates } = await req.json()
  const admin = createAdminClient()

  // Neither branch previously checked who owns `journeyId` (or which org
  // `eventIds` belong to) before mutating — any logged-in user could hijack
  // another org's expense events into their own journey, or edit any
  // journey's fields, just by guessing/enumerating ids.
  const { data: journey } = await admin.from("life_journeys").select("organization_id").eq("id", journeyId).single()
  if (!journey || !(await isOrgMember(user.id, journey.organization_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (action === "link_events" && eventIds?.length) {
    await admin.from("life_events")
      .update({ journey_id: journeyId })
      .in("id", eventIds)
      .eq("organization_id", journey.organization_id)  // can only link events from the same org
    return NextResponse.json({ ok: true })
  }

  await admin.from("life_journeys")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", journeyId)
  return NextResponse.json({ ok: true })
}

// DELETE — delete journey
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { journeyId } = await req.json()
  const admin = createAdminClient()
  const { data: journey } = await admin.from("life_journeys").select("organization_id").eq("id", journeyId).single()
  if (!journey || !(await isOrgMember(user.id, journey.organization_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  await admin.from("life_journeys").delete().eq("id", journeyId)
  return NextResponse.json({ ok: true })
}
