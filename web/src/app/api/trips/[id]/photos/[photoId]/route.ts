import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"

type Params = { params: Promise<{ id: string; photoId: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId, photoId } = await params
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const admin = createAdminClient()

  const { data: photo } = await admin.from("trip_photos")
    .select("storage_path").eq("id", photoId).eq("journey_id", tripId).single()
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 })

  await admin.storage.from("trip-photos").remove([photo.storage_path])
  const { error } = await admin.from("trip_photos").delete().eq("id", photoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
