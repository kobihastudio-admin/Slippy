import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

type HealthType =
  | "weight" | "blood_pressure_systolic" | "blood_pressure_diastolic"
  | "blood_glucose" | "steps" | "sleep_hours" | "heart_rate" | "hrv"
  | "water_ml" | "calories"

// Resolve a LINE userId → { user_id, organization_id } via line_connections.
async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/health?lineUserId=Uxxx — health entries (last 30 days) + longevity score
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const [{ data: entries }, { data: profile }] = await Promise.all([
    admin.from("health_entries")
      .select("id, type, value, unit, notes, recorded_at")
      .eq("user_id", conn.user_id)
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: false })
      .limit(50),
    admin.from("personal_profiles")
      .select("longevity_score")
      .eq("user_id", conn.user_id)
      .maybeSingle(),
  ])

  return NextResponse.json({
    entries: entries ?? [],
    longevityScore: profile?.longevity_score ?? 0,
  })
}

// POST /api/liff/health — add a health_entries row
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    lineUserId: string
    type:       HealthType
    value:      number
    unit?:      string
    notes?:     string
    recordedAt?: string
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { type, value, unit, notes, recordedAt } = body
  if (!type || value === undefined) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 })
  }

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  const { error } = await admin.from("health_entries").insert({
    user_id:     conn.user_id,
    type,
    value,
    unit:        unit ?? null,
    notes:       notes?.trim() || null,
    recorded_at: recordedAt ?? new Date().toISOString(),
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
