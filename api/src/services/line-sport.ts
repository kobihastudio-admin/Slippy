/**
 * LINE Sport Group Service ("หารบิลกลุ่มกีฬา" — à la KhunThong)
 *
 * Handles /sportgroup, /sportjoin, /sportpay, /sportstatus, /sportdone, /sportroster
 *
 * Design: a "sport group" is a `split_bills` row with `document_id = NULL`
 * and `category = 'sport'`. Unlike the receipt-based /split flow (which
 * splits document line-items), a sport group splits one flat fee EVENLY
 * across however many people have joined — exactly how badminton/futsal/
 * basketball court-fee groups are split in apps like KhunThong.
 *
 * Flow:
 *   1. Someone runs /sportgroup แบด 400  → creates the group + share/LIFF link
 *   2. Friends tap the link (opens inside LINE via LIFF) → auto-join
 *   3. Anyone can run /sportstatus เพื่อดูยอดต่อหัว + ใครจ่ายแล้ว
 *   4. /sportpay marks the caller's own share as paid
 *   5. /sportdone closes the group and posts the final settle-up summary
 */
import { supabase } from "../lib/supabase"
import { getAppUrl } from "../lib/app-url"
import {
  billCreatedCard, paymentConfirmText, fullyPaidCard, reminderCard, rosterUpdateCard,
} from "./line-bill-cards"
import { pushMsg } from "./line-push"

const SPORT_THEME = "#6366f1"

const APP_URL = getAppUrl()

const SPORT_EMOJI: Record<string, string> = {
  "แบด": "🏸", "แบดมินตัน": "🏸", "badminton": "🏸",
  "ฟุตบอล": "⚽", "football": "⚽", "soccer": "⚽", "ฟุตซอล": "⚽",
  "บาส": "🏀", "บาสเกตบอล": "🏀", "basketball": "🏀",
  "เทนนิส": "🎾", "tennis": "🎾",
  "ว่ายน้ำ": "🏊", "swimming": "🏊",
  "กอล์ฟ": "⛳", "golf": "⛳",
  "วอลเลย์บอล": "🏐", "volleyball": "🏐",
}

export function sportEmoji(sportType: string): string {
  return SPORT_EMOJI[sportType.toLowerCase()] ?? "🏃"
}

function fmtTHB(n: number | null | undefined): string {
  if (!n) return "฿0.00"
  return "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function shortId(id: string): string { return id.slice(0, 8) }

const LINE_API = "https://api.line.me/v2/bot"

// ─── Fetch a LINE user's profile picture (used for participant avatars) ──────
// Only works if the user has added the Slippy OA as a friend.
async function getLinePictureUrl(lineUserId: string): Promise<string | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${LINE_API}/profile/${lineUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const profile = await res.json() as any
    return profile.pictureUrl ?? null
  } catch {
    return null
  }
}

// ─── Fetch a member's profile (name + picture) from within a LINE group/room ─
// Works for ANY member of the group/room, even if they haven't added the
// Slippy OA as a friend — used as the primary source when a "เพื่อน" joins
// via the postback buttons on the invite card.
async function getGroupMemberProfile(
  sourceType: "group" | "room", sourceId: string, lineUserId: string,
): Promise<{ displayName: string; pictureUrl: string | null } | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${LINE_API}/${sourceType}/${sourceId}/member/${lineUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const profile = await res.json() as any
    if (!profile.displayName) return null
    return { displayName: profile.displayName as string, pictureUrl: profile.pictureUrl ?? null }
  } catch {
    return null
  }
}

const FALLBACK_AVATAR_URL = "https://cdn-icons-png.flaticon.com/512/847/847969.png"

// ─── Flex: sport group created — share to invite friends ─────────────────────
export function sportGroupCard(params: {
  billId: string; sportType: string; fee: number; venue?: string | null
  joinUrl: string; participantCount: number
}): object {
  const { billId, sportType, fee, venue, joinUrl, participantCount } = params
  const emoji = sportEmoji(sportType)
  const perHead = participantCount > 0 ? fee / participantCount : fee

  return {
    type: "flex",
    altText: `${emoji} สร้างกลุ่ม${sportType} — หารค่าใช้จ่ายกันเลย!`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: "#6366f1", endColor: "#4f46e5" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "18px",
          contents: [
            { type: "text", text: "🏆 สร้างกลุ่มกีฬาแล้ว", size: "xs", color: "#FFFFFFA6", weight: "bold", letterSpacing: "2px" },
            { type: "text", text: `${emoji} ${sportType}`, size: "xl", color: "#ffffff", weight: "bold", margin: "xs" },
            ...(venue ? [{ type: "text", text: `📍 ${venue}`, size: "xs", color: "#FFFFFFCC", margin: "xs" } as object] : []),
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
              { type: "text", text: `≈ ${fmtTHB(perHead)}/คน`, size: "xs", color: "#6366f1", weight: "bold", align: "end", flex: 3 },
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
          { type: "button", style: "primary", height: "sm", color: "#6366f1",
            action: { type: "uri", label: "🏸 เปิดแดชบอร์ดกลุ่ม (ดู/หาร/จ่าย)", uri: dashboardUrl() } },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "📊 ดูสถานะ", text: `/sportstatus ${shortId(billId)}` } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "✅ จ่ายแล้ว", text: `/sportpay ${shortId(billId)}` } },
            ]
          },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "message", label: "📋 ดูรายชื่อ", text: `/sportroster ${shortId(billId)}` } },
        ]
      }
    }
  }
}

