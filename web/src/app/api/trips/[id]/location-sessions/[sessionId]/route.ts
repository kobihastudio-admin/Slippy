// web/src/app/api/trips/[id]/location-sessions/[sessionId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { pingLocation, stopLocationSession, type LocationPoint } from "@/lib/trips/location-sharing"
import { tripFeatures, featureDisabledResponse } from "@/lib/trips/trip-features"

type Params = { params: Promise<{ id: string; sessionId: string }> }

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

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: tripId, sessionId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  const body = await req.json().catch(() => null) as { lat?: number; lng?: number; accuracyM?: number; heading?: number; speedMps?: number } | null
  if (!body || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 })
  }

  try {
    const point: LocationPoint = {
      lat: body.lat as number,
      lng: body.lng as number,
      accuracyM: body.accuracyM,
      heading: body.heading,
      speedMps: body.speedMps,
    }
    await pingLocation(sessionId, g.userId, tripId, point)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId, sessionId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  await stopLocationSession(sessionId, g.userId)
  return NextResponse.json({ ok: true })
}
