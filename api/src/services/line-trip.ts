/**
 * LINE Trip Group Service ("หารบิลกลุ่มทริป" — à la KhunThong)
 *
 * Handles /tripgroup, /tripstatus, /trippay, /tripdone
 *
 * Design: a "trip group" is a `split_bills` row with `document_id = NULL`
 * and `category = 'trip'` — the exact same even-split mechanism as sport
 * groups (037/038_*.sql), just themed for travel: trip_type/destination
 * instead of sport_type/venue. One flat fee (ค่าทริปรวม) split EVENLY
 * across however many people have joined.
 *
 * Flow:
 *   1. Someone runs /tripgroup เที่ยวทะเล 3000 ภูเก็ต → creates group + LIFF link
 *   2. Friends tap the link (opens inside LINE via LIFF) → auto-join
 *   3. Anyone runs /tripstatus เพื่อดูยอดต่อหัว + ใครจ่ายแล้ว
 *   4. /trippay marks the caller's own share as paid
 *   5. /tripdone closes the group and posts the final settle-up summary
 */
import { supabase } from "../lib/supabase"
import { getAppUrl } from "../lib/app-url"
import {
  billCreatedCard, paymentConfirmText, fullyPaidCard, reminderCard,
} from "./line-bill-cards"

const APP_URL = getAppUrl()

const TRIP_THEME = "#38bdf8"

const TRIP_EMOJI: Record<string, string> = {
  "เที่ยวทะเล": "🏖️", "ทะเล": "🏖️", "beach": "🏖️",
  "แคมป์ปิ้ง": "⛺", "แคมป์": "⛺", "camping": "⛺",
  "ปีนเขา": "🏔️", "เขาใหญ่": "🏔️", "ภูเขา": "🏔️", "hiking": "🏔️", "trekking": "🏔️",
  "ต่างประเทศ": "✈️", "เที่ยวต่างประเทศ": "✈️", "abroad": "✈️", "international": "✈️",
  "เมือง": "🏙️", "ทริปเมือง": "🏙️", "city": "🏙️",
  "เกาะ": "🏝️", "island": "🏝️",
  "น้ำตก": "💦", "waterfall": "💦",
  "วัด": "🛕", "ไหว้พระ": "🛕", "temple": "🛕",
  "สวนสนุก": "🎢", "themepark": "🎢",
  "รถ": "🚗", "ขับรถเที่ยว": "🚗", "roadtrip": "🚗", "road trip": "🚗",
}

export function tripEmoji(tripType: string): string {
  return TRIP_EMOJI[tripType.toLowerCase()] ?? "✈️"
}