// ─── Flex: status / final settle-up ───────────────────────────────────────────
export function sportStatusCard(params: {
  billId: string; sportType: string; fee: number; venue?: string | null
  participants: Array<{ name: string; share: number; paid: boolean }>
  joinUrl: string; done: boolean
}): object {
  const { billId, sportType, fee, venue, participants, joinUrl, done } = params
  const emoji = sportEmoji(sportType)
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
    altText: `${done ? "✅ ปิดกลุ่ม" : "📊 สถานะกลุ่ม"}${sportType} — จ่ายแล้ว ${paidCount}/${participants.length}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "135deg", startColor: done ? "#059669" : "#6366f1", endColor: done ? "#047857" : "#4f46e5" },
        contents: [{
          type: "box", layout: "vertical", paddingAll: "16px", alignItems: "center",
          contents: [
            { type: "text", text: done ? "✅ ปิดกลุ่ม — สรุปยอด" : "📊 สถานะกลุ่มกีฬา", color: "#ffffff", weight: "bold", size: "md" },
            { type: "text", text: `${emoji} ${sportType}${venue ? ` · 📍${venue}` : ""}`, color: "#FFFFFFD9", size: "xs", margin: "xs" },
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
          { type: "text", text: "🔒 กลุ่มนี้ปิดแล้ว — โอนเงินให้หัวหน้าทีมได้เลยครับ", size: "xxs", color: "#9ca3af", wrap: true, align: "center" },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "uri", label: "🏸 เปิดแดชบอร์ด", uri: dashboardUrl() } },
        ] : [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
                action: { type: "message", label: "✅ จ่ายแล้ว", text: `/sportpay ${shortId(billId)}` } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "uri", label: "🔗 ชวนเพื่อน", uri: joinUrl } },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "uri", label: "🏸 แดชบอร์ด", uri: dashboardUrl() } },
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "📋 ดูรายชื่อ", text: `/sportroster ${shortId(billId)}` } },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", height: "sm", flex: 1,
                action: { type: "message", label: "🔒 ปิดกลุ่ม", text: `/sportdone ${shortId(billId)}` } },
            ]
          },
        ]
      }
    }
  }
}

// ─── KhunThong-style notification cards — Slippy indigo (#6366f1) wrappers ────
// Generic builders live in line-bill-cards.ts (shared with line-trip.ts) so the
// visual language stays identical across sport/trip groups.
export function sportBillCreatedCard(params: {
  title: string; total: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
  payUrl: string; statusUrl?: string
}): object {
  return billCreatedCard({ ...params, themeColor: SPORT_THEME })
}

export function sportPaymentConfirmText(params: {
  title: string; payerName: string; amount: number; collectorName: string
  participants: Array<{ name: string; amount: number; paid: boolean; paidAt: string | null; isCollector?: boolean }>
}): object {
  return paymentConfirmText(params)
}

export function sportFullyPaidCard(params: {
  title: string; bookingDateLabel?: string
  participants: Array<{ name: string; amount: number; paidAt: string | null; isCollector?: boolean }>
}): object {
  const { title, bookingDateLabel, participants } = params
  return fullyPaidCard({ title, subtitle: bookingDateLabel, participants, themeColor: SPORT_THEME })
}

export function sportReminderCard(params: {
  bills: Array<{ title: string; unpaid: Array<{ name: string; amount: number }> }>
  statusUrl: string; payUrl: string
}): object {
  return reminderCard({ ...params, themeColor: SPORT_THEME })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function findGroup(billIdPrefix: string, orgId: string) {
  const { data } = await supabase
    .from("split_bills")
    .select("id, title, total_amount, sport_type, venue, status, share_token, organization_id")
    .eq("organization_id", orgId)
    .eq("category", "sport")
    .ilike("id", `${billIdPrefix}%`)
    .limit(1)
  return data?.[0] ?? null
}

function joinUrl(token: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/join/${token}?type=split`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}/split/join/${token}`
}

// Same join LIFF page, but in "add a guest" mode — lets someone in the chat
// register a friend (with their own custom amount) instead of joining themselves.
function addGuestUrl(token: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/join/${token}?type=split&guest=1`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}/split/join/${token}?guest=1`
}

// LIFF dashboard — list/create/manage sport groups in one place (à la KhunThong)
function dashboardUrl(): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  return liffId ? `https://liff.line.me/${liffId}/liff/sport` : `${APP_URL}/liff/sport`
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

// ─── /sportgroup [กีฬา] [ค่าใช้จ่าย] [สถานที่...] ──────────────────────────────
export async function handleCreateSportGroup(
  args: string[], orgId: string, lineUserId: string, displayName: string,
  lineGroupId: string | null = null,
): Promise<{ card?: object; text?: string }> {
  const sportType = args[0]
  const fee       = Number(args[1]) || 0
  const venue     = args.slice(2).join(" ").trim() || null

  if (!sportType) {
    return { text:
      "🏸 สร้างกลุ่มกีฬาแบบนี้นะครับ:\n" +
      "/sportgroup [ชนิดกีฬา] [ค่าใช้จ่ายรวม] [สถานที่]\n\n" +
      "ตัวอย่าง:\n" +
      "/sportgroup แบด 400 สนามแบดบางนา\n" +
      "/sportgroup บาส 600\n\n" +
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
      title:           `${sportEmoji(sportType)} กลุ่ม${sportType}`,
      total_amount:    fee,
      category:        "sport",
      sport_type:      sportType,
      venue,
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
    card: sportGroupCard({
      billId:           bill.id,
      sportType,
      fee,
      venue,
      joinUrl:          joinUrl(bill.share_token),
      participantCount: 1,
    })
  }
}

// ─── /sportstatus or /sportdone [รหัสกลุ่ม] ───────────────────────────────────
export async function handleSportStatus(
  billIdPrefix: string, orgId: string, finalize: boolean,
): Promise<{ card?: object; text?: string }> {
  const bill = await findGroup(billIdPrefix, orgId)
  if (!bill) return { text: "❌ ไม่พบกลุ่มกีฬานี้ครับ ลองเช็ครหัสจาก /sportgroup อีกครั้ง" }

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
    card: sportStatusCard({
      billId:       bill.id,
      sportType:    bill.sport_type ?? "กีฬา",
      fee:          Number(bill.total_amount ?? 0),
      venue:        bill.venue,
      participants,
      joinUrl:      joinUrl(bill.share_token),
      done:         finalize || bill.status === "finalized",
    })
  }
}

