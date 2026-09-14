import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sportEmoji, resolveConnection } from "./_lib"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

// GET /api/liff/sport-groups?lineUserId=Uxxx — list recurring sport groups
// (created by this user) plus legacy standalone sessions (sport_group_id IS NULL)
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, groups: [], legacySessions: [] })

  // Recurring groups created by this user
  const { data: sportGroups } = await admin.from("sport_groups")
    .select("id, title, sport_type, recurring_days, default_start_time, default_end_time, default_venue, default_court_no, max_players, status, share_token")
    .eq("creator_id", conn.user_id)
    .eq("status", "active")
    .order("created_at", { ascending: false })

  let groups: any[] = []
  if (sportGroups?.length) {
    const groupIds = sportGroups.map(g => g.id)
    const { data: sessions } = await admin.from("split_bills")
      .select("id, sport_group_id, booking_date, total_amount, split_participants(id, paid_at)")
      .in("sport_group_id", groupIds)
      .gte("booking_date", new Date().toISOString().slice(0, 10))
      .order("booking_date", { ascending: true })

    groups = sportGroups.map(g => {
      const upcoming = (sessions ?? []).filter((s: any) => s.sport_group_id === g.id)
      return {
        id:               g.id,
        title:            g.title,
        emoji:            sportEmoji(g.sport_type ?? ""),
        sportType:        g.sport_type,
        recurringDays:    g.recurring_days,
        defaultStartTime: g.default_start_time,
        defaultEndTime:   g.default_end_time,
        defaultVenue:     g.default_venue,
        defaultCourtNo:   g.default_court_no,
        maxPlayers:       g.max_players,
        status:           g.status,
        shareToken:       g.share_token,
        upcomingSessionCount: upcoming.length,
        nextSessionDate:      upcoming[0]?.booking_date ?? null,
      }
    })
  }

  // Legacy standalone sessions (chat /sportgroup, or pre-migration LIFF groups)
  const { data: parts } = await admin.from("split_participants")
    .select("split_bill_id")
    .eq("line_user_id", lineUserId)

  const billIds = [...new Set((parts ?? []).map(p => p.split_bill_id))]
  let legacySessions: any[] = []
  if (billIds.length > 0) {
    const { data: bills } = await admin.from("split_bills")
      .select("id, title, sport_type, venue, total_amount, status, share_token, created_at, booking_date, start_time, end_time, court_no, map_url, max_players, sport_group_id, split_participants(id, name, amount, paid_at, guest_count)")
      .in("id", billIds)
      .eq("category", "sport")
      .is("sport_group_id", null)
      .order("created_at", { ascending: false })

    legacySessions = (bills ?? []).map((b: any) => {
      const paid  = (b.split_participants as any[]).filter(p => p.paid_at).length
      const total = (b.split_participants as any[]).length
      return {
        id:          b.id,
        title:       b.title,
        emoji:       sportEmoji(b.sport_type ?? ""),
        sportType:   b.sport_type,
        venue:       b.venue,
        fee:         Number(b.total_amount),
        status:      b.status,
        shareToken:  b.share_token,
        createdAt:   b.created_at,
        bookingDate: b.booking_date,
        startTime:   b.start_time,
        endTime:     b.end_time,
        courtNo:     b.court_no,
        mapUrl:      b.map_url,
        maxPlayers:  b.max_players,
        paidCount:   paid,
        headCount:   total,
      }
    })
  }

  return NextResponse.json({ groups, legacySessions })
}

// POST /api/liff/sport-groups — create a new recurring sport group + auto-generate
// its first batch of upcoming sessions
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    lineUserId:  string
    displayName: string
    sportType:   string
    venue?:      string
    recurringDays: number[]
    startTime?:   string  // "HH:MM"
    endTime?:     string  // "HH:MM"
    courtNo?:     string
    mapUrl?:      string
    maxPlayers?:  number
    lineGroupId?: string  // LINE group/room chat this was created from — receives invite cards
    promptpayId?: string  // host's PromptPay mobile/national ID — for dynamic QR
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const {
    displayName, sportType, venue,
    recurringDays, startTime, endTime, courtNo, mapUrl, maxPlayers, lineGroupId, promptpayId,
  } = body

  if (!sportType) {
    return NextResponse.json({ error: "lineUserId, sportType required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน — เข้าสู่ระบบด้วย LINE ที่หน้า Slippy login (เชื่อมอัตโนมัติ) หรือพิมพ์ /connect CODE ในแชท" }, { status: 403 })

  const title = venue ? `${sportType} @ ${venue}` : sportType

  const { data: group, error } = await admin.from("sport_groups")
    .insert({
      organization_id:    conn.organization_id,
      creator_id:         conn.user_id,
      title,
      sport_type:         sportType,
      recurring_days:     recurringDays ?? [],
      default_start_time: startTime || null,
      default_end_time:   endTime || null,
      default_venue:      venue || null,
      default_court_no:   courtNo || null,
      default_map_url:    mapUrl || null,
      max_players:        maxPlayers || null,
      line_group_id:      lineGroupId || null,
      promptpay_id:       promptpayId || null,
    })
    .select("*")
    .single()

  if (error || !group) return NextResponse.json({ error: error?.message ?? "สร้างกลุ่มไม่สำเร็จ" }, { status: 500 })

  return NextResponse.json({
    ok: true,
    groupId:    group.id,
    shareToken: group.share_token,
  })
}

// DELETE /api/liff/sport-groups?groupId=xxx&lineUserId=Uxxx — archive a recurring
// sport group (e.g. to clean up duplicates created during testing). Soft-delete
// via status='archived' so it drops out of the "active" list above.
export async function DELETE(req: NextRequest) {
  const groupId    = req.nextUrl.searchParams.get("groupId")
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!groupId || !lineUserId) return NextResponse.json({ error: "groupId and lineUserId required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "กรุณาเชื่อมบัญชี LINE ก่อน" }, { status: 403 })

  const { data: group } = await admin.from("sport_groups")
    .select("id, creator_id").eq("id", groupId).maybeSingle()
  if (!group) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })
  if (group.creator_id !== conn.user_id) return NextResponse.json({ error: "ไม่มีสิทธิ์ลบกลุ่มนี้" }, { status: 403 })

  await admin.from("sport_groups").update({ status: "archived" }).eq("id", groupId)

  return NextResponse.json({ ok: true })
}
