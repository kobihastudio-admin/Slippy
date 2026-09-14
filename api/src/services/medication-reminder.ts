/**
 * medication-reminder.ts — Medication Reminder Worker
 *
 * Runs every minute via setInterval.
 * Finds due medication reminders and sends LINE push messages.
 * Auto-creates pending logs for today's schedules at midnight.
 */

import { createClient } from "../lib/supabase"

const LINE_API = "https://api.line.me/v2/bot"
const token    = () => process.env.LINE_CHANNEL_ACCESS_TOKEN!

// ─── Push reminder via LINE ───────────────────────────────────────────────────
async function pushReminder(lineUserId: string, reminder: {
  med_name:     string
  med_purpose:  string | null
  med_strength: string | null
  med_color:    string | null
  dose_qty:     number
  meal_relation: string
  meal_note:    string | null
  scheduled_at: string
  log_id:       string
  is_bedtime:   boolean
}) {
  const mealText: Record<string, string> = {
    before: "ก่อนอาหาร",
    after:  "หลังอาหาร",
    with:   "พร้อมอาหาร",
    any:    "",
  }
  const meal = reminder.meal_note || mealText[reminder.meal_relation] || ""
  const time = reminder.is_bedtime
    ? "ก่อนนอน"
    : new Date(reminder.scheduled_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  // "ตัวยาคืออะไร" — what this pill actually is, not just its name, so a
  // reminder also answers "why am I taking this" and gives something to
  // check a pill's appearance against before swallowing it.
  const idLine = [reminder.med_strength, reminder.med_color ? `สี${reminder.med_color}` : null]
    .filter(Boolean).join(" · ")

  const msg = {
    type: "flex",
    altText: `💊 ถึงเวลาทาน ${reminder.med_name}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#6366f1", endColor: "#8b5cf6" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "16px",
          contents: [
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: "SLIPPY HEALTH", size: "xxs", color: "#ffffffa6", weight: "bold" },
                { type: "text", text: "💊 เวลาทานยา", size: "lg", color: "#ffffff", weight: "bold", margin: "xs" },
              ]
            },
            {
              type: "box", layout: "vertical", width: "44px", height: "44px",
              cornerRadius: "22px", backgroundColor: "#ffffff33",
              justifyContent: "center", alignItems: "center",
              contents: [{ type: "text", text: "💊", size: "xl", align: "center" }]
            }
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
        contents: [
          {
            type: "box", layout: "vertical", paddingAll: "14px",
            backgroundColor: "#f9fafb", cornerRadius: "10px",
            contents: [
              { type: "text", text: reminder.med_name, size: "xl", color: "#111827", weight: "bold" },
              ...(idLine ? [{ type: "text", text: idLine, size: "xs", color: "#9ca3af", margin: "xxs" } as object] : []),
              { type: "text", text: `${reminder.dose_qty} ${reminder.dose_qty === 1 ? "เม็ด" : "เม็ด/ครั้ง"}${meal ? ` · ${meal}` : ""}`, size: "sm", color: "#6b7280", margin: "xs" },
              ...(reminder.med_purpose ? [{ type: "text", text: `🎯 ${reminder.med_purpose}`, size: "xs", color: "#6b7280", margin: "xs", wrap: true } as object] : []),
              { type: "text", text: reminder.is_bedtime ? `🌙 ${time}` : `⏰ ${time} น.`, size: "xs", color: "#9ca3af", margin: "sm" },
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "horizontal", spacing: "sm", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [
          {
            type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
            action: { type: "message", label: "✓ ทานแล้ว", text: `/medtaken ${reminder.log_id}` }
          },
          {
            type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "message", label: "ข้ามครั้งนี้", text: `/medskip ${reminder.log_id}` }
          },
        ]
      }
    }
  }

  const res = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ to: lineUserId, messages: [msg] }),
  })
  if (!res.ok) console.error("[med-reminder] push failed:", res.status, await res.text())
}

// ─── Generate today's pending logs for all active schedules ──────────────────
export async function generateDailyLogs(): Promise<void> {
  const supabase = createClient()
  const today    = new Date().toISOString().slice(0, 10)
  const dow      = new Date().getDay() || 7  // 1=Mon ... 7=Sun

  const { data: schedules } = await supabase
    .from("medication_schedules")
    .select("id, medication_id, user_id, times, days_of_week, dose_qty")
    .eq("is_active", true)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .lte("start_date", today)

  if (!schedules?.length) return

  const logs: object[] = []
  for (const s of schedules) {
    // Check day of week
    if (s.days_of_week && !s.days_of_week.includes(dow)) continue

    for (const t of (s.times ?? ["08:00"])) {
      const scheduledAt = `${today}T${t}:00+07:00`

      // Skip if log already exists for today at this time
      const { count } = await supabase
        .from("medication_logs")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", s.id)
        .gte("scheduled_at", `${today}T00:00:00+07:00`)
        .lte("scheduled_at", `${today}T23:59:59+07:00`)
        .like("scheduled_at", `%T${t}%`)

      if ((count ?? 0) > 0) continue

      logs.push({
        schedule_id:  s.id,
        medication_id: s.medication_id,
        user_id:      s.user_id,
        scheduled_at: scheduledAt,
        dose_taken:   s.dose_qty,
        status:       "pending",
      })
    }
  }

  if (logs.length > 0) {
    await supabase.from("medication_logs").insert(logs)
    console.log(`[med] Generated ${logs.length} logs for ${today}`)
  }
}

// ─── Check and send due reminders ────────────────────────────────────────────
export async function checkAndSendReminders(): Promise<void> {
  const supabase = createClient()
  const now      = new Date()
  const from     = now.toISOString()
  const to       = new Date(now.getTime() + 2 * 60000).toISOString()  // next 2 minutes

  const { data: reminders } = await supabase
    .rpc("get_pending_medication_reminders", { p_from: from, p_to: to })

  if (!reminders?.length) return
  console.log(`[med-reminder] ${reminders.length} reminders due`)

  for (const r of reminders) {
    // Find LINE user ID for this user
    const { data: conn } = await supabase
      .from("line_connections")
      .select("line_user_id")
      .eq("user_id", r.user_id)
      .maybeSingle()

    if (!conn?.line_user_id) continue

    await pushReminder(conn.line_user_id, {
      med_name:     r.med_name,
      med_purpose:  r.med_purpose,
      med_strength: r.med_strength,
      med_color:    r.med_color,
      dose_qty:     r.dose_qty,
      meal_relation: r.meal_relation,
      meal_note:    r.meal_note,
      scheduled_at: r.scheduled_at,
      log_id:       r.log_id,
      is_bedtime:   r.is_bedtime,
    })
  }
}

// ─── Low stock check ──────────────────────────────────────────────────────────
export async function checkLowStock(): Promise<void> {
  const supabase = createClient()

  const { data: lowItems } = await supabase
    .from("medication_inventory")
    .select(`
      user_id, qty_remaining, low_stock_alert, qty_unit,
      medications(name)
    `)
    .filter("qty_remaining", "lte", supabase.rpc as any)  // simplified

  // Alternative: raw query
  const { data } = await supabase
    .from("medication_inventory")
    .select(`user_id, qty_remaining, low_stock_alert, qty_unit, medications!inner(name)`)

  for (const item of (data ?? [])) {
    if (Number(item.qty_remaining) <= Number(item.low_stock_alert)) {
      const { data: conn } = await supabase
        .from("line_connections")
        .select("line_user_id")
        .eq("user_id", item.user_id)
        .maybeSingle()

      if (!conn?.line_user_id) continue

      const medName = (item.medications as any)?.name ?? "ยา"
      const res = await fetch(`${LINE_API}/message/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          to: conn.line_user_id,
          messages: [{
            type: "text",
            text: `⚠️ ยา "${medName}" เหลือน้อยแล้วครับ\n` +
              `เหลืออยู่ ${item.qty_remaining} ${item.qty_unit}\n` +
              `ควรสั่งซื้อเพิ่มเร็วๆ นี้ 💊`
          }]
        })
      })
    }
  }
}

// ─── Mark log as taken/skipped ────────────────────────────────────────────────
export async function markMedicationLog(
  logId:  string,
  status: "taken" | "skipped",
  via:    string = "line"
): Promise<{ medName: string; status: string }> {
  const supabase = createClient()
  const now      = new Date().toISOString()

  const { data: log } = await supabase
    .from("medication_logs")
    .select("medication_id, schedule_id, medications!inner(name)")
    .eq("id", logId)
    .single()

  await supabase.from("medication_logs").update({
    status,
    taken_at:      status === "taken" ? now : null,
    confirmed_via: via,
  }).eq("id", logId)

  // Decrease inventory
  if (status === "taken") {
    const { data: sched } = await supabase
      .from("medication_schedules")
      .select("dose_qty, medication_id")
      .eq("id", log?.schedule_id)
      .single()

    if (sched) {
      supabase.rpc("decrement_medication_qty", {
        p_medication_id: sched.medication_id,
        p_user_id:       (log as any)?.user_id,
        p_qty:           sched.dose_qty,
      })  // non-critical fire-and-forget
    }
  }

  return {
    medName: (log?.medications as any)?.name ?? "ยา",
    status,
  }
}
