import { createAdminClient } from "@/lib/supabase/admin"

export const SPORT_EMOJI: Record<string, string> = {
  "แบด": "🏸", "แบดมินตัน": "🏸", "badminton": "🏸",
  "ฟุตบอล": "⚽", "football": "⚽", "soccer": "⚽", "ฟุตซอล": "⚽",
  "บาส": "🏀", "บาสเกตบอล": "🏀", "basketball": "🏀",
  "เทนนิส": "🎾", "tennis": "🎾",
  "วอลเลย์บอล": "🏐", "วอลเลย์": "🏐", "volleyball": "🏐",
  "ปิงปอง": "🏓", "table tennis": "🏓",
  "ว่ายน้ำ": "🏊", "swimming": "🏊",
  "วิ่ง": "🏃", "running": "🏃",
  "ปั่นจักรยาน": "🚴", "จักรยาน": "🚴", "cycling": "🚴",
  "กอล์ฟ": "⛳", "golf": "⛳",
}
export function sportEmoji(t: string) { return SPORT_EMOJI[(t ?? "").toLowerCase()] ?? "🏃" }

// A session's registration window closes at its end time (or start time if no
// end time) on the booking date. Sessions with no booking date never close.
export function isRegistrationClosed(bookingDate: string | null, startTime: string | null, endTime: string | null): boolean {
  if (!bookingDate) return false
  const deadline = new Date(`${bookingDate}T${endTime ?? startTime ?? "23:59"}:00`)
  return Date.now() > deadline.getTime()
}

// Resolve a LINE userId → { organization_id, user_id } via line_connections.
// Sport groups require a linked account (same as the chat /sportgroup flow) —
// this keeps creator_id/org consistent and avoids partial/orphaned connections.
export async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// Each top-level participant occupies (1 + guest_count + namedGuestCount)
// "seats" — guest_count is the self-reported "+1" stepper, namedGuestCount is
// how many friends they signed up by name via the public join-link guest
// form. Named guests (added_by_participant_id set) don't get their own
// amount — their share folds into whoever added them, who settles up with
// them directly ("จัดการกันเอาเอง").
export async function rebalance(admin: ReturnType<typeof createAdminClient>, billId: string, totalAmount: number) {
  const { data: parts } = await admin.from("split_participants")
    .select("id, guest_count, added_by_participant_id").eq("split_bill_id", billId)
  const all = parts ?? []
  if (all.length === 0) return 0

  const namedGuestCountByParent = new Map<string, number>()
  for (const p of all) {
    if ((p as any).added_by_participant_id) {
      const parentId = (p as any).added_by_participant_id as string
      namedGuestCountByParent.set(parentId, (namedGuestCountByParent.get(parentId) ?? 0) + 1)
    }
  }

  const topLevel = all.filter(p => !(p as any).added_by_participant_id)
  const namedGuestRowCount = all.length - topLevel.length
  const seats = topLevel.reduce((s, p: any) => s + 1 + (p.guest_count ?? 0), 0) + namedGuestRowCount
  if (seats > 0) {
    const share = Math.round((totalAmount / seats) * 100) / 100
    for (const p of all) {
      if ((p as any).added_by_participant_id) {
        await admin.from("split_participants").update({ amount: 0 }).eq("id", p.id)
        continue
      }
      const weight = 1 + ((p as any).guest_count ?? 0) + (namedGuestCountByParent.get(p.id) ?? 0)
      const amount = Math.round(share * weight * 100) / 100
      await admin.from("split_participants").update({ amount }).eq("id", p.id)
    }
  }
  return all.length
}

export async function loadSessionDetail(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  lineUserId?: string | null,
) {
  const { data: bill } = await admin.from("split_bills")
    .select("id, title, sport_type, venue, total_amount, status, share_token, organization_id, creator_id, booking_date, start_time, end_time, court_no, map_url, max_players, sport_group_id, line_group_id, promptpay_id, split_participants(id, name, amount, paid_at, line_user_id, guest_count, payment_proof_url, line_picture_url, added_by_participant_id)")
    .eq("id", id)
    .eq("category", "sport")
    .maybeSingle()

  if (!bill) return null

  let groupTitle: string | null = null
  let groupPromptpayId: string | null = null
  if (bill.sport_group_id) {
    const { data: group } = await admin.from("sport_groups")
      .select("title, promptpay_id").eq("id", bill.sport_group_id).maybeSingle()
    groupTitle = group?.title ?? null
    groupPromptpayId = group?.promptpay_id ?? null
  }

  let isCreator = false
  if (lineUserId) {
    const conn = await resolveConnection(admin, lineUserId)
    isCreator = !!conn && conn.user_id === bill.creator_id
  }

  const { data: expenseRows } = await admin.from("session_expenses")
    .select("id, category, label, amount, created_at")
    .eq("split_bill_id", id)
    .order("created_at", { ascending: true })

  const expenses = (expenseRows ?? []).map(e => ({
    id: e.id, category: e.category, label: e.label, amount: Number(e.amount),
  }))
  const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  const lineIds = (bill.split_participants as any[]).map(p => p.line_user_id).filter(Boolean)
  let userIdByLineId: Record<string, string> = {}
  if (lineIds.length > 0) {
    const { data: conns } = await admin.from("line_connections")
      .select("line_user_id, user_id").in("line_user_id", lineIds)
    userIdByLineId = Object.fromEntries((conns ?? []).map((c: any) => [c.line_user_id, c.user_id]))
  }

  const allParticipants = (bill.split_participants as any[])
    .map(participant => ({
      id: participant.id,
      name: participant.name,
      amount: Number(participant.amount),
      paid: !!participant.paid_at,
      isMe: lineUserId ? participant.line_user_id === lineUserId : false,
      guestCount: participant.guest_count ?? 0,
      paymentProofUrl: participant.payment_proof_url ?? null,
      pendingReview: !!participant.payment_proof_url && !participant.paid_at,
      linePictureUrl: participant.line_picture_url ?? null,
      userId: participant.line_user_id ? (userIdByLineId[participant.line_user_id] ?? null) : null,
      addedByParticipantId: participant.added_by_participant_id ?? null,
    }))

  // Guests added via the public join link ("ลงชื่อให้เพื่อนที่ไม่ได้อยู่ในกลุ่ม
  // LINE") aren't shown as flat rows — they're nested under whoever added
  // them (tree), and don't carry their own amount/paid status.
  const guestsByParent = new Map<string, typeof allParticipants>()
  for (const p of allParticipants) {
    if (!p.addedByParticipantId) continue
    const list = guestsByParent.get(p.addedByParticipantId) ?? []
    list.push(p)
    guestsByParent.set(p.addedByParticipantId, list)
  }

  const participants = allParticipants
    .filter(p => !p.addedByParticipantId)
    .map(p => ({ ...p, guests: (guestsByParent.get(p.id) ?? []).map(g => ({ id: g.id, name: g.name })) }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))

  return {
    id: bill.id,
    title: bill.title,
    emoji: sportEmoji(bill.sport_type ?? ""),
    sportType: bill.sport_type,
    venue: bill.venue,
    fee: Number(bill.total_amount),
    status: bill.status,
    shareToken: bill.share_token,
    bookingDate: bill.booking_date,
    startTime: bill.start_time,
    endTime: bill.end_time,
    courtNo: bill.court_no,
    mapUrl: bill.map_url,
    maxPlayers: bill.max_players,
    sportGroupId: bill.sport_group_id,
    lineGroupId: bill.line_group_id,
    promptpayId: bill.promptpay_id ?? groupPromptpayId,
    groupTitle,
    isCreator,
    participants,
    paidTotal: participants.filter(participant => participant.paid)
      .reduce((sum, participant) => sum + participant.amount, 0),
    expenses,
    expensesTotal,
  }
}