// "ดูว่าใครจ่ายเงินแล้ว" — deep-links into the session's detail page on the
// dashboard, scrolled to the roster section. Mirrors sport-notify.ts's helper.
function sessionStatusUrl(billId: string): string {
  const liffId = process.env.LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? ""
  const path = `/liff/sport?session=${billId}&focus=roster`
  return liffId ? `https://liff.line.me/${liffId}${path}` : `${APP_URL}${path}`
}

// ─── /sportroster [รหัสกลุ่ม] — re-post the current roster (tree of who's in,
// with named guests nested under whoever added them) on demand, so it doesn't
// get lost scrolling back through chat history after every add/remove. ──────
export async function handleSportRoster(
  billIdPrefix: string, orgId: string,
): Promise<{ card?: object; text?: string }> {
  const bill = await findGroup(billIdPrefix, orgId)
  if (!bill) return { text: "❌ ไม่พบกลุ่มกีฬานี้ครับ ลองเช็ครหัสจาก /sportgroup อีกครั้ง" }

  const { data: parts } = await supabase
    .from("split_participants")
    .select("id, name, added_by_participant_id")
    .eq("split_bill_id", bill.id)
    .order("created_at")

  const all = parts ?? []
  const guestsByParent = new Map<string, { name: string }[]>()
  for (const p of all) {
    if (!p.added_by_participant_id) continue
    const list = guestsByParent.get(p.added_by_participant_id) ?? []
    list.push({ name: p.name })
    guestsByParent.set(p.added_by_participant_id, list)
  }
  const topLevel = all.filter(p => !p.added_by_participant_id)

  return {
    card: rosterUpdateCard({
      title:      bill.title,
      themeColor: "#6366f1",
      statusUrl:  sessionStatusUrl(bill.id),
      participants: topLevel.map(p => ({
        name: p.name as string,
        guests: guestsByParent.get(p.id) ?? [],
      })),
    })
  }
}

// A session's registration window closes at its end time (or start time if no
// end time) on the booking date. Sessions with no booking date never close.
function isRegistrationClosed(bookingDate: string | null, startTime: string | null, endTime: string | null): boolean {
  if (!bookingDate) return false
  const deadline = new Date(`${bookingDate}T${endTime ?? startTime ?? "23:59"}:00`)
  return Date.now() > deadline.getTime()
}

const TH_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
const TH_MONTHS   = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

