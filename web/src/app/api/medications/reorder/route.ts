/**
 * The medication reorder list — which active medications are running low
 * enough to need buying again, and how much a person would sensibly buy.
 *
 * GET  — compute the list (read-only, safe to call on every page load).
 * POST — send that same list to the user's own LINE account as a message
 *        they can screenshot or forward to a pharmacy. Never sent to anyone
 *        else's LINE id — only the caller's own line_connections row, the
 *        same lookup medication-reminder.ts already uses for reminders.
 */
import { NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const LINE_API  = "https://api.line.me/v2/bot"
const lineToken = () => process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""

interface ReorderItem {
  medicationId: string
  name: string
  brandName: string | null
  strength: string | null
  qtyRemaining: number
  qtyUnit: string
  daysRemaining: number | null
  suggestedQty: number
  reason: "low_stock" | "running_out_soon"
}

/**
 * Days left at the real consumption rate (dose_qty × doses/day) — same
 * formula as the run-out estimate on the medication card
 * (web/src/components/health/medications-client.tsx daysRemaining), kept in
 * sync deliberately: a reorder list that used a different number than what
 * the card shows would be its own kind of confusing.
 */
function daysRemaining(qtyRemaining: number, doseQty: number, timesPerDay: number): number | null {
  const perDay = doseQty * timesPerDay
  if (!perDay || !Number.isFinite(perDay)) return null
  return Math.floor(qtyRemaining / perDay)
}

async function computeReorderList(userId: string): Promise<ReorderItem[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("medications")
    .select(`
      id, name, brand_name, strength, is_active,
      medication_schedules(dose_qty, times, is_active),
      medication_inventory(qty_remaining, qty_unit, low_stock_alert)
    `)
    .eq("user_id", userId)
    .eq("is_active", true)

  const items: ReorderItem[] = []
  for (const med of data ?? []) {
    // Both embeds come back as arrays regardless of the 1:1 relationship —
    // see the same note in medications-client.tsx's Medication type.
    const sched = (med.medication_schedules as Array<{ dose_qty: number; times: string[]; is_active: boolean }>)
      .find(s => s.is_active)
    const inv = (med.medication_inventory as Array<{ qty_remaining: number; qty_unit: string; low_stock_alert: number }>)[0]
    if (!inv) continue

    const days = sched ? daysRemaining(Number(inv.qty_remaining), Number(sched.dose_qty), sched.times.length) : null
    const lowStock = Number(inv.qty_remaining) <= Number(inv.low_stock_alert)
    const runningOut = days != null && days <= 7
    if (!lowStock && !runningOut) continue

    // A month's supply at the current rate, or a flat top-up to 3× the
    // alert threshold when there is no schedule to compute a rate from —
    // always at least enough to clear the low-stock line.
    const perDay = sched ? Number(sched.dose_qty) * sched.times.length : 0
    const suggestedQty = perDay > 0
      ? Math.max(Math.ceil(perDay * 30), Math.ceil(Number(inv.low_stock_alert) * 2))
      : Math.ceil(Number(inv.low_stock_alert) * 3)

    items.push({
      medicationId: med.id,
      name: med.name,
      brandName: med.brand_name,
      strength: med.strength,
      qtyRemaining: Number(inv.qty_remaining),
      qtyUnit: inv.qty_unit,
      daysRemaining: days,
      suggestedQty,
      reason: runningOut ? "running_out_soon" : "low_stock",
    })
  }

  // Soonest-to-run-out first — nulls (no schedule to estimate from) last.
  return items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const items = await computeReorderList(user.id)
  return NextResponse.json({ items })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const items = await computeReorderList(user.id)
  if (!items.length) {
    return NextResponse.json({ error: "ไม่มีรายการยาที่ต้องสั่งซื้อตอนนี้" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: conn } = await admin
    .from("line_connections")
    .select("line_user_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!conn?.line_user_id) {
    return NextResponse.json({ error: "ยังไม่ได้เชื่อมต่อ LINE — เชื่อมต่อในหน้าโปรไฟล์ก่อน" }, { status: 400 })
  }

  const token = lineToken()
  if (!token) {
    return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า" }, { status: 503 })
  }

  const lines = items.map(it => {
    const label = [it.name, it.strength].filter(Boolean).join(" ")
    const urgency = it.reason === "running_out_soon" ? `⏰ อีก ${it.daysRemaining} วันจะหมด` : "📦 เหลือน้อย"
    return `• ${label} — ซื้อ ${it.suggestedQty} ${it.qtyUnit} (${urgency}, ตอนนี้เหลือ ${it.qtyRemaining} ${it.qtyUnit})`
  })

  const message = {
    type: "flex",
    altText: `🛒 รายการยาที่ควรสั่งซื้อ (${items.length} รายการ)`,
    contents: {
      type: "bubble", size: "mega",
      header: {
        type: "box", layout: "vertical", paddingAll: "16px",
        backgroundColor: "#f59e0b",
        contents: [
          { type: "text", text: "SLIPPY HEALTH", size: "xxs", color: "#ffffffa6", weight: "bold" },
          { type: "text", text: "🛒 รายการสั่งซื้อยา", size: "lg", color: "#ffffff", weight: "bold", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "sm",
        contents: lines.map(text => ({ type: "text", text, size: "xs", color: "#374151", wrap: true })),
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [{
          type: "text", size: "xs", color: "#9ca3af", wrap: true,
          text: "แคปหน้าจอนี้หรือส่งต่อให้ร้านขายยา/บุคคลที่ดูแลได้เลยครับ",
        }],
      },
    },
  }

  const res = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: conn.line_user_id, messages: [message] }),
  })
  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${body.slice(0, 200)}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sent: items.length })
}
