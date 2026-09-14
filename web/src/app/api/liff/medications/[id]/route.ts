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

// PATCH /api/liff/medications/[id] — update is_active or basic fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as { lineUserId: string; is_active?: boolean }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  const { error } = await admin.from("medications")
    .update({ is_active: body.is_active ?? true })
    .eq("id", id)
    .eq("user_id", conn.user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/liff/medications/[id] — soft-delete (set is_active=false)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  const { error } = await admin.from("medications")
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", conn.user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST /api/liff/medications/[id] — actions: log_taken | log_skipped | update_inventory
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    action: "log_taken" | "log_skipped" | "update_inventory"
    lineUserId: string
    scheduledAt?: string
    notes?: string
    qtyRemaining?: number
    expiryDate?: string
  }

  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action } = body
  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "ยังไม่ได้เชื่อมบัญชี LINE" }, { status: 404 })

  // Verify medication belongs to user
  const { data: med } = await admin.from("medications")
    .select("id")
    .eq("id", id)
    .eq("user_id", conn.user_id)
    .maybeSingle()
  if (!med) return NextResponse.json({ error: "ไม่พบยา" }, { status: 404 })

  if (action === "log_taken" || action === "log_skipped") {
    const scheduledAt = body.scheduledAt ?? new Date().toISOString()
    const status = action === "log_taken" ? "taken" : "skipped"

    // Get schedule to find dose_qty
    const { data: schedule } = await admin.from("medication_schedules")
      .select("id, dose_qty")
      .eq("medication_id", id)
      .maybeSingle()

    // Upsert log (avoid duplicates for same scheduled_at)
    const { error: logError } = await admin.from("medication_logs").upsert({
      medication_id: id,
      schedule_id: schedule?.id ?? null,
      user_id: conn.user_id,
      scheduled_at: scheduledAt,
      taken_at: action === "log_taken" ? new Date().toISOString() : null,
      status,
      notes: body.notes?.trim() || null,
    }, { onConflict: "medication_id,scheduled_at" })

    if (logError) return NextResponse.json({ error: logError.message }, { status: 500 })

    // Decrement inventory if taken
    if (action === "log_taken" && schedule?.dose_qty) {
      const { data: inv } = await admin.from("medication_inventory")
        .select("id, qty_remaining")
        .eq("medication_id", id)
        .maybeSingle()
      if (inv && inv.qty_remaining !== null) {
        const newQty = Math.max(0, Number(inv.qty_remaining) - Number(schedule.dose_qty))
        await admin.from("medication_inventory")
          .update({ qty_remaining: newQty })
          .eq("id", inv.id)
      }
    }

    return NextResponse.json({ ok: true })
  }

  if (action === "update_inventory") {
    const updates: Record<string, unknown> = {}
    if (body.qtyRemaining !== undefined) updates.qty_remaining = body.qtyRemaining
    if (body.expiryDate !== undefined) updates.expiry_date = body.expiryDate

    // Upsert inventory row
    const { data: existing } = await admin.from("medication_inventory")
      .select("id")
      .eq("medication_id", id)
      .maybeSingle()

    if (existing) {
      await admin.from("medication_inventory").update(updates).eq("id", existing.id)
    } else {
      await admin.from("medication_inventory").insert({
        medication_id: id,
        qty_remaining: body.qtyRemaining ?? 0,
        qty_unit: "เม็ด",
        low_stock_alert: 10,
        expiry_date: body.expiryDate ?? null,
      })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
