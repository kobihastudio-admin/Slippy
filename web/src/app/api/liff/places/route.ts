import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }         from "@/lib/supabase/admin"
import { resolveConnection }         from "@/app/api/liff/sport-groups/_lib"
import { resolveGoogleMapsLink, PLACE_CATEGORIES } from "./_lib"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

function present(row: any) {
  const meta = PLACE_CATEGORIES[row.category] ?? PLACE_CATEGORIES.other
  return {
    id:       row.id,
    name:     row.name,
    category: row.category,
    label:    meta.label,
    emoji:    meta.emoji,
    address:  row.address,
    lat:      row.latitude,
    lng:      row.longitude,
    mapsUrl:  row.maps_url,
    photoUrl: row.photo_url,
  }
}

export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const q          = req.nextUrl.searchParams.get("q")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ไม่พบบัญชีที่เชื่อมต่อ — กรุณาเชื่อมต่อบัญชีก่อน" }, { status: 404 })

  let query = admin.from("saved_places")
    .select("*")
    .eq("organization_id", conn.organization_id)
    .order("created_at", { ascending: false })
    .limit(50)

  if (q) query = query.ilike("name", `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ places: (data ?? []).map(present) })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    lineUserId: string
    action: "resolve" | "create"
    mapsUrl?: string
    name?: string
    category?: string
    address?: string
    lat?: number
    lng?: number
    photoUrl?: string
  }

  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action } = body

  if (action === "resolve") {
    if (!body.mapsUrl) return NextResponse.json({ error: "mapsUrl required" }, { status: 400 })

    const resolved = await resolveGoogleMapsLink(body.mapsUrl)
    if (!resolved.name && resolved.lat == null) {
      return NextResponse.json({ error: "ไม่สามารถอ่านข้อมูลจากลิงก์นี้ได้ กรุณากรอกเอง", mapsUrl: resolved.mapsUrl })
    }
    return NextResponse.json(resolved)
  }

  if (action === "create") {
    if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 })

    const admin = createAdminClient()
    const conn  = await resolveConnection(admin, lineUserId)
    if (!conn) return NextResponse.json({ error: "ไม่พบบัญชีที่เชื่อมต่อ — กรุณาเชื่อมต่อบัญชีก่อน" }, { status: 404 })

    const { data, error } = await admin.from("saved_places").insert({
      organization_id: conn.organization_id,
      creator_id:       conn.user_id,
      name:             body.name,
      category:         body.category && PLACE_CATEGORIES[body.category] ? body.category : "other",
      address:          body.address ?? null,
      latitude:         body.lat ?? null,
      longitude:        body.lng ?? null,
      maps_url:         body.mapsUrl ?? null,
      photo_url:        body.photoUrl ?? null,
    }).select("*").single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(present(data))
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from("saved_places").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
