// web/src/app/api/trips/[id]/location-sessions/route.ts
/**
 * Starting a live-location share, and listing everyone currently sharing on
 * this trip. See docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { startLocationSession, activeLocationsFor, type ShareDuration } from "@/lib/trips/location-sharing"
import { tripFeatures, featureDisabledResponse } from "@/lib/trips/trip-features"

type Params = { params: Promise<{ id: string }> }

async function guard(tripId: string, req: NextRequest) {
  if (!tripFeatures.liveLocation) {
    const disabled = featureDisabledResponse("liveLocation")
    return { error: NextResponse.json(disabled.body, { status: disabled.status }) }
  }
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  return { userId: user.id }
}

const VALID_DURATIONS: ShareDuration[] = ["15m", "1h", "4h", "eod"]

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  const body = await req.json().catch(() => null) as { duration?: string } | null
  const duration = body?.duration as ShareDuration | undefined
  if (!duration || !VALID_DURATIONS.includes(duration)) {
    return NextResponse.json({ error: "duration must be one of 15m, 1h, 4h, eod" }, { status: 400 })
  }

  try {
    const session = await startLocationSession(tripId, g.userId, duration)
    return NextResponse.json({ session })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  try {
    const locations = await activeLocationsFor(tripId)
    return NextResponse.json({ locations })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}