function fmtTHB(n: number | null | undefined): string {
  if (!n) return "฿0.00"
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function shortId(id: string): string { return id.slice(0, 8) }

// ─── Flex: trip group created — share to invite friends ──────────────────────
export function tripGroupCard(params: {
  billId: string; tripType: string; fee: number; destination?: string | null
  joinUrl: string; participantCount: number
}): object {
  const { billId, tripType, fee, destination, joinUrl, participantCount } = params
  const emoji = tripEmoji(tripType)
  const perHead = participantCount > 0 ? fee / participantCount : fee

  return {
    type: "flex",
    altText: `${emoji} สร้างกลุ่มทริป${tripType} — หารค่าใช้จ่ายกันเลย!`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#0ea5e9", endColor: "#2563eb" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "18px",
          contents: [
            { type: "text", text: "🧳 สร้างกลุ่มทริปแล้ว", size: "xs", color: "#ffffffa6", weight: "bold", letterSpacing: "2px" },
            { type: "text", text: `${emoji} ${tripType}`, size: "xl", color: "#ffffff", weight: "bold", margin: "xs" },
            ...(destination ? [{ type: "text", text: `📍 ${destination}`, size: "xs", color: "#ffffffcc", margin: "xs" } as object] : []),
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "md",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              { type: "text", text: "ค่าใช้จ่ายรวม", size: "sm", color: "#6b7280" },
              { type: "text", text: fmtTHB(fee), size: "md", color: "#111827", weight: "bold", align: "end" },
            ]
          },
          {
            type: "box", layout: "horizontal",
            contents: [
              { type: "text", text: `หารตามจำนวนคน (ตอนนี้ ${participantCount} คน)`, size: "xs", color: "#9ca3af", wrap: true, flex: 5 },
              { type: "text", text: `≈ ${fmtTHB(perHead)}/คน`, size: "xs", color: "#0ea5e9", weight: "bold", align: "end", flex: 3 },
            ]
          },
          { type: "separator", margin: "sm" },
          { type: "text", text: "📲 แชร์ลิงก์นี้ให้เพื่อนแตะเพื่อเข้าร่วมอัตโนมัติ", size: "xs", color: "#6b7280", wrap: true, margin: "sm" },
          { type: "text", text: `รหัสกลุ่ม: ${shortId(billId)}`, size: "xxs", color: "#9ca3af", margin: "xs" },
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: [
          { type: "button", style: "primary", height: "sm", color: "#06C755",
            action: { type: "uri", label: "🔗 ส่งลิงก์ชวนเพื่อนเข้ากลุ่ม", uri: joinUrl } },
          { type: "button", style: "primary", height: "sm", color: "#0ea5e9",
            action: { type: "uri", label: "✈️ เปิดแดชบอร์ดกลุ่ม (ดู/หาร/จ่าย)", uri: dashboardUrl() } },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "📊 ดูสถานะ", text: `/tripstatus ${shortId(billId)}` } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "✅ จ่ายแล้ว", text: `/trippay ${shortId(billId)}` } },
            ]
          },
        ]
      }
    }
  }
}

