import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"

type Params = { params: Promise<{ id: string; noteId: string }> }

async function guard(tripId: string, req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  return { admin: createAdminClient() }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: tripId, noteId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const body = await req.json().catch(() => null) as
    { title?: string; body?: string | null; tag?: string | null; isPinned?: boolean } | null
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === "string") {
    if (!body.title.trim()) return NextResponse.json({ error: "ใส่หัวข้อโน้ตด้วย" }, { status: 400 })
    patch.title = body.title.trim()
  }
  if ("body" in body) patch.body = typeof body.body === "string" && body.body.trim() ? body.body.trim() : null
  if ("tag" in body) patch.tag = typeof body.tag === "string" && body.tag.trim() ? body.tag.trim() : null
  if (typeof body.isPinned === "boolean") patch.is_pinned = body.isPinned

  const { data: row, error } = await admin.from("trip_notes")
    .update(patch).eq("id", noteId).eq("journey_id", tripId)
    .select("id, title, body, tag, is_pinned").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: row })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId, noteId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  const { error } = await admin.from("trip_notes").delete().eq("id", noteId).eq("journey_id", tripId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
