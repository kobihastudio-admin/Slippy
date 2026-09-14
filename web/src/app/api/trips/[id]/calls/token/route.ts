/**
 * Mints a LiveKit join token for this trip's call room. LIVEKIT_API_SECRET
 * never leaves this route — see livekit-config.ts.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { mintCallToken, endCallSession } from "@/lib/trips/calls"
import { tripFeatures, featureDisabledResponse } from "@/lib/trips/trip-features"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  if (!tripFeatures.calls) {
    const disabled = featureDisabledResponse("calls")
    return NextResponse.json(disabled.body, { status: disabled.status })
  }
  const { id: tripId } = await params
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "not found" }, { status: 404 })

  try {
    // conversationId reuses the trip's existing group conversation
    // (trip-conversation.ts) — not re-derived here to avoid a second
    // membership-sync path; pass tripId itself if no conversation lookup is
    // wired in yet, and revisit once trip-conversation.ts exposes a getter.
    const result = await mintCallToken(tripId, user.id, tripId)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}

/**
 * Ends a call session on hangup, so `ringing`/`active` rows actually
 * transition to `ended` — otherwise trip_call_sessions_one_active_per_trip
 * (the partial unique index added alongside this route) permanently blocks
 * every future call for the trip the moment one session is left dangling.
 * Membership-checked the same way POST is: a trip participant can end this
 * trip's call, not merely the person who started it (any member hanging up
 * or a different member finishing a call already left should be able to
 * clear it).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!tripFeatures.calls) {
    const disabled = featureDisabledResponse("calls")
    return NextResponse.json(disabled.body, { status: disabled.status })
  }
  const { id: tripId } = await params
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "not found" }, { status: 404 })

  const body = await req.json().catch(() => null) as { callSessionId?: string } | null
  if (!body?.callSessionId) {
    return NextResponse.json({ error: "callSessionId required" }, { status: 400 })
  }

  try {
    await endCallSession(body.callSessionId, tripId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}
