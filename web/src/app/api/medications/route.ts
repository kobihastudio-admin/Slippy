import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"

// GET — identity, current course, stable dose slots, inventory and today's doses.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [medsRes, logsRes] = await Promise.all([
    supabase.from("medications")
      .select(`
        id, name, brand_name, generic_name, dosage_form, strength,
        category, purpose, is_chronic, is_active, color, notes, image_url, created_at,
        provider_id, doctor_instructions, prescribed_by,
        provider:medical_providers(id, name, type, hn),
        medication_courses(
          id, status, start_date, planned_end_date, actual_end_at, prescribed_by,
          doctor_instructions, instruction_source, resume_review_at,
          medication_dose_slots(id, time_value, period_label, dose_qty, meal_relation, meal_note, sort_order, reminder_enabled, is_active),
          medication_course_events(id, action, from_status, to_status, effective_at, reason, confirmed_by, created_at)
        ),
        medication_schedules(id, course_id, times, days_of_week, dose_qty, meal_relation, meal_note, reminder_enabled, is_active, is_bedtime),
        medication_inventory(id, qty_remaining, qty_unit, qty_per_pack, low_stock_alert, expiry_date, price_per_unit, loc_code, lot_no)
      `)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at"),

    // Today's logs
    supabase.from("medication_logs")
      .select("id, medication_id, course_id, slot_id, scheduled_at, taken_at, status, dose_taken")
      .eq("user_id", user.id)
      .gte("scheduled_at", new Date().toISOString().slice(0, 10) + "T00:00:00+07:00")
      .lte("scheduled_at", new Date().toISOString().slice(0, 10) + "T23:59:59+07:00")
      .order("scheduled_at"),
  ])

  return NextResponse.json({
    medications: medsRes.data ?? [],
    todayLogs:   logsRes.data ?? [],
  })
}

