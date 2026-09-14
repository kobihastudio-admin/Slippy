/**
 * Trip notes — write side. trip_notes itself and its RLS ("tn_participant",
 * FOR ALL) already existed from the journey-structure migration; only a
 * read-only display existed on top of it (trip-journey-client.tsx). This is
 * the CRUD API that was missing.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"

type Params = { params: Promise<{ id: string }> }

async function guard(tripId: string, req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  return { admin: createAdminClient() }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const { data, error } = await admin.from("trip_notes")
    .select("id, title, body, tag, is_pinned")
    .eq("journey_id", tripId)
    .order("is_pinned", { ascending: false }).order("created_at")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const body = await req.json().catch(() => null) as
    { title?: string; body?: string; tag?: string; isPinned?: boolean } | null
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "ใส่หัวข้อโน้ตด้วย" }, { status: 400 })
  }

  const { data: row, error } = await admin.from("trip_notes").insert({
    journey_id: tripId,
    title: body.title.trim(),
    body: typeof body.body === "string" && body.body.trim() ? body.body.trim() : null,
    tag: typeof body.tag === "string" && body.tag.trim() ? body.tag.trim() : null,
    is_pinned: body.isPinned === true,
  }).select("id, title, body, tag, is_pinned").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: row })
}