// ─── Flex: status / final settle-up ───────────────────────────────────────────
export function tripStatusCard(params: {
  billId: string; tripType: string; fee: number; destination?: string | null
  participants: Array<{ name: string; share: number; paid: boolean }>
  joinUrl: string; done: boolean
}): object {
  const { billId, tripType, fee, destination, participants, joinUrl, done } = params
  const emoji = tripEmoji(tripType)
  const paidCount = participants.filter(p => p.paid).length

  const rows: object[] = participants.map(p => ({
    type: "box", layout: "horizontal", paddingTop: "6px",
    contents: [
      { type: "text", text: p.paid ? "✅" : "⏳", size: "sm", flex: 0 },
      { type: "text", text: p.name, size: "sm", color: "#111827", wrap: true, flex: 5, margin: "sm" },
      { type: "text", text: fmtTHB(p.share), size: "sm", color: p.paid ? "#10b981" : "#f59e0b", align: "end", flex: 3 },
    ]
  }))

  return {
    type: "flex",
    altText: `${done ? "✅ ปิดกลุ่ม" : "📊 สถานะกลุ่ม"}ทริป${tripType} — จ่ายแล้ว ${paidCount}/${participants.length}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: done ? "#059669" : "#0ea5e9", endColor: done ? "#047857" : "#2563eb" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "16px", alignItems: "center",
          contents: [
            { type: "text", text: done ? "✅ ปิดกลุ่ม — สรุปยอด" : "📊 สถานะกลุ่มทริป", color: "#ffffff", weight: "bold", size: "md" },
            { type: "text", text: `${emoji} ${tripType}${destination ? ` · 📍${destination}` : ""}`, color: "#ffffffd9", size: "xs", margin: "xs" },
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
        contents: [
          {
            type: "box", layout: "horizontal", paddingBottom: "10px",
            contents: [
              { type: "text", text: `รวม ${fmtTHB(fee)} ÷ ${participants.length} คน`, size: "xs", color: "#6b7280", flex: 5 },
              { type: "text", text: `จ่ายแล้ว ${paidCount}/${participants.length}`, size: "xs", color: paidCount === participants.length ? "#10b981" : "#f59e0b", weight: "bold", align: "end", flex: 3 },
            ]
          },
          { type: "separator", color: "#f3f4f6" },
          ...rows,
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", backgroundColor: "#f9fafb",
        contents: done ? [
          { type: "text", text: "🔒 กลุ่มนี้ปิดแล้ว — โอนเงินให้หัวหน้าทริปได้เลยครับ", size: "xxs", color: "#9ca3af", wrap: true, align: "center" },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "uri", label: "✈️ เปิดแดชบอร์ด", uri: dashboardUrl() } },
        ] : [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
                action: { type: "message", label: "✅ จ่ายแล้ว", text: `/trippay ${shortId(billId)}` } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "uri", label: "🔗 ชวนเพื่อน", uri: joinUrl } },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "uri", label: "✈️ แดชบอร์ด", uri: dashboardUrl() } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "🔒 ปิดกลุ่ม", text: `/tripdone ${shortId(billId)}` } },
            ]
          },
        ]
      }
    }
  }
}

// ─── KhunThong-style notification cards — thin sky/blue (#38bdf8) wrappers ────
// Generic builders live in line-bill-cards.ts (shared with line-sport.ts) so the
// visual language stays identical across sport/trip groups.
export function tripBillCreatedCard(params: {
  title: string; total: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
  payUrl: string; statusUrl?: string
}): object {
  return billCreatedCard({ ...params, themeColor: TRIP_THEME })
}

export function tripPaymentConfirmText(params: {
  title: string; payerName: string; amount: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
}): object {
  return paymentConfirmText(params)
}

export function tripFullyPaidCard(params: {
  title: string; bookingDateLabel?: string
  participants: Array<{ name: string; amount: number; paidAt: string | null; isCollector?: boolean }>
}): object {
  const { title, bookingDateLabel, participants } = params
  return fullyPaidCard({ title, subtitle: bookingDateLabel, participants, themeColor: TRIP_THEME })
}

export function tripReminderCard(params: {
  bills: Array<{ title: string; unpaid: Array<{ name: string; amount: number }> }>
  statusUrl: string; payUrl: string
}): object {
  return reminderCard({ ...params, themeColor: TRIP_THEME })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function findGroup(billIdPrefix: string, orgId: string) {
  const { data } = await supabase
    .from("split_bills")
    .select("id, title, total_amount, trip_type, destination, status, share_token, organization_id")
    .eq("organization_id", orgId)
    .eq("category", "trip")
    .ilike("id", `${billIdPrefix}%`)
    .limit(1)
  return data?.[0] ?? null
}

function joinUrl(token: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/join/${token}?type=split`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}/split/join/${token}`
}

// LIFF dashboard — list/create/manage trip groups in one place (à la KhunThong)
function dashboardUrl(): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  return liffId ? `https://liff.line.me/${liffId}/liff/trip` : `${APP_URL}/liff/trip`
}

/** Recompute & persist an even split of `fee` across all current participants. */
async function rebalance(billId: string, fee: number) {
  const { data: parts } = await supabase
    .from("split_participants")
    .select("id")
    .eq("split_bill_id", billId)

  const n = parts?.length ?? 0
  if (n === 0) return
  const share = Math.round((fee / n) * 100) / 100
  for (const p of parts!) {
    await supabase.from("split_participants").update({ amount: share }).eq("id", p.id)
  }
}

