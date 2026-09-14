import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isRegistrationClosed } from "../sport-groups/_lib"

// Public endpoint — no auth required (join links are public by token)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  const type  = req.nextUrl.searchParams.get("type") ?? "trip"
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 })

  const admin = createAdminClient()

  if (type === "trip") {
    const { data } = await admin.from("life_journeys")
      .select(`
        id, title, trip_type, venue, destination, status,
        trip_participants(id, display_name, is_host, amount_owed)
      `)
      .eq("share_token", token)
      .single()

    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const host = (data.trip_participants as any[]).find(p => p.is_host)
    const totalOwed = (data.trip_participants as any[]).reduce((s, p) => s + Number(p.amount_owed), 0)

    return NextResponse.json({
      bill: {
        id:           data.id,
        title:        data.title,
        type:         data.trip_type ?? "trip",
        venue:        data.venue ?? data.destination,
        host:         host?.display_name ?? "—",
        participants: (data.trip_participants as any[]).length,
        total:        totalOwed,
      }
    })
  }

  // Split bill (incl. sport groups — category='sport', trip groups — category='trip')
  const { data } = await admin.from("split_bills")
    .select(`id, title, total_amount, category, sport_type, venue, trip_type, destination, status, booking_date, start_time, end_time, max_players, promptpay_id, sport_group_id, split_participants(id, name, is_host:line_user_id)`)
    .eq("share_token", token)
    .single()

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const category = (data as any).category
  const venueOrDestination = category === "trip" ? (data as any).destination : (data as any).venue

  const registrationClosed = category === "sport" && (data as any).status !== "finalized"
    && isRegistrationClosed((data as any).booking_date, (data as any).start_time, (data as any).end_time)

  // PromptPay ID — falls back to the recurring sport_groups default if this
  // session doesn't have its own override.
  let promptpayId: string | null = (data as any).promptpay_id ?? null
  if (!promptpayId && (data as any).sport_group_id) {
    const { data: sportGroup } = await admin.from("sport_groups")
      .select("promptpay_id")
      .eq("id", (data as any).sport_group_id)
      .maybeSingle()
    promptpayId = sportGroup?.promptpay_id ?? null
  }

  return NextResponse.json({
    bill: {
      id:           data.id,
      title:        data.title,
      type:         category === "sport" ? "sport" : category === "trip" ? "trip" : category === "general" ? "general" : "split",
      venue:        venueOrDestination ?? null,
      host:         (data.split_participants as any[])[0]?.name ?? "—",
      participants: (data.split_participants as any[]).length,
      total:        Number(data.total_amount),
      maxPlayers:   (data as any).max_players ?? null,
      registrationClosed,
      promptpayId,
      status:       (data as any).status,
    }
  })
}
