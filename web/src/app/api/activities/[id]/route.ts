import { NextRequest, NextResponse } from "next/server"
import { parseActivityInput } from "@/lib/activities/input"
import { createClient } from "@/lib/supabase/server"

const ACTIVITY_FIELDS = "id, owner_id, trip_id, group_id, title, summary, category, visibility, status, location_name, starts_at, ends_at, source_type, source_url, created_at, updated_at"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { data: current } = await supabase.from("activities").select(ACTIVITY_FIELDS).eq("id", id).maybeSingle()
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
  let input
  try {
    const patch = await req.json() as Record<string, unknown>
    input = parseActivityInput({
      title: current.title,
      summary: current.summary,
      category: current.category,
      visibility: current.visibility,
      status: current.status,
      locationName: current.location_name,
      startsAt: current.starts_at,
      endsAt: current.ends_at,
      sourceType: current.source_type,
      sourceUrl: current.source_url,
      tripId: current.trip_id,
      groupId: current.group_id,
      ...patch,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid activity" }, { status: 400 })
  }
  const { data, error } = await supabase.from("activities").update({
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
    updated_at: new Date().toISOString(),
  }).eq("id", id).select(ACTIVITY_FIELDS).maybeSingle()
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ activity: data })
}
