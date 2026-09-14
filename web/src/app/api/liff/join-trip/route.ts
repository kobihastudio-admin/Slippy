import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { liffUnauthorized, verifyClaimedLineUser } from "@/lib/liff-auth"

// POST — Join a trip via LIFF (no /connect required)
export async function POST(req: NextRequest) {
  const { token, lineUserId, displayName, pictureUrl, guestName } = await req.json() as {
    token:        string
    lineUserId?:  string
    displayName?: string
    pictureUrl?:  string
    guestName?:   string
  }

  const participantName = guestName?.trim() || displayName?.trim()
  if (!token || !participantName) return NextResponse.json({ error: "token and participant name required" }, { status: 400 })

  if (lineUserId) {
    const verifiedLineUserId = await verifyClaimedLineUser(req, lineUserId)
    if (!verifiedLineUserId) return liffUnauthorized("LINE identity mismatch")
  }

  const admin = createAdminClient()

  // Find trip by token
  const { data: journey } = await admin.from("life_journeys")
    .select("id, status, organization_id")
    .eq("share_token", token)
    .single()

  if (!journey) return NextResponse.json({ error: "Trip not found" }, { status: 404 })
  if (journey.status === "settled") return NextResponse.json({ error: "Trip is already settled" }, { status: 400 })

  // Check if already joined
  const existingQuery = admin.from("trip_participants")
    .select("id")
    .eq("journey_id", journey.id)
  const { data: existing } = lineUserId
    ? await existingQuery.eq("line_user_id", lineUserId).maybeSingle()
    : await existingQuery.is("line_user_id", null).eq("display_name", participantName).maybeSingle()

  if (existing) return NextResponse.json({ ok: true, alreadyJoined: true })

  // Add participant
  await admin.from("trip_participants").insert({
    journey_id:   journey.id,
    line_user_id: lineUserId ?? null,
    display_name: participantName,
    is_non_line:  !lineUserId,
    is_host:      false,
    amount_owed:  0,
    amount_paid:  0,
  })

  // Also auto-register line_connection if not exists (lightweight — no full org link)
  // This lets the bot push notifications to this user for this trip
  if (lineUserId) {
    const { data: existing_conn } = await admin.from("line_connections")
      .select("id").eq("line_user_id", lineUserId).maybeSingle()

    if (!existing_conn) {
      // A full line_connection requires a Slippy user_id. Do not create an
      // orphaned identity here; the participant can link their account later.
      console.info("[join-trip] LINE participant has no linked Slippy account", lineUserId)
    }
  }

  return NextResponse.json({ ok: true, joined: true })
}
