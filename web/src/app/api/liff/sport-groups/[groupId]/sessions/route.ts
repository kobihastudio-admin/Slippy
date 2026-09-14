import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sportEmoji, resolveConnection, generateSessions, parseCourtSlots, SportGroupRow } from "../../_lib"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

// GET /api/liff/sport-groups/[groupId]/sessions?lineUserId=Uxxx
// — recurring schedule + list of generated sessions, ordered by date
export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const admin = createAdminClient()

  const { data: group } = await admin.from("sport_groups")
    .select("id, title, sport_type, recurring_days, default_start_time, default_end_time, default_venue, default_court_no, default_map_url, max_players, status, share_token, line_group_id, concept_text")
    .eq("id", groupId)
    .maybeSingle()

  if (!group) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const { data: bills } = await admin.from("split_bills")
    .select("id, title, sport_type, venue, total_amount, status, share_token, booking_date, start_time, end_time, court_no, map_url, max_players, split_participants(id, name, amount, paid_at, line_user_id, guest_count)")
    .eq("sport_group_id", groupId)
    .order("booking_date", { ascending: true })

  const sessions = (bills ?? []).map((b: any) => {
    const participants = b.split_participants as any[]
    const paid  = participants.filter(p => p.paid_at).length
    const total = participants.length
    return {
      id:          b.id,
      title:       b.title,
      emoji:       sportEmoji(b.sport_type ?? ""),
      sportType:   b.sport_type,
      venue:       b.venue,
      fee:         Number(b.total_amount),
      status:      b.status,
      shareToken:  b.share_token,
      bookingDate: b.booking_date,
      startTime:   b.start_time,
      endTime:     b.end_time,
      courtNo:     b.court_no,
      mapUrl:      b.map_url,
      maxPlayers:  b.max_players,
      paidCount:   paid,
      headCount:   total,
      isMember:    lineUserId ? participants.some(p => p.line_user_id === lineUserId) : false,
    }
  })

  return NextResponse.json({
    group: {
      id:               group.id,
      title:            group.title,
      emoji:            sportEmoji(group.sport_type ?? ""),
      sportType:        group.sport_type,
      recurringDays:    group.recurring_days,
      defaultStartTime: group.default_start_time,
      defaultEndTime:   group.default_end_time,
      defaultVenue:     group.default_venue,
      defaultCourtNo:   group.default_court_no,
      defaultMapUrl:    group.default_map_url,
      maxPlayers:       group.max_players,
      status:           group.status,
      shareToken:       group.share_token,
      lineGroupId:      group.line_group_id,
      conceptText:      group.concept_text ?? null,
    },
    sessions,
  })
}

// POST /api/liff/sport-groups/[groupId]/sessions
// — { action: "generateMore" }: extend the schedule forward from the latest
//   existing session's date
// — { action: "addSession", bookingDate, startTime?, endTime? }: insert one
//   ad-hoc session outside the recurring pattern
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const body = await req.json() as {
    action: "generateMore" | "addSession" | "setConcept"
    lineUserId: string
    bookingDate?: string
    startTime?: string
    endTime?: string
    courtSlots?: string   // "19:00x2,20:00x4,21:00x5" — same syntax as /sportsession
    extraNotes?: string   // e.g. "วันนี้ใช้ลูกแบดมินตัน CHAO PA"
    conceptText?: string  // ก๊วน concept/กฎ — same as /sportclubconcept
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 })

  const admin = createAdminClient()
  const conn = await resolveConnection(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน" }, { status: 403 })

  const { data: group } = await admin.from("sport_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle()
  if (!group) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })
  if (group.creator_id !== conn.user_id) {
    return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่จัดการเซสชันได้" }, { status: 403 })
  }

  if (body.action === "generateMore") {
    const { data: latest } = await admin.from("split_bills")
      .select("booking_date")
      .eq("sport_group_id", groupId)
      .order("booking_date", { ascending: false })
      .limit(1)
      .maybeSingle()

    const from = latest?.booking_date
      ? new Date(new Date(latest.booking_date + "T00:00:00").getTime() + 86400000)
      : new Date()

    await generateSessions(admin, group as SportGroupRow, { from })
  }

  if (body.action === "setConcept") {
    await admin.from("sport_groups").update({ concept_text: body.conceptText?.trim() || null }).eq("id", groupId)
  }

  if (body.action === "addSession") {
    if (!body.bookingDate) return NextResponse.json({ error: "bookingDate required" }, { status: 400 })

    // ช่วงเวลาแบบหลายช่วง พร้อมจำนวนสนามต่อช่วง เช่น "19:00x2,20:00x4,21:00x5"
    // — เอาช่วงแรก (เวลาที่เร็วที่สุด) มาใช้เป็น start_time หลักของนัด เหมือนที่
    // /sportsession ทำ ส่วนรายละเอียดครบทุกช่วงจะไปแสดงในการ์ดเชิญผ่าน session_court_slots
    let slots: { start_time: string; court_count: number }[] | null = null
    if (body.courtSlots?.trim()) {
      slots = parseCourtSlots(body.courtSlots.trim())
      if (!slots) {
        return NextResponse.json({ error: "รูปแบบช่วงเวลาไม่ถูกต้องครับ เช่น 19:00x2,20:00x4,21:00x5" }, { status: 400 })
      }
    }
    const earliestStart = slots?.length
      ? slots.reduce((min, s) => (s.start_time < min ? s.start_time : min), slots[0].start_time)
      : body.startTime || group.default_start_time
    const courtSummary = slots?.length ? slots.map(s => s.court_count).join("/") + " สนาม" : group.default_court_no

    const title = group.default_venue ? `${group.sport_type} @ ${group.default_venue}` : group.sport_type ?? group.title

    const { data: bill, error } = await admin.from("split_bills")
      .insert({
        organization_id: group.organization_id,
        creator_id:      group.creator_id,
        document_id:     null,
        category:        "sport",
        sport_group_id:  group.id,
        sport_type:       group.sport_type,
        venue:            group.default_venue,
        title,
        total_amount:    0,
        status:          "open",
        booking_date:    body.bookingDate,
        start_time:      earliestStart,
        end_time:        body.endTime || group.default_end_time,
        court_no:        courtSummary,
        map_url:         group.default_map_url,
        max_players:     group.max_players,
        line_group_id:   group.line_group_id,
        extra_notes:     body.extraNotes?.trim() || null,
      })
      .select("id")
      .single()

    if (error || !bill) return NextResponse.json({ error: error?.message ?? "เพิ่มเซสชันไม่สำเร็จ" }, { status: 500 })

    if (slots?.length) {
      await admin.from("session_court_slots").insert(
        slots.map(s => ({ split_bill_id: bill.id, start_time: s.start_time, court_count: s.court_count }))
      )
    }

    await admin.from("split_participants").insert({
      split_bill_id: bill.id,
      name:          conn.display_name ?? "ผู้สร้างกลุ่ม",
      line_user_id:  body.lineUserId,
      line_display:  conn.display_name,
      is_non_line:   false,
      amount:        0,
      guest_count:   0,
    })
  }

  // Return the refreshed group + sessions list
  const refreshed = await GET(
    new NextRequest(`${req.nextUrl.origin}${req.nextUrl.pathname}?lineUserId=${encodeURIComponent(body.lineUserId)}`),
    { params: Promise.resolve({ groupId }) },
  )
  return refreshed
}
