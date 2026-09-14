import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { getTripAccess }  from "@/lib/trips/trip-access"
import { recordDenied }   from "@/lib/activity-log"

type Params = { params: Promise<{ id: string }> }

// POST — record a payment (with optional slip image)
export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json() as {
    from_participant: string   // participant ID paying
    to_participant:   string   // participant ID receiving
    amount:           number
    slip_url?:        string   // optional slip image
    note?:            string
  }

  const admin = createAdminClient()

  const { data: payment, error } = await admin.from("trip_payments").insert({
    journey_id:       tripId,
    from_participant: body.from_participant,
    to_participant:   body.to_participant,
    amount:           body.amount,
    slip_url:         body.slip_url ?? null,
    note:             body.note ?? null,
    status:           "pending",
  }).select("id").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ paymentId: payment?.id, status: "pending" })
}

// PATCH — confirm or dispute a payment
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { paymentId, action } = await req.json() as {
    paymentId: string
    action:    "confirm" | "dispute"
  }

  const admin = createAdminClient()
  const newStatus = action === "confirm" ? "confirmed" : "disputed"

  await admin.from("trip_payments").update({
    status:       newStatus,
    confirmed_at: action === "confirm" ? new Date().toISOString() : null,
  }).eq("id", paymentId)

  // If confirmed → update amount_paid for the payer
  if (action === "confirm") {
    const { data: payment } = await admin.from("trip_payments")
      .select("from_participant, amount").eq("id", paymentId).single()

    if (payment) {
      const { data: p } = await admin.from("trip_participants")
        .select("amount_paid").eq("id", payment.from_participant).single()
      await admin.from("trip_participants").update({
        amount_paid: Number(p?.amount_paid ?? 0) + Number(payment.amount),
        paid_at:     new Date().toISOString(),
      }).eq("id", payment.from_participant)
    }
  }

  return NextResponse.json({ ok: true, status: newStatus })
}

// GET — list payments for a trip with settlement summary
export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [paymentsRes, settlementRes] = await Promise.all([
    supabase.from("trip_payments")
      .select(`
        id, amount, slip_url, note, status, paid_at, confirmed_at,
        from_participant, to_participant
      `)
      .eq("journey_id", tripId)
      .order("paid_at", { ascending: false }),

    createAdminClient().rpc("calculate_trip_settlement", { p_journey_id: tripId }),
  ])

  return NextResponse.json({
    payments:   paymentsRes.data ?? [],
    settlement: settlementRes.data ?? [],
  })
}
