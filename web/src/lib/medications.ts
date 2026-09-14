/**
 * Editing and removing a medication — the two capabilities the original
 * /api/medications route never had (GET only lists, POST only creates, and
 * its PATCH updates a dose LOG's status, not the medication itself).
 *
 * Framework-agnostic and injectable (`db?: MedicationsDb`) on purpose, the
 * same shape as trip-conversation.ts's `db?: TripDb` — so the logic that
 * actually matters (soft-delete, update-by-id-not-reinsert) can be tested
 * with an in-memory fake instead of a live Supabase project. See
 * medications.test.mjs.
 *
 * DEACTIVATE IS A SOFT DELETE, NEVER A HARD ONE
 * medication_schedules/medication_inventory/medication_logs all reference
 * medications with ON DELETE CASCADE (031_medication_tracking.sql), so a real
 * `.delete()` would silently erase someone's entire dose-taking history the
 * moment they removed one entry — exactly what the iOS app used to do before
 * this fix (HealthViewModel.deleteMedication). `is_active = false` matches
 * what /api/liff/medications/[id]'s DELETE already did correctly.
 */

export interface MedicationsDb {
  from(table: string): {
    update(patch: Record<string, unknown>): {
      eq(col: string, val: string): {
        eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }>
      }
    }
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
  }
}

async function defaultDb(): Promise<MedicationsDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient() as unknown as MedicationsDb
}

export interface MedicationPatch {
  name: string
  brand_name?: string | null
  generic_name?: string | null
  dosage_form?: string
  strength?: string | null
  purpose?: string | null
  notes?: string | null
  provider_id?: string | null
  doctor_instructions?: string | null
  // Reuses medications.prescribed_by as the doctor-name column — same
  // dead-column reuse decision made for iOS (see the medication-tracking-
  // expansion plan's Global Constraints; zero references anywhere before
  // this plan touched it, so no new doctor_name column was added).
  prescribed_by?: string | null
  // Schedule — update the row at scheduleId if given, else insert a new one
  // only when there's actually a schedule to insert (non-empty times).
  scheduleId?: string
  times?: string[]
  days_of_week?: number[] | null
  dose_qty?: number
  meal_relation?: string
  meal_note?: string | null
  reminder_enabled?: boolean
  is_bedtime?: boolean
  // Inventory — same update-by-id-or-insert shape.
  inventoryId?: string
  qty_remaining?: number
  qty_unit?: string
  qty_per_pack?: number | null
  low_stock_alert?: number
  expiry_date?: string | null
  loc_code?: string | null
  lot_no?: string | null
}

/**
 * Edits a medication in place. Every write is scoped to `.eq("user_id", userId)`
 * in addition to RLS — defense in depth, matching the LIFF route's own
 * `.eq("user_id", conn.user_id)` pattern — so this can never touch a row that
 * belongs to someone else, even if called with the wrong id.
 *
 * Schedule/inventory are UPDATED by their own id when the caller has one
 * (the normal edit path — a medication created through either add-flow
 * always gets both), and only INSERTED when there is genuinely none yet, so
 * medication_logs.schedule_id never points at a row this call replaced out
 * from under it.
 */
export async function updateMedication(
  id: string,
  userId: string,
  patch: MedicationPatch,
  db?: MedicationsDb,
): Promise<void> {
  const admin = db ?? await defaultDb()

  const { error: medErr } = await admin.from("medications").update({
    name:         patch.name,
    brand_name:   patch.brand_name || null,
    generic_name: patch.generic_name || null,
    dosage_form:  patch.dosage_form ?? "tablet",
    strength:     patch.strength || null,
    purpose:      patch.purpose || null,
    notes:        patch.notes || null,
    provider_id:         patch.provider_id || null,
    doctor_instructions: patch.doctor_instructions || null,
    prescribed_by:       patch.prescribed_by || null,
  }).eq("id", id).eq("user_id", userId)
  if (medErr) throw new Error(medErr.message)

  if (patch.scheduleId) {
    await admin.from("medication_schedules").update({
      times:            patch.times ?? ["08:00"],
      days_of_week:     patch.days_of_week ?? null,
      dose_qty:         patch.dose_qty ?? 1,
      meal_relation:    patch.meal_relation ?? "any",
      meal_note:        patch.meal_note ?? null,
      reminder_enabled: patch.reminder_enabled ?? true,
      is_bedtime:       patch.is_bedtime ?? false,
    }).eq("id", patch.scheduleId).eq("user_id", userId)
  } else if (patch.times?.length) {
    await admin.from("medication_schedules").insert({
      medication_id: id, user_id: userId, times: patch.times,
      dose_qty: patch.dose_qty ?? 1, meal_relation: patch.meal_relation ?? "any",
      meal_note: patch.meal_note ?? null, reminder_enabled: patch.reminder_enabled ?? true,
      is_bedtime: patch.is_bedtime ?? false,
      is_active: true,
    })
  }

  if (patch.inventoryId) {
    await admin.from("medication_inventory").update({
      qty_remaining:   patch.qty_remaining ?? 0,
      qty_unit:        patch.qty_unit ?? "เม็ด",
      qty_per_pack:    patch.qty_per_pack ?? null,
      low_stock_alert: patch.low_stock_alert ?? 7,
      expiry_date:     patch.expiry_date || null,
      loc_code:        patch.loc_code || null,
      lot_no:          patch.lot_no || null,
    }).eq("id", patch.inventoryId).eq("user_id", userId)
  } else if (patch.qty_remaining && patch.qty_remaining > 0) {
    await admin.from("medication_inventory").insert({
      medication_id: id, user_id: userId,
      qty_remaining: patch.qty_remaining, qty_unit: patch.qty_unit ?? "เม็ด",
      qty_per_pack: patch.qty_per_pack ?? null,
      low_stock_alert: patch.low_stock_alert ?? 7, expiry_date: patch.expiry_date || null,
      loc_code: patch.loc_code || null, lot_no: patch.lot_no || null,
      last_purchased_at: new Date().toISOString().slice(0, 10),
      last_purchased_qty: patch.qty_remaining,
    })
  }
}

/** Soft-delete. See the file header for why this must never be a hard delete. */
export async function deactivateMedication(id: string, userId: string, db?: MedicationsDb): Promise<void> {
  const admin = db ?? await defaultDb()
  const { error } = await admin.from("medications")
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", userId)
  if (error) throw new Error(error.message)
}
