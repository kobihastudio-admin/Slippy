/**
 * Trip photos — the check-in gallery. One row per photo, optionally tied to
 * a specific itinerary item (`?itemId=`), otherwise a general trip photo.
 *
 * Uploaded into the PUBLIC `trip-photos` bucket — same posture as
 * chat-attachments (076_chat_attachments_bucket.sql): casual images, not the
 * sensitive paperwork that lives in trip-documents.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess } from "@/lib/trips/trip-access"

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 10 * 1024 * 1024
const EXT_MIME: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", heic: "heic", webp: "webp" }

async function guard(tripId: string, req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  return { admin: createAdminClient(), userId: user.id }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin } = g

  let q = admin.from("trip_photos")
    .select("id, item_id, storage_path, caption, taken_at")
    .eq("journey_id", tripId)
    .order("taken_at", { ascending: false })
  const itemId = req.nextUrl.searchParams.get("itemId")
  if (itemId) q = q.eq("item_id", itemId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const photos = (data ?? []).map(p => ({
    ...p,
    url: admin.storage.from("trip-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }))
  return NextResponse.json({ photos })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if (g.error) return g.error
  const { admin, userId } = g

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "แนบรูปด้วย" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกินไป (${(file.size / 1024 / 1024).toFixed(1)} MB) — จำกัดที่ 10 MB` },
      { status: 413 })
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase()
  if (!EXT_MIME[ext]) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์รูปภาพ" }, { status: 400 })
  }

  const itemIdRaw = form?.get("itemId")
  const itemId = typeof itemIdRaw === "string" && itemIdRaw ? itemIdRaw : null
  if (itemId) {
    const { data: item } = await admin.from("trip_itinerary_items")
      .select("id, trip_itinerary_days!inner(journey_id)")
      .eq("id", itemId).single()
    const day = (item as { trip_itinerary_days?: { journey_id?: string } } | null)?.trip_itinerary_days
    if (day?.journey_id !== tripId) {
      return NextResponse.json({ error: "รายการนี้ไม่ได้อยู่ในทริปนี้" }, { status: 400 })
    }
  }
  const captionRaw = form?.get("caption")
  const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim() : null

  const path = `${tripId}/${crypto.randomUUID()}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from("trip-photos")
    .upload(path, bytes, { contentType: file.type || undefined })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: row, error } = await admin.from("trip_photos").insert({
    journey_id: tripId, item_id: itemId, uploaded_by: userId,
    storage_path: path, caption,
  }).select("id, item_id, storage_path, caption, taken_at").single()

  if (error) {
    await admin.storage.from("trip-photos").remove([path])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const url = admin.storage.from("trip-photos").getPublicUrl(row.storage_path).data.publicUrl
  return NextResponse.json({ photo: { ...row, url } })
}
