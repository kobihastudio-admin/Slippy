/**
 * Temporary, opt-in, trip-scoped live location — see
 * docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
 *
 * Injectable `db?`, same shape as medications.ts's `db?: MedicationsDb`, so
 * the expiry/ownership logic can be tested without a live Supabase project.
 */

export interface LocationDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }> }
        is(col: string, val: null): {
          gt(col: string, val: string): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
        }
        gt(col: string, val: string): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      }
      in(col: string, vals: string[]): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    insert(row: Record<string, unknown>): { select(cols: string): { single(): PromiseLike<{ data: Record<string, unknown>; error: { message: string } | null }> } }
    update(patch: Record<string, unknown>): { eq(col: string, val: string): { eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }> } }
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>
  }
}

async function defaultDb(): Promise<LocationDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient() as unknown as LocationDb
}

export type ShareDuration = "15m" | "1h" | "4h" | "eod"
const MINUTES: Record<Exclude<ShareDuration, "eod">, number> = { "15m": 15, "1h": 60, "4h": 240 }

function expiresAt(duration: ShareDuration): string {
  if (duration === "eod") {
    const bkkDateStr = new Date().toLocaleString("en-CA", { timeZone: "Asia/Bangkok" }).slice(0, 10)
    return new Date(`${bkkDateStr}T23:59:59+07:00`).toISOString()
  }
  return new Date(Date.now() + MINUTES[duration] * 60_000).toISOString()
}

export interface StartedSession { id: string; expiresAt: string }

export async function startLocationSession(
  journeyId: string, userId: string, duration: ShareDuration, db?: LocationDb,
): Promise<StartedSession> {
  const admin = db ?? await defaultDb()
  const { data, error } = await admin.from("trip_location_sessions")
    .insert({ journey_id: journeyId, user_id: userId, expires_at: expiresAt(duration) })
    .select("id, expires_at")
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id as string, expiresAt: data.expires_at as string }
}

/** Scoped to the caller's own user_id — a trip owner cannot stop someone
 * else's session, matching the spec's non-negotiable rule. */
export async function stopLocationSession(sessionId: string, userId: string, db?: LocationDb): Promise<void> {
  const admin = db ?? await defaultDb()
  const { error } = await admin.from("trip_location_sessions")
    .update({ stopped_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
  if (error) throw new Error(error.message)
}

export interface LocationPoint { lat: number; lng: number; accuracyM?: number; heading?: number; speedMps?: number }

/** Upserts by session_id — the table's primary key — so only the latest
 * position is ever stored, per the spec's no-history rule. */
export async function pingLocation(
  sessionId: string, userId: string, journeyId: string, point: LocationPoint, db?: LocationDb,
): Promise<void> {
  const admin = db ?? await defaultDb()
  const { data: session, error: findErr } = await admin.from("trip_location_sessions")
    .select("id, expires_at, stopped_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle()
  if (findErr) throw new Error(findErr.message)
  if (!session || session.stopped_at || new Date(session.expires_at as string) <= new Date()) {
    throw new Error("session is not active")
  }

  const { error } = await admin.from("trip_member_locations").upsert({
    session_id: sessionId,
    journey_id: journeyId,
    user_id: userId,
    latitude: point.lat,
    longitude: point.lng,
    accuracy_m: point.accuracyM ?? null,
    heading: point.heading ?? null,
    speed_mps: point.speedMps ?? null,
    recorded_at: new Date().toISOString(),
  }, { onConflict: "session_id" })
  if (error) throw new Error(error.message)
}

export interface ActiveLocation { sessionId: string; userId: string; lat: number; lng: number; recordedAt: string }

/** Two queries, not one embedded-resource query — avoids relying on
 * PostgREST's embedded-filter syntax for a case simple filters cover fine. */
export async function activeLocationsFor(journeyId: string, db?: LocationDb): Promise<ActiveLocation[]> {
  const admin = db ?? await defaultDb()
  const nowIso = new Date().toISOString()
  const { data: sessions, error: sErr } = await admin.from("trip_location_sessions")
    .select("id")
    .eq("journey_id", journeyId)
    .is("stopped_at", null)
    .gt("expires_at", nowIso) as unknown as { data: { id: string; stopped_at: null }[] | null; error: { message: string } | null }
  if (sErr) throw new Error(sErr.message)
  const activeIds = (sessions ?? []).map(s => s.id)
  if (activeIds.length === 0) return []

  const { data: locations, error: lErr } = await admin.from("trip_member_locations")
    .select("session_id, user_id, latitude, longitude, recorded_at")
    .in("session_id", activeIds) as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null }
  if (lErr) throw new Error(lErr.message)
  return (locations ?? []).map(r => ({
    sessionId: r.session_id as string, userId: r.user_id as string,
    lat: r.latitude as number, lng: r.longitude as number, recordedAt: r.recorded_at as string,
  }))
}