// ─── /tripgroup [ธีมทริป] [ค่าใช้จ่าย] [จุดหมาย...] ────────────────────────────
export async function handleCreateTripGroup(
  args: string[], orgId: string, lineUserId: string, displayName: string,
  lineGroupId: string | null = null,
): Promise<{ card?: object; text?: string }> {
  const tripType    = args[0]
  const fee         = Number(args[1]) || 0
  const destination = args.slice(2).join(" ").trim() || null

  if (!tripType) {
    return { text:
      "🧳 สร้างกลุ่มทริปแบบนี้นะครับ:\n" +
      "/tripgroup [ธีมทริป] [ค่าใช้จ่ายรวม] [จุดหมาย]\n\n" +
      "ตัวอย่าง:\n" +
      "/tripgroup เที่ยวทะเล 3000 ภูเก็ต\n" +
      "/tripgroup แคมป์ปิ้ง 1500 เขาใหญ่\n\n" +
      "ระบบจะหารค่าใช้จ่ายเท่าๆ กันให้ทุกคนที่กดเข้าร่วมลิงก์ครับ"
    }
  }

  // Resolve user's id (for creator_id FK) — line_connections.user_id
  const { data: conn } = await supabase
    .from("line_connections")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .single()

  const { data: bill, error } = await supabase
    .from("split_bills")
    .insert({
      organization_id: orgId,
      creator_id:      conn?.user_id ?? null,
      document_id:     null,
      title:           `${tripEmoji(tripType)} ทริป${tripType}`,
      total_amount:    fee,
      category:        "trip",
      trip_type:       tripType,
      destination,
      status:          "open",
      line_group_id:   lineGroupId,
    })
    .select("id, share_token")
    .single()

  if (error || !bill) {
    return { text: `❌ สร้างกลุ่มไม่สำเร็จ: ${error?.message ?? "ไม่ทราบสาเหตุ"}` }
  }

  // Auto-add the creator as the first member
  await supabase.from("split_participants").insert({
    split_bill_id: bill.id,
    name:          displayName,
    line_user_id:  lineUserId,
    line_display:  displayName,
    amount:        fee, // sole member for now — will be rebalanced as people join
  })

  return {
    card: tripGroupCard({
      billId:           bill.id,
      tripType,
      fee,
      destination,
      joinUrl:          joinUrl(bill.share_token),
      participantCount: 1,
    })
  }
}

// ─── /tripstatus or /tripdone [รหัสกลุ่ม] ─────────────────────────────────────
export async function handleTripStatus(
  billIdPrefix: string, orgId: string, finalize: boolean,
): Promise<{ card?: object; text?: string }> {
  const bill = await findGroup(billIdPrefix, orgId)
  if (!bill) return { text: "❌ ไม่พบกลุ่มทริปนี้ครับ ลองเช็ครหัสจาก /tripgroup อีกครั้ง" }

  await rebalance(bill.id, Number(bill.total_amount ?? 0))

  const { data: parts } = await supabase
    .from("split_participants")
    .select("name, amount, paid_at")
    .eq("split_bill_id", bill.id)
    .order("created_at")

  const participants = (parts ?? []).map(p => ({
    name:  p.name as string,
    share: Number(p.amount ?? 0),
    paid:  !!p.paid_at,
  }))

  if (finalize) {
    await supabase.from("split_bills").update({ status: "finalized" }).eq("id", bill.id)
  }

  return {
    card: tripStatusCard({
      billId:       bill.id,
      tripType:     bill.trip_type ?? "ทริป",
      fee:          Number(bill.total_amount ?? 0),
      destination:  bill.destination,
      participants,
      joinUrl:      joinUrl(bill.share_token),
      done:         finalize || bill.status === "finalized",
    })
  }
}

// ─── /trippay [รหัสกลุ่ม] — mark caller's own share as paid ───────────────────
export async function handleTripPay(
  billIdPrefix: string, orgId: string, lineUserId: string, displayName: string,
): Promise<{ card?: object; text?: string }> {
  const bill = await findGroup(billIdPrefix, orgId)
  if (!bill) return { text: "❌ ไม่พบกลุ่มทริปนี้ครับ" }
  if (bill.status === "finalized") return { text: "🔒 กลุ่มนี้ปิดแล้วครับ ดูยอดสุดท้ายได้ด้วย /tripstatus " + shortId(bill.id) }

  // Ensure caller is a participant (auto-join if they paid before tapping the link)
  const { data: existing } = await supabase
    .from("split_participants")
    .select("id")
    .eq("split_bill_id", bill.id).eq("line_user_id", lineUserId)
    .maybeSingle()

  let participantId = existing?.id
  if (!participantId) {
    const { data: created } = await supabase.from("split_participants").insert({
      split_bill_id: bill.id, name: displayName, line_user_id: lineUserId,
      line_display: displayName, amount: 0,
    }).select("id").single()
    participantId = created?.id
  }

  if (participantId) {
    await supabase.from("split_participants")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", participantId)
  }

  return handleTripStatus(shortId(bill.id), orgId, false)
}