// POST — create medication + schedule + inventory
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    name:          string
    brand_name?:   string
    generic_name?: string
    dosage_form?:  string
    strength?:     string
    category?:     string
    purpose?:      string
    is_chronic?:   boolean
    notes?:        string
    doctor_instructions?: string
    instruction_source?: "label" | "doctor" | "pharmacist" | "user"
    prescribed_by?: string
    color?:        string
    provider_id?:  string
    // Schedule
    times:         string[]
    days_of_week?: number[] | null
    dose_qty:      number
    meal_relation?: string
    meal_note?:    string
    reminder_enabled?: boolean
    reminder_minutes?: number
    start_date?:   string
    is_bedtime?:   boolean
    planned_end_date?: string | null
    // Inventory
    qty_total:     number
    qty_unit?:     string
    qty_per_pack?: number
    low_stock_alert?: number
    expiry_date?:  string
    price_per_unit?: number
    loc_code?:     string
    lot_no?:       string
  }

  const admin = createAdminClient()

  // 1. Create medication
  const { data: med, error: medErr } = await admin.from("medications").insert({
    user_id:      user.id,
    name:         body.name,
    brand_name:   body.brand_name ?? null,
    generic_name: body.generic_name ?? null,
    dosage_form:  body.dosage_form ?? "tablet",
    strength:     body.strength ?? null,
    category:     body.category ?? "general",
    purpose:      body.purpose ?? null,
    is_chronic:   body.is_chronic ?? false,
    notes:        body.notes ?? null,
    color:        body.color ?? null,
    provider_id:         body.provider_id ?? null,
    doctor_instructions: body.doctor_instructions ?? null,
    prescribed_by:       body.prescribed_by ?? null,
  }).select("id").single()

  if (medErr || !med) return NextResponse.json({ error: medErr?.message }, { status: 500 })

  // 2. Create the treatment course. Label OCR is kept verbatim here while
  // `medications.notes` remains the person's own note.
  const { data: course, error: courseErr } = await admin.from("medication_courses").insert({
    medication_id: med.id,
    user_id: user.id,
    status: "active",
    start_date: body.start_date ?? new Date().toISOString().slice(0, 10),
    planned_end_date: body.planned_end_date ?? null,
    prescribed_by: body.prescribed_by ?? null,
    doctor_instructions: body.doctor_instructions ?? null,
    instruction_source: body.instruction_source ?? "user",
  }).select("id").single()
  if (courseErr || !course) {
    await admin.from("medications").delete().eq("id", med.id).eq("user_id", user.id)
    return NextResponse.json({ error: courseErr?.message }, { status: 500 })
  }

  const { data: schedule, error: scheduleErr } = await admin.from("medication_schedules").insert({
    medication_id:    med.id,
    course_id:        course.id,
    user_id:          user.id,
    times:            body.times ?? ["08:00"],
    days_of_week:     body.days_of_week ?? null,
    dose_qty:         body.dose_qty ?? 1,
    meal_relation:    body.meal_relation ?? "any",
    meal_note:        body.meal_note ?? null,
    reminder_enabled: body.reminder_enabled ?? true,
    reminder_minutes: body.reminder_minutes ?? 0,
    start_date:       body.start_date ?? new Date().toISOString().slice(0, 10),
    is_bedtime:       body.is_bedtime ?? false,
    is_active:        true,
  }).select("id").single()

  const slotRows = (body.times ?? ["08:00"]).map((time, index) => ({
    course_id: course.id,
    user_id: user.id,
    time_value: time,
    period_label: time >= "21:00" ? "bedtime" : time < "11:00" ? "morning" : time < "16:00" ? "midday" : "evening",
    dose_qty: body.dose_qty ?? 1,
    meal_relation: body.meal_relation ?? "any",
    meal_note: body.meal_note ?? null,
    sort_order: index,
    reminder_enabled: body.reminder_enabled ?? true,
  }))
  const { error: slotErr } = await admin.from("medication_dose_slots").insert(slotRows)

  // 3. Create inventory
  const { error: inventoryErr } = await admin.from("medication_inventory").insert({
    medication_id:  med.id,
    user_id:        user.id,
    qty_remaining:  body.qty_total ?? 0,
    qty_unit:       body.qty_unit ?? "เม็ด",
    qty_per_pack:   body.qty_per_pack ?? null,
    low_stock_alert: body.low_stock_alert ?? 7,
    expiry_date:    body.expiry_date ?? null,
    price_per_unit: body.price_per_unit ?? null,
    loc_code:       body.loc_code ?? null,
    lot_no:         body.lot_no ?? null,
    last_purchased_at: new Date().toISOString().slice(0, 10),
    last_purchased_qty: body.qty_total ?? 0,
  })

  if (scheduleErr || slotErr || inventoryErr || !schedule) {
    // The medication was not visible to callers before this request. Removing
    // this newly-created course/root compensates dependent inserts. This path
    // only applies before a course can have user-visible history.
    await admin.from("medication_courses").delete().eq("id", course.id).eq("user_id", user.id)
    await admin.from("medications").delete().eq("id", med.id).eq("user_id", user.id)
    return NextResponse.json({ error: scheduleErr?.message ?? slotErr?.message ?? inventoryErr?.message }, { status: 500 })
  }

  return NextResponse.json({ medicationId: med.id, courseId: course.id })
}

// PATCH — update log status (taken/skipped)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { logId, status, note } = await req.json() as {
    logId:   string
    status:  "taken" | "skipped" | "late"
    note?:   string
  }

  const admin = createAdminClient()
  await admin.from("medication_logs").update({
    status,
    taken_at:  status !== "skipped" ? new Date().toISOString() : null,
    note:      note ?? null,
    confirmed_via: "app",
  }).eq("id", logId).eq("user_id", user.id)

  // Update inventory if taken
  if (status === "taken" || status === "late") {
    const { data: log } = await admin.from("medication_logs")
      .select("medication_id, dose_taken").eq("id", logId).single()
    if (log) {
      const { data: inv } = await admin.from("medication_inventory")
        .select("qty_remaining").eq("medication_id", log.medication_id).eq("user_id", user.id).single()
      if (inv) {
        const newQty = Math.max(0, Number(inv.qty_remaining) - Number(log.dose_taken ?? 1))
        await admin.from("medication_inventory").update({ qty_remaining: newQty, updated_at: new Date().toISOString() })
          .eq("medication_id", log.medication_id).eq("user_id", user.id)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
