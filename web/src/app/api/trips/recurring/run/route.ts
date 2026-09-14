import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }         from "@/lib/supabase/admin"
import { createTripExpense }         from "@/lib/trip-settlement"

/**
 * Internal endpoint — called daily by the `generate-recurring-expenses`
 * Supabase Edge Function (cron), same CRON_SECRET pattern as
 * reset-org-quotas (see supabase/functions/reset-org-quotas). Finds every
 * active template whose next_run_date has arrived, creates the actual
 * trip_expenses row via the same createTripExpense() a manual add uses, then
 * advances next_run_date by one interval (or deactivates once end_date has
 * passed).
 */
function addInterval(dateStr: string, unit: "weekly" | "monthly" | "yearly"): string {
  const d = new Date(dateStr + "T00:00:00Z")
  if (unit === "weekly")  d.setUTCDate(d.getUTCDate() + 7)
  if (unit === "monthly") d.setUTCMonth(d.getUTCMonth() + 1)
  if (unit === "yearly")  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = req.headers.get("authorization") ?? ""
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: due } = await admin
    .from("recurring_expense_templates")
    .select("id, journey_id, paid_by_id, title, amount, category, split_mode, split_values, interval_unit, next_run_date, end_date")
    .eq("is_active", true)
    .lte("next_run_date", today)

  const results: { templateId: string; ok: boolean; error?: string }[] = []

  for (const t of due ?? []) {
    try {
      const expenseId = await createTripExpense({
        tripId:      t.journey_id,
        paidById:    t.paid_by_id,
        title:       t.title,
        amount:      t.amount,
        category:    t.category,
        splitMode:   t.split_mode,
        splitValues: t.split_values ?? {},
        note:        "รายจ่ายประจำ — สร้างอัตโนมัติ",
        expenseDate: t.next_run_date,
      }, admin)

      const nextRun = addInterval(t.next_run_date, t.interval_unit)
      const pastEnd = t.end_date && nextRun > t.end_date

      await admin.from("recurring_expense_templates").update({
        next_run_date: nextRun,
        last_generated_expense_id: expenseId,
        last_generated_at: new Date().toISOString(),
        is_active: pastEnd ? false : true,
      }).eq("id", t.id)

      results.push({ templateId: t.id, ok: true })
    } catch (err) {
      results.push({ templateId: t.id, ok: false, error: err instanceof Error ? err.message : "unknown error" })
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), processed: results.length, results })
}