// "19:00x2,20:00x4,21:00x5" → [{ start_time: "19:00", court_count: 2 }, ...]
// Same syntax as the LINE bot's /sportsession command, so the LIFF "สร้างนัดใหม่"
// form can offer the same multi-slot court-count detail (e.g. "เปิด 2 สนาม
// ตอน 19:00, เปิด 4 สนามตอน 20:00") without learning a different format.
export function parseCourtSlots(input: string): { start_time: string; court_count: number }[] | null {
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

export const SESSION_GENERATION_WEEKS = 4

export interface SportGroupRow {
  id: string
  organization_id: string
  creator_id: string
  title: string
  sport_type: string | null
  recurring_days: number[]
  default_start_time: string | null
  default_end_time: string | null
  default_venue: string | null
  default_court_no: string | null
  default_map_url: string | null
  max_players: number | null
  line_group_id: string | null
}

/** "YYYY-MM-DD" for a Date in local time (avoids UTC-shift off-by-one) */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Generates upcoming dated sessions (split_bills rows) for a recurring
// sport_groups template, one per matching weekday in [from, from+weeksAhead*7].
// Idempotent — skips dates that already have a session for this group.
export async function generateSessions(
  admin: ReturnType<typeof createAdminClient>,
  group: SportGroupRow,
  opts: { from?: Date; weeksAhead?: number } = {},
) {
  if (!group.recurring_days?.length) return []

  const weeksAhead = opts.weeksAhead ?? SESSION_GENERATION_WEEKS
  const from = opts.from ?? new Date()
  const horizonDays = weeksAhead * 7

  const dates: string[] = []
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(from)
    d.setDate(d.getDate() + i)
    if (group.recurring_days.includes(d.getDay())) dates.push(ymd(d))
  }
  if (dates.length === 0) return []

  const { data: existing } = await admin.from("split_bills")
    .select("booking_date")
    .eq("sport_group_id", group.id)
    .in("booking_date", dates)

  const existingDates = new Set((existing ?? []).map(b => b.booking_date as string))
  const toCreate = dates.filter(d => !existingDates.has(d))
  if (toCreate.length === 0) return []

  const title = group.default_venue ? `${group.sport_type} @ ${group.default_venue}` : group.sport_type ?? group.title

  const rows = toCreate.map(bookingDate => ({
    organization_id: group.organization_id,
    creator_id:      group.creator_id,
    document_id:     null,
    category:        "sport",
    sport_group_id:  group.id,
    sport_type:      group.sport_type,
    venue:           group.default_venue,
    title,
    total_amount:    0,
    status:          "open",
    booking_date:    bookingDate,
    start_time:      group.default_start_time,
    end_time:        group.default_end_time,
    court_no:        group.default_court_no,
    map_url:         group.default_map_url,
    max_players:     group.max_players,
    line_group_id:   group.line_group_id,
  }))

  const { data: created, error } = await admin.from("split_bills")
    .insert(rows)
    .select("id, share_token, booking_date")

  if (error || !created) return []

  // Auto-add the creator as the first participant of each new session.
  const { data: creator } = await admin.from("line_connections")
    .select("line_user_id, display_name")
    .eq("user_id", group.creator_id)
    .eq("organization_id", group.organization_id)
    .maybeSingle()

  await admin.from("split_participants").insert(
    created.map(bill => ({
      split_bill_id: bill.id,
      name:          creator?.display_name ?? "ผู้สร้างกลุ่ม",
      line_user_id:  creator?.line_user_id ?? null,
      line_display:  creator?.display_name ?? null,
      is_non_line:   !creator?.line_user_id,
      amount:        0,
      guest_count:   0,
    }))
  )

  return created
}