// "2026-06-17" → "พุธ 17 มิ.ย. 2569" (วัน วันที่ เดือน พ.ศ.)
function thaiDateLabel(dateStr: string | null): string {
  if (!dateStr) return ""
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d.getTime())) return ""
  return `${TH_WEEKDAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

// Small rounded icon badge + text row — used throughout the invite card for a
// more modern look than plain emoji-prefixed text.
function iconRow(emoji: string, text: string, opts?: { color?: string; bg?: string; weight?: "regular" | "bold" }): object {
  return {
    type: "box", layout: "horizontal", spacing: "md", alignItems: "center",
    contents: [
      {
        type: "box", layout: "vertical", width: "30px", height: "30px", cornerRadius: "10px",
        backgroundColor: opts?.bg ?? "#f5f3ff", justifyContent: "center", alignItems: "center",
        contents: [{ type: "text", text: emoji, size: "sm", align: "center", gravity: "center" }],
      },
      { type: "text", text, size: "sm", color: opts?.color ?? "#374151", weight: opts?.weight ?? "regular", wrap: true, flex: 1, gravity: "center" },
    ],
  }
}

// ─── Invite Flex card (server-side equivalent of the LIFF's buildInviteFlex) ──
// Sent into the LINE group right after it's linked, so members can immediately
// join/leave the upcoming session via postback buttons.
export async function buildSportInviteFlex(bill: {
  id: string; title: string; sport_type: string | null; total_amount: number | null
  venue: string | null; booking_date: string | null; start_time: string | null; end_time: string | null
  court_no?: string | null; map_url?: string | null; max_players?: number | null
  extra_notes?: string | null; sport_group_id?: string | null
  share_token: string
}): Promise<object> {
  const [{ count }, { data: expenses }, { data: slots }, conceptText] = await Promise.all([
    supabase.from("split_participants").select("id", { count: "exact", head: true }).eq("split_bill_id", bill.id),
    supabase.from("session_expenses").select("category, amount").eq("split_bill_id", bill.id),
    supabase.from("session_court_slots").select("start_time, court_count").eq("split_bill_id", bill.id).order("start_time"),
    bill.sport_group_id
      ? supabase.from("sport_groups").select("concept_text").eq("id", bill.sport_group_id).maybeSingle()
          .then(r => r.data?.concept_text as string | null ?? null)
      : Promise.resolve(null),
  ])

  const n = count || 1
  const emoji = sportEmoji(bill.sport_type ?? "")

  const courtFee   = (expenses ?? []).filter(e => e.category === "court").reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const shuttleFee = (expenses ?? []).filter(e => e.category === "shuttlecock").reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const expenseTotal = (expenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0)
  const fee = expenseTotal > 0 ? expenseTotal : Number(bill.total_amount ?? 0)
  const perPerson = Math.round((fee / n) * 100) / 100

  const rows: object[] = []
  if (bill.booking_date) {
    rows.push(iconRow("📅", thaiDateLabel(bill.booking_date), { weight: "bold" }))
  }
  if (slots && slots.length > 0) {
    const slotText = slots.map(s => `${(s.start_time as string).slice(0, 5)} น. เปิด ${s.court_count} สนาม`).join("\n")
    rows.push(iconRow("⏰", slotText))
  } else if (bill.start_time) {
    const timeText = `${bill.start_time.slice(0, 5)}${bill.end_time ? ` - ${bill.end_time.slice(0, 5)}` : ""} น.${bill.court_no ? ` · ${bill.court_no}` : ""}`
    rows.push(iconRow("⏰", timeText))
  }
  if (bill.venue) {
    rows.push(iconRow("📍", bill.venue))
  }
  rows.push(iconRow("👥", bill.max_players ? `รับ ${n}/${bill.max_players} คน` : `เข้าร่วมแล้ว ${n} คน`))
  if (bill.extra_notes) {
    rows.push(iconRow("📝", bill.extra_notes, { bg: "#fef9c3" }))
  }
  if (conceptText) {
    rows.push(iconRow("📋", conceptText, { bg: "#f1f5f9", color: "#6b7280" }))
  }

  const feeLines = [`${fmtTHB(perPerson)} / คน  (รวม ${fmtTHB(fee)})`]
  if (courtFee > 0 || shuttleFee > 0) {
    const parts: string[] = []
    if (courtFee > 0) parts.push(`🏸 ค่าสนาม ${fmtTHB(courtFee)}`)
    if (shuttleFee > 0) parts.push(`🪶 ค่าลูก ${fmtTHB(shuttleFee)}`)
    feeLines.push(parts.join("  ·  "))
  }
  rows.push(iconRow("💰", feeLines.join("\n"), { bg: "#ecfdf5" }))

  const footerButtons: object[] = [
    {
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#6366f1", height: "sm", flex: 1,
          action: { type: "postback", label: "🙋 เข้าร่วม", data: `sport:join:${bill.id}`, displayText: "🙋 เข้าร่วม" } },
        { type: "button", style: "secondary", height: "sm", flex: 1,
          action: { type: "postback", label: "❌ ยกเลิก", data: `sport:leave:${bill.id}`, displayText: "❌ ยกเลิกเข้าร่วม" } },
      ],
    },
  ]
  if (bill.map_url) {
    footerButtons.push({ type: "button", style: "link", height: "sm",
      action: { type: "uri", label: "🗺️ เปิดแผนที่", uri: bill.map_url } })
  }
  footerButtons.push({ type: "button", style: "link", height: "sm",
    action: { type: "uri", label: "📋 ดูรายละเอียด", uri: joinUrl(bill.share_token) } })

  return {
    type: "flex",
    altText: `${emoji} ชวนเล่น ${bill.title} — ${fmtTHB(perPerson)}/คน`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "120deg", startColor: "#6366f1", endColor: "#4f46e5" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "16px", spacing: "md", alignItems: "center",
          contents: [
            {
              type: "box", layout: "vertical", width: "44px", height: "44px", cornerRadius: "22px",
              backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center",
              contents: [{ type: "text", text: emoji, size: "lg", align: "center", gravity: "center" }],
            },
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: bill.title, color: "#ffffff", weight: "bold", size: "md", wrap: true },
                { type: "text", text: "🔥 ชวนเล่น — กดเข้าร่วมด้านล่างได้เลย", color: "#e0e7ff", size: "xxs", margin: "xs" },
              ],
            },
          ],
        }],
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", paddingAll: "16px",
        contents: rows,
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        backgroundColor: "#f8fafc",
        contents: footerButtons,
      },
    },
  }
}

// ─── Flex roster card for "เข้าร่วม/ยกเลิก" replies — shows each participant's
// LINE avatar + name, plus capacity (X/Y คน) and a "เต็มแล้ว" banner once full ─
async function buildParticipantRosterCard(billId: string, maxPlayers: number | null, shareToken?: string | null): Promise<object> {
  const { data: parts } = await supabase
    .from("split_participants")
    .select("name, line_picture_url")
    .eq("split_bill_id", billId)
    .order("created_at")

  const people = parts ?? []
  const n = people.length
  const isFull = !!maxPlayers && n >= maxPlayers
  const countLabel = maxPlayers ? `${n}/${maxPlayers} คน` : `${n} คน`

  const rows: object[] = people.length === 0
    ? [{ type: "text", text: "ยังไม่มีผู้เข้าร่วมครับ", size: "sm", color: "#9ca3af" }]
    : people.map((p, idx) => ({
        type: "box", layout: "horizontal", spacing: "md", alignItems: "center",
        contents: [
          { type: "text", text: `${idx + 1}.`, size: "sm", color: "#9ca3af", flex: 0, gravity: "center" },
          {
            type: "image", url: (p.line_picture_url as string | null) ?? FALLBACK_AVATAR_URL,
            aspectMode: "cover", aspectRatio: "1:1", size: "24px", flex: 0,
          },
          { type: "text", text: p.name as string, size: "sm", color: "#374151", wrap: true, flex: 1, gravity: "center" },
        ],
      }))

  // Re-sent after every join/leave/already-joined tap, so the join/cancel
  // buttons need to travel with the roster — otherwise the user would have
  // to scroll back up to the original invite card to toggle again.
  const footerContents: object[] = [
    {
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#6366f1", height: "sm", flex: 1,
          action: { type: "postback", label: "🙋 เข้าร่วม", data: `sport:join:${billId}`, displayText: "🙋 เข้าร่วม" } },
        { type: "button", style: "secondary", height: "sm", flex: 1,
          action: { type: "postback", label: "❌ ยกเลิก", data: `sport:leave:${billId}`, displayText: "❌ ยกเลิกเข้าร่วม" } },
      ],
    },
  ]
  if (!isFull && shareToken) {
    footerContents.push({
      type: "button", style: "link", height: "sm",
      action: { type: "uri", label: "➕ ลงชื่อให้เพื่อน", uri: addGuestUrl(shareToken) },
    })
  }
  const footer = {
    type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", paddingTop: "0px",
    contents: footerContents,
  }

  return {
    type: "flex",
    altText: isFull ? "🎉 ครบจำนวนผู้เข้าร่วมแล้ว!" : `👥 รายชื่อผู้เข้าร่วม (${n} คน)`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "0px",
        background: { type: "linearGradient", angle: "120deg", startColor: "#6366f1", endColor: "#4f46e5" },
        contents: [{
          type: "box", layout: "horizontal", paddingAll: "14px", spacing: "md", alignItems: "center",
          contents: [
            {
              type: "box", layout: "vertical", width: "32px", height: "32px", cornerRadius: "16px",
              backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center",
              contents: [{ type: "text", text: "👥", size: "sm", align: "center", gravity: "center" }],
            },
            {
              type: "box", layout: "vertical", flex: 1,
              contents: [
                { type: "text", text: `รายชื่อผู้เข้าร่วม (${countLabel})`, color: "#ffffff", weight: "bold", size: "sm", wrap: true },
                ...(isFull ? [{ type: "text", text: "🎉 ครบจำนวนแล้ว!", color: "#fde68a", weight: "bold", size: "xs", margin: "xs" }] : []),
              ],
            },
          ],
        }],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: rows,
      },
      footer,
    },
  }
}

// ─── In-chat join/leave via postback buttons on the invite card ──────────────
export async function handleSportToggle(
  billId: string, action: "join" | "leave", lineUserId: string, displayName: string,
  source?: { type: "group" | "room" | "user"; id: string | null },
): Promise<{ text?: string; card?: object }> {
  const { data: bill } = await supabase
    .from("split_bills")
    .select("id, sport_type, total_amount, status, booking_date, start_time, end_time, max_players, share_token")
    .eq("id", billId).eq("category", "sport")
    .maybeSingle()

  if (!bill) return { text: "❌ ไม่พบกลุ่มนี้ครับ (อาจถูกลบไปแล้ว)" }
  if (bill.status === "finalized") return { text: "🔒 กลุ่มนี้ปิดแล้วครับ" }

  const { data: existing } = await supabase
    .from("split_participants")
    .select("id")
    .eq("split_bill_id", billId).eq("line_user_id", lineUserId)
    .maybeSingle()

  const emoji = sportEmoji(bill.sport_type ?? "")

  if (action === "join") {
    if (existing) {
      const card = await buildParticipantRosterCard(billId, bill.max_players ?? null, bill.share_token)
      return { text: `✅ ${displayName} เข้าร่วมอยู่แล้วครับ`, card }
    }
    if (isRegistrationClosed(bill.booking_date, bill.start_time, bill.end_time)) {
      return { text: "⏰ เกินกำหนดการลงทะเบียนแล้วครับ" }
    }
    // Prefer the live group/room member profile (works for anyone in the
    // chat, even non-friends of the Slippy OA) — fall back to the OA-friend
    // profile, then to whatever displayName was passed in.
    let resolvedName = displayName
    let pictureUrl: string | null = null
    if (source?.id && (source.type === "group" || source.type === "room")) {
      const memberProfile = await getGroupMemberProfile(source.type, source.id, lineUserId)
      if (memberProfile) {
        resolvedName = memberProfile.displayName
        pictureUrl = memberProfile.pictureUrl
      }
    }
    if (!pictureUrl) pictureUrl = await getLinePictureUrl(lineUserId)

    await supabase.from("split_participants").insert({
      split_bill_id: billId, name: resolvedName, line_user_id: lineUserId,
      line_display: resolvedName, is_non_line: false, amount: 0, line_picture_url: pictureUrl,
    })
    await rebalance(billId, Number(bill.total_amount ?? 0))
    const card = await buildParticipantRosterCard(billId, bill.max_players ?? null, bill.share_token)
    return { text: `🙋 ${resolvedName} เข้าร่วม${emoji}${bill.sport_type ?? "กิจกรรม"}แล้วครับ!`, card }
  }

  // action === "leave"
  if (!existing) return { text: `${displayName} ยังไม่ได้เข้าร่วมกลุ่มนี้ครับ` }
  await supabase.from("split_participants").delete().eq("id", existing.id)
  await rebalance(billId, Number(bill.total_amount ?? 0))
  const card = await buildParticipantRosterCard(billId, bill.max_players ?? null, bill.share_token)
  return { text: `👋 ${displayName} ยกเลิกการเข้าร่วมแล้วครับ`, card }
}

// ─── Link a sport group/session to the LINE group chat it was shared into ────
// Triggered by the "📌 ตั้งเป็นกลุ่มหลัก" postback button — only the chat that
// actually taps the button reveals its group/room ID (shareTargetPicker never
// returns the picked chat's ID to the LIFF), so this is the only reliable way
// to capture it.
export async function handleSetLineGroup(
  targetType: "g" | "s", id: string, lineGroupId: string,
): Promise<{ text?: string; card?: object }> {
  if (targetType === "g") {
    const { data: group } = await supabase.from("sport_groups")
      .update({ line_group_id: lineGroupId })
      .eq("id", id)
      .select("title")
      .maybeSingle()
    if (!group) return { text: "❌ ไม่พบกลุ่มนี้ครับ" }

    // Propagate to upcoming sessions that haven't been individually overridden
    await supabase.from("split_bills")
      .update({ line_group_id: lineGroupId })
      .eq("sport_group_id", id)
      .is("line_group_id", null)
      .neq("status", "finalized")

    // Send the upcoming session's invite card right away so members can
    // join/leave straight from the now-linked group.
    const { data: session } = await supabase.from("split_bills")
      .select("id, title, sport_type, total_amount, venue, booking_date, start_time, end_time, court_no, map_url, max_players, extra_notes, sport_group_id, share_token, status")
      .eq("sport_group_id", id).eq("status", "open")
      .order("booking_date", { ascending: true })
      .limit(1).maybeSingle()

    const card = session ? await buildSportInviteFlex(session) : undefined
    return { text: `✅ ตั้งกลุ่มแชทนี้เป็นกลุ่มหลักของ "${group.title}" แล้วครับ — การ์ดเชิญและแจ้งเตือนของนัดต่อๆไปจะส่งมาที่นี่อัตโนมัติ`, card }
  }

  const { data: bill } = await supabase.from("split_bills")
    .update({ line_group_id: lineGroupId })
    .eq("id", id)
    .select("id, title, sport_type, total_amount, venue, booking_date, start_time, end_time, court_no, map_url, max_players, extra_notes, sport_group_id, share_token, status")
    .maybeSingle()
  if (!bill) return { text: "❌ ไม่พบกลุ่มนี้ครับ" }

  const card = bill.status === "open" ? await buildSportInviteFlex(bill) : undefined
  return { text: `✅ ตั้งกลุ่มแชทนี้เป็นกลุ่มหลักของ "${bill.title}" แล้วครับ`, card }
}

// ─── /linkgroup <code> — link the chat this command is sent from as the
// "main" LINE group for a sport group/session, looked up by share_token.
// Sent as a plain text command (works reliably in groups the bot has joined,
// unlike shareTargetPicker which can't confirm delivery back to the LIFF).
// ─── /linkgroup (no code) — bot replies in this chat with a pick-list of the
// org's recent sport groups/sessions. Tapping one fires a postback from the
// bot's OWN message, so event.source.groupId/roomId is reliably this chat's id.
export async function handleLinkGroupList(
  orgId: string,
): Promise<{ card?: object; text?: string }> {
  const { data: groups } = await supabase.from("sport_groups")
    .select("id, title, sport_type")
    .eq("organization_id", orgId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(5)

  const { data: bills } = await supabase.from("split_bills")
    .select("id, title, sport_type")
    .eq("organization_id", orgId).eq("category", "sport")
    .is("sport_group_id", null).eq("status", "open")
    .order("created_at", { ascending: false }).limit(5)

  const items = [
    ...(groups ?? []).map(g => ({ targetType: "g" as const, id: g.id, title: g.title, emoji: sportEmoji(g.sport_type ?? "") })),
    ...(bills ?? []).map(b => ({ targetType: "s" as const, id: b.id, title: b.title, emoji: sportEmoji(b.sport_type ?? "") })),
  ].slice(0, 8)

  if (items.length === 0) {
    return { text: "❌ ไม่พบกลุ่มกีฬาในองค์กรนี้ครับ — สร้างกลุ่มก่อนจากหน้า LIFF แล้วลองใหม่" }
  }

  return {
    card: {
      type: "flex",
      altText: "🔗 เลือกกลุ่มกีฬาที่จะเชื่อมกับแชทนี้",
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: "🔗 เชื่อมกลุ่ม LINE", weight: "bold", size: "lg" },
            { type: "text", text: "เลือกกลุ่ม/นัดที่จะตั้งแชทนี้เป็นกลุ่มหลัก — การ์ดเชิญและแจ้งเตือนจะส่งมาที่นี่อัตโนมัติ", size: "sm", color: "#555555", wrap: true, margin: "md" },
            { type: "separator", margin: "md" },
            ...items.map(it => ({
              type: "button", style: "secondary", height: "sm", margin: "sm",
              action: { type: "postback", label: `${it.emoji} ${it.title}`.slice(0, 40), data: `sport:linkgroupask:${it.targetType}:${it.id}`, displayText: `เลือก: ${it.title}` },
            })),
          ],
        },
      },
    },
  }
}

// ─── Confirmation step before linking — shows "อนุญาต / ปฏิเสธ" buttons,
// same pattern as the document approve/reject card. Tapping "อนุญาต" fires
// sport:linkgroupyes (does the actual link); "ปฏิเสธ" fires sport:linkgroupno.
export async function handleLinkGroupAsk(
  targetType: "g" | "s", id: string,
): Promise<{ card?: object; text?: string }> {
  const table = targetType === "g" ? "sport_groups" : "split_bills"
  const { data: row } = await supabase.from(table)
    .select("title").eq("id", id).maybeSingle()
  if (!row) return { text: "❌ ไม่พบรายการนี้ครับ" }

  return {
    card: {
      type: "flex",
      altText: `ยืนยันเชื่อมกลุ่มแชทนี้กับ "${row.title}"?`,
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: "🔗 ยืนยันการเชื่อมกลุ่ม", weight: "bold", size: "lg" },
            { type: "text", text: `ต้องการตั้งแชทนี้เป็นกลุ่มหลักของ "${row.title}" ใช่หรือไม่?\nการ์ดเชิญและแจ้งเตือนของนัดต่อๆไปจะส่งมาที่นี่อัตโนมัติ`, size: "sm", color: "#555555", wrap: true, margin: "md" },
            { type: "separator", margin: "md" },
            {
              type: "box", layout: "horizontal", spacing: "sm", margin: "md",
              contents: [
                { type: "button", style: "primary", height: "sm", flex: 1, color: "#10b981",
                  action: { type: "postback", label: "✓ อนุญาต", data: `sport:linkgroupyes:${targetType}:${id}`, displayText: "✓ อนุญาต" } },
                { type: "button", style: "primary", height: "sm", flex: 1, color: "#ef4444",
                  action: { type: "postback", label: "✕ ปฏิเสธ", data: "sport:linkgroupno", displayText: "✕ ปฏิเสธ" } },
              ]
            },
          ],
        },
      },
    },
  }
}

export async function handleLinkGroupCommand(
  shareToken: string, lineGroupId: string,
): Promise<{ text?: string; card?: object }> {
  const { data: group } = await supabase.from("sport_groups")
    .select("id").eq("share_token", shareToken).maybeSingle()
  if (group) return handleSetLineGroup("g", group.id, lineGroupId)

  const { data: bill } = await supabase.from("split_bills")
    .select("id").eq("share_token", shareToken).eq("category", "sport").maybeSingle()
  if (bill) return handleSetLineGroup("s", bill.id, lineGroupId)

  return { text: "❌ ไม่พบรายการที่ตรงกับโค้ดนี้ครับ — ตรวจสอบโค้ดอีกครั้ง" }
}

// ─── /sportinvite <code> — post the session's invite/join card into this chat.
// Sent as a plain text command via shareTargetPicker (same reliable pattern as
// /linkgroup) — the picked chat receives the text, the bot replies in that
// chat (event.source.groupId is reliable here), so the Flex card lands there.
export async function handleSportInviteCommand(
  shareToken: string,
): Promise<{ text?: string; card?: object }> {
  const sessionCols = "id, title, sport_type, total_amount, venue, booking_date, start_time, end_time, court_no, map_url, max_players, extra_notes, share_token, status, sport_group_id"

  const { data: group } = await supabase.from("sport_groups")
    .select("id").eq("share_token", shareToken).maybeSingle()

  let bill: any = null
  if (group) {
    const { data } = await supabase.from("split_bills")
      .select(sessionCols)
      .eq("sport_group_id", group.id).eq("status", "open")
      .order("booking_date", { ascending: true })
      .limit(1).maybeSingle()
    bill = data
  } else {
    const { data } = await supabase.from("split_bills")
      .select(sessionCols)
      .eq("share_token", shareToken).eq("category", "sport")
      .maybeSingle()
    bill = data
  }

  if (!bill) return { text: "❌ ไม่พบนัดที่จะเชิญครับ — อาจยังไม่มีนัดที่เปิดอยู่" }
  if (bill.status !== "open") return { text: "🔒 นัดนี้ปิดแล้วครับ" }

  return { card: await buildSportInviteFlex(bill) }
}

// ─── /sportpay [รหัสกลุ่ม] — mark caller's own share as paid ──────────────────
export async function handleSportPay(
  billIdPrefix: string, orgId: string, lineUserId: string, displayName: string,
): Promise<{ card?: object; text?: string }> {
  const bill = await findGroup(billIdPrefix, orgId)
  if (!bill) return { text: "❌ ไม่พบกลุ่มกีฬานี้ครับ" }
  if (bill.status === "finalized") return { text: "🔒 กลุ่มนี้ปิดแล้วครับ ดูยอดสุดท้ายได้ด้วย /sportstatus " + shortId(bill.id) }

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

  return handleSportStatus(shortId(bill.id), orgId, false)
}

// ─── Date/court-slot parsing helpers for /sportsession ───────────────────────
// "11/6/69" (D/M/2-digit BE) or "11/6/2569" (D/M/BE) or "2026-06-11" → "2026-06-11"
function parseSessionDate(input: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input
  const m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2500   // 2-digit Buddhist year, e.g. 69 → 2569
  if (year > 2400) year -= 543   // Buddhist → Christian era
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// "19:00x1,20:00x3,21:00x4" → [{ start_time: "19:00", court_count: 1 }, ...]
function parseCourtSlots(input: string): { start_time: string; court_count: number }[] | null {
  const parts = input.split(",").map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const slots: { start_time: string; court_count: number }[] = []
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}):?(\d{2})\s*[xX]\s*(\d+)$/)
    if (!m) return null
    slots.push({ start_time: `${m[1].padStart(2, "0")}:${m[2]}`, court_count: Number(m[3]) })
  }
  return slots
}

// ─── /sportclub <ชื่อก๊วน> | <ชนิดกีฬา> | <สนาม> | <จำนวนคนสูงสุด> ──────────────
// Creates the recurring club template (sport_groups) with only the "core"
// info that rarely changes. Date/court schedule/extra details are added per
// session via /sportsession; concept/map can be added later via
// /sportclubconcept and /sportclubmap.
export async function handleCreateSportClub(
  args: string[], orgId: string, lineUserId: string, displayName: string,
): Promise<{ text?: string; card?: object }> {
  const parts = args.join(" ").split("|").map(s => s.trim())
  const title = parts[0]

  if (!title) {
    return { text:
      "🏸 สร้างก๊วนกีฬาแบบนี้นะครับ:\n" +
      "/sportclub ชื่อก๊วน | ชนิดกีฬา | สนาม | จำนวนคนสูงสุด\n\n" +
      "ตัวอย่าง:\n" +
      "/sportclub ก๊วน Cheetah | แบด | สนาม play me | 30\n\n" +
      "ระบุแค่ข้อมูลหลักก่อนได้ครับ — ชนิดกีฬา/สนาม/จำนวนคนสูงสุดใส่ทีหลังก็ได้\n" +
      "ส่วนวันที่และจำนวนคอร์ดของแต่ละนัด ให้ใช้ /sportsession ตอนเปิดนัดใหม่"
    }
  }

  const sportType   = parts[1] || null
  const venue       = parts[2] || null
  const maxPlayers  = parts[3] ? (Number(parts[3]) || null) : null

  const { data: conn } = await supabase
    .from("line_connections")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .single()

  const { data: group, error } = await supabase
    .from("sport_groups")
    .insert({
      organization_id: orgId,
      creator_id:       conn?.user_id ?? null,
      title,
      sport_type:       sportType,
      default_venue:    venue,
      max_players:      maxPlayers,
    })
    .select("id, share_token")
    .single()

  if (error || !group) {
    return { text: `❌ สร้างก๊วนไม่สำเร็จ: ${error?.message ?? "ไม่ทราบสาเหตุ"}` }
  }

  return { text:
    `✅ สร้างก๊วน "${title}" แล้วครับ!\n🔑 โค้ด: ${group.share_token}\n\n` +
    `เพิ่มเติมได้ทีหลัง (ไม่บังคับ):\n` +
    `• /sportclubmap ${group.share_token} <ลิงก์ Google Maps>\n` +
    `• /sportclubconcept ${group.share_token} <Concept/กฎของก๊วน>\n\n` +
    `📅 เปิดนัดใหม่:\n` +
    `/sportsession ${group.share_token} <วันที่> <เวลาxจำนวนคอร์ด,...> [รายละเอียดเพิ่มเติม]\n` +
    `ตัวอย่าง:\n/sportsession ${group.share_token} 11/6/69 19:00x1,20:00x3,21:00x4 ลูกแบด CHAO PA\n\n` +
    `หลังเปิดนัดแรกแล้ว ใช้ /linkgroup <โค้ดนัด> ในกลุ่ม LINE ที่ต้องการ เพื่อผูกกลุ่มและรับการ์ดเชิญ`
  }
}

// ─── /sportclubconcept <code> <text...> — set/replace the club's concept ─────
export async function handleSetClubConcept(code: string, text: string): Promise<{ text?: string }> {
  const { data: group } = await supabase
    .from("sport_groups")
    .update({ concept_text: text })
    .eq("share_token", code)
    .select("title")
    .maybeSingle()

  if (!group) return { text: "❌ ไม่พบก๊วนที่ตรงกับโค้ดนี้ครับ" }
  return { text: `✅ บันทึก Concept ของ "${group.title}" แล้วครับ — จะแสดงในการ์ดเชิญของนัดถัดไป` }
}

// ─── /sportclubmap <code> <url> — set/replace the club's default map link ────
export async function handleSetClubMap(code: string, url: string): Promise<{ text?: string }> {
  const { data: group } = await supabase
    .from("sport_groups")
    .update({ default_map_url: url })
    .eq("share_token", code)
    .select("title")
    .maybeSingle()

  if (!group) return { text: "❌ ไม่พบก๊วนที่ตรงกับโค้ดนี้ครับ" }
  return { text: `✅ บันทึกลิงก์แผนที่ของ "${group.title}" แล้วครับ` }
}

// ─── /sportsession <code> <วันที่> <เวลาxจำนวนคอร์ด,...> [รายละเอียดเพิ่มเติม] ──
// Creates a new dated session under an existing club and immediately sends
// the invite card to the club's linked LINE group (if any).
export async function handleCreateSportSession(
  code: string, dateStr: string, slotsStr: string, extraNotes: string | null,
  lineUserId: string,
): Promise<{ text?: string; card?: object }> {
  const { data: group } = await supabase
    .from("sport_groups")
    .select("id, organization_id, title, sport_type, default_venue, default_map_url, max_players, line_group_id")
    .eq("share_token", code)
    .maybeSingle()

  if (!group) return { text: "❌ ไม่พบก๊วนที่ตรงกับโค้ดนี้ครับ — สร้างก๊วนก่อนด้วย /sportclub" }

  const bookingDate = parseSessionDate(dateStr)
  if (!bookingDate) return { text: "❌ รูปแบบวันที่ไม่ถูกต้องครับ ใช้ D/M/ปี พ.ศ. (เช่น 11/6/69) หรือ YYYY-MM-DD" }

  const slots = parseCourtSlots(slotsStr)
  if (!slots) return { text: "❌ รูปแบบช่วงเวลาไม่ถูกต้องครับ เช่น 19:00x1,20:00x3,21:00x4" }

  const { data: conn } = await supabase
    .from("line_connections")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .single()

  const earliestStart = slots.reduce((min, s) => (s.start_time < min ? s.start_time : min), slots[0].start_time)
  const courtSummary  = slots.map(s => `${s.court_count}`).join("/") + " สนาม"

  const { data: bill, error } = await supabase
    .from("split_bills")
    .insert({
      organization_id: group.organization_id,
      creator_id:       conn?.user_id ?? null,
      document_id:      null,
      title:            group.title,
      category:         "sport",
      sport_type:       group.sport_type,
      total_amount:     0,
      venue:            group.default_venue,
      map_url:          group.default_map_url,
      max_players:      group.max_players,
      booking_date:     bookingDate,
      start_time:       earliestStart,
      court_no:         courtSummary,
      extra_notes:      extraNotes,
      sport_group_id:   group.id,
      line_group_id:    group.line_group_id,
      status:           "open",
    })
    .select("id, title, sport_type, total_amount, venue, booking_date, start_time, end_time, court_no, map_url, max_players, extra_notes, sport_group_id, share_token, status")
    .single()

  if (error || !bill) return { text: `❌ สร้างนัดไม่สำเร็จ: ${error?.message ?? "ไม่ทราบสาเหตุ"}` }

  await supabase.from("session_court_slots").insert(
    slots.map(s => ({ split_bill_id: bill.id, start_time: s.start_time, court_count: s.court_count }))
  )

  const card = await buildSportInviteFlex(bill)

  if (group.line_group_id) {
    try {
      await pushMsg(group.line_group_id, [card])
      return { text: `✅ เปิดนัด "${group.title}" วัน${thaiDateLabel(bookingDate)} แล้วครับ — ส่งการ์ดเชิญเข้ากลุ่มเรียบร้อย` }
    } catch (e: any) {
      return { text: `✅ เปิดนัด "${group.title}" วัน${thaiDateLabel(bookingDate)} แล้วครับ แต่ส่งการ์ดเข้ากลุ่มไม่สำเร็จ: ${e.message}`, card }
    }
  }

  return { text:
    `✅ เปิดนัด "${group.title}" วัน${thaiDateLabel(bookingDate)} แล้วครับ\n` +
    `ยังไม่ได้ผูกกลุ่ม LINE — ใช้ /linkgroup ${bill.share_token} ในกลุ่มเพื่อส่งการ์ดเชิญ`,
    card,
  }
}
