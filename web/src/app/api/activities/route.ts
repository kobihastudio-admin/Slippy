import { NextRequest, NextResponse } from "next/server"
import { parseActivityInput } from "@/lib/activities/input"
import { createClient } from "@/lib/supabase/server"

const ACTIVITY_FIELDS = "id, owner_id, trip_id, group_id, title, summary, category, visibility, status, location_name, starts_at, ends_at, source_type, source_url, created_at, updated_at"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = req.nextUrl.searchParams.get("scope") ?? "mine"
  if (!user && scope !== "explore") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["mine", "group", "explore"].includes(scope)) return NextResponse.json({ error: "Invalid scope" }, { status: 400 })

  let query = supabase.from("activities").select(ACTIVITY_FIELDS).order("starts_at", { ascending: true, nullsFirst: false })
  if (scope === "mine") query = query.eq("owner_id", user!.id)
  if (scope === "group") query = query.eq("visibility", "group")
  if (scope === "explore") query = query.eq("visibility", "public").eq("status", "published")
  const { data, error } = await query
  if (error) return NextResponse.json({ error: "Unable to load activities" }, { status: 500 })
  return NextResponse.json({ activities: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let input
  try { input = parseActivityInput(await req.json()) } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid activity" }, { status: 400 })
  }
  const { data, error } = await supabase.from("activities").insert({
    owner_id: user.id,
    trip_id: input.tripId,
    group_id: input.groupId,
    title: input.title,
    summary: input.summary,
    category: input.category,
    visibility: input.visibility,
    status: input.status,
    location_name: input.locationName,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    source_type: input.sourceType,
    source_url: input.sourceUrl,
  }).select(ACTIVITY_FIELDS).single()
  if (error || !data) return NextResponse.json({ error: "Unable to create activity" }, { status: 500 })
  return NextResponse.json({ activity: data }, { status: 201 })
}
