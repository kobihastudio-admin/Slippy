import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/medications?lineUserId=X — list all active medications with schedule + today's logs
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  // Fetch active medications
  const { data: meds, error: medsError } = await admin.from("medications")
    .select("id, name, brand_name, dosage_form, strength, category, purpose, is_chronic, color")
    .eq("user_id", conn.user_id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })

  if (medsError) return NextResponse.json({ error: medsError.message }, { status: 500 })
  if (!meds || meds.length === 0) return NextResponse.json({ medications: [] })

  const medIds = meds.map(m => m.id)

  // Today's date range (local Thailand time, UTC+7)
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  const [{ data: schedules }, { data: inventory }, { data: todayLogs }] = await Promise.all([
    admin.from("medication_schedules")
      .select("id, medication_id, times, days_of_week, dose_qty, unit, meal_relation, reminder_enabled, reminder_via")
      .in("medication_id", medIds),
    admin.from("medication_inventory")
      .select("id, medication_id, qty_remaining, qty_unit, low_stock_alert, expiry_date, price_per_unit")
      .in("medication_id", medIds),
    admin.from("medication_logs")
      .select("id, medication_id, schedule_id, scheduled_at, taken_at, status, notes")
      .in("medication_id", medIds)
      .gte("scheduled_at", todayStart.toISOString())
      .lte("scheduled_at", todayEnd.toISOString()),
  ])

  const scheduleMap = new Map<string, typeof schedules>()
  for (const s of (schedules ?? [])) {
    const arr = scheduleMap.get(s.medication_id) ?? []
    arr.push(s)
    scheduleMap.set(s.medication_id, arr)
  }

  type InvRow = { id: string; medication_id: string; qty_remaining: number; qty_unit: string; low_stock_alert: number; expiry_date: string | null; price_per_unit: number | null }
  const inventoryMap = new Map<string, InvRow>()
  for (const inv of (inventory ?? [])) {
    inventoryMap.set(inv.medication_id, inv)
  }

  const logsMap = new Map<string, typeof todayLogs>()
  for (const log of (todayLogs ?? [])) {
    const arr = logsMap.get(log.medication_id) ?? []
    arr.push(log)
    logsMap.set(log.medication_id, arr)
  }

  const medications = meds.map(med => ({
    ...med,
    schedules: scheduleMap.get(med.id) ?? [],
    inventory: inventoryMap.get(med.id) ?? null,
    todayLogs: logsMap.get(med.id) ?? [],
  }))

  return NextResponse.json({ medications })
}

// POST /api/liff/medications — add new medication + schedule + initial inventory
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    lineUserId: string
    name: string
    brandName?: string
    dosageForm?: string
    strength?: string
    category?: string
    purpose?: string
    isChronic?: boolean
    color?: string
    times?: string[]
    daysOfWeek?: number[]
    doseQty?: number
    unit?: string
    mealRelation?: string
    reminderEnabled?: boolean
    reminderVia?: string
    qtyRemaining?: number
    qtyUnit?: string
    lowStockAlert?: number
    expiryDate?: string
    pricePerUnit?: number
  }

  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { name } = body
  if (!name) {
    return NextResponse.json({ error: "lineUserId and name required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  // Insert medication
  const { data: med, error: medError } = await admin.from("medications").insert({
    organization_id: conn.organization_id,
    user_id: conn.user_id,
    line_user_id: lineUserId,
    name: body.name,
    brand_name: body.brandName ?? null,
    dosage_form: body.dosageForm ?? "tablet",
    strength: body.strength ?? null,
    category: body.category ?? "prescription",
    purpose: body.purpose ?? null,
    is_chronic: body.isChronic ?? false,
    is_active: true,
    color: body.color ?? "#3b82f6",
  }).select("id").single()

  if (medError || !med) return NextResponse.json({ error: medError?.message ?? "insert failed" }, { status: 500 })

  // Insert schedule if times provided
  if (body.times && body.times.length > 0) {
    await admin.from("medication_schedules").insert({
      medication_id: med.id,
      times: body.times,
      days_of_week: body.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7],
      dose_qty: body.doseQty ?? 1,
      unit: body.unit ?? "เม็ด",
      meal_relation: body.mealRelation ?? "any",
      reminder_enabled: body.reminderEnabled ?? false,
      reminder_via: body.reminderVia ?? "app",
    })
  }

  // Insert inventory if qty provided
  if (body.qtyRemaining !== undefined) {
    await admin.from("medication_inventory").insert({
      medication_id: med.id,
      qty_remaining: body.qtyRemaining,
      qty_unit: body.qtyUnit ?? body.unit ?? "เม็ด",
      low_stock_alert: body.lowStockAlert ?? 10,
      expiry_date: body.expiryDate ?? null,
      price_per_unit: body.pricePerUnit ?? null,
    })
  }

  return NextResponse.json({ ok: true, id: med.id })
}
