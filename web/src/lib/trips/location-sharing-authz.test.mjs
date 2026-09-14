/**
 * Route-level authorization coverage for live-location sharing.
 *
 * The actual route guards (location-sessions/route.ts and its [sessionId]
 * sibling) are thin wrappers: getAuthedUser() + getTripAccess() + a 401/404
 * shape, then delegate straight to location-sharing.ts. getAuthedUser() reads
 * cookies/session state via the real Supabase server client, which isn't
 * something `node --experimental-strip-types` can construct without a live
 * request — and there's no existing precedent anywhere in this codebase for
 * importing a Next.js route handler directly and driving it with a mock
 * NextRequest, so this file stays pragmatic rather than inventing that
 * harness from scratch:
 *
 *   1. getTripAccess() IS injectable (a `db?` parameter, same pattern as
 *      location-sharing.ts) — so the actual boundary every route's guard()
 *      relies on ("allowed" for owner/active participant, not allowed for a
 *      stranger or a departed participant) is exercised directly here,
 *      which is the part that determines whether a route returns 404.
 *   2. featureDisabledResponse()'s exact shape is asserted, since that's the
 *      literal body/status every gated route returns verbatim.
 *   3. pingLocation/stopLocationSession's user_id scoping is already covered
 *      in location-sharing.test.mjs; this file adds the complementary
 *      "wrong trip" case — activeLocationsFor(tripId) must never surface
 *      another trip's rows even if they share a member.
 *
 * What this does NOT cover: the route handlers' own 401 unauthenticated path
 * (getAuthedUser() returning null) and the actual HTTP-level wiring — those
 * need a real (or Next-test-harness) request and are left for a future
 * integration-test pass, not invented here.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { getTripAccess } from "./trip-access.ts"
import { featureDisabledResponse } from "./trip-features.ts"
import { pingLocation, activeLocationsFor } from "./location-sharing.ts"

function fakeTripDb(seed = {}) {
  const tables = {
    life_journeys: seed.life_journeys ?? [],
    trip_participants: seed.trip_participants ?? [],
  }
  function builder(table) {
    const filters = []
    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      is(col, val) { filters.push(r => r[col] === val); return api },
      select() { return api },
      maybeSingle() {
        const rows = tables[table].filter(r => filters.every(f => f(r)))
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
    }
    return api
  }
  return { from: builder }
}

test("getTripAccess denies a user with no relationship to the trip", async () => {
  const db = fakeTripDb({
    life_journeys: [{ id: "trip-1", user_id: "owner-1", organization_id: "org-1" }],
    trip_participants: [],
  })
  const access = await getTripAccess("trip-1", "stranger-1", db)
  assert.equal(access.allowed, false)
  assert.equal(access.role, "none")
})

test("getTripAccess denies a departed participant (left_at set)", async () => {
  const db = fakeTripDb({
    life_journeys: [{ id: "trip-1", user_id: "owner-1", organization_id: "org-1" }],
    trip_participants: [{ journey_id: "trip-1", user_id: "departed-1", left_at: "2026-01-01T00:00:00Z" }],
  })
  const access = await getTripAccess("trip-1", "departed-1", db)
  assert.equal(access.allowed, false, "a departed participant must not retain access")
  assert.equal(access.role, "none")
})

test("getTripAccess allows the trip owner", async () => {
  const db = fakeTripDb({
    life_journeys: [{ id: "trip-1", user_id: "owner-1", organization_id: "org-1" }],
  })
  const access = await getTripAccess("trip-1", "owner-1", db)
  assert.equal(access.allowed, true)
  assert.equal(access.role, "owner")
})

test("getTripAccess allows an active participant", async () => {
  const db = fakeTripDb({
    life_journeys: [{ id: "trip-1", user_id: "owner-1", organization_id: "org-1" }],
    trip_participants: [{ journey_id: "trip-1", user_id: "member-1", left_at: null }],
  })
  const access = await getTripAccess("trip-1", "member-1", db)
  assert.equal(access.allowed, true)
  assert.equal(access.role, "participant")
})

test("getTripAccess denies access to a trip that does not exist", async () => {
  const db = fakeTripDb()
  const access = await getTripAccess("no-such-trip", "anyone", db)
  assert.equal(access.allowed, false)
  assert.equal(access.role, "none")
})

test("featureDisabledResponse returns the exact 404-shaped body every gated route sends verbatim", () => {
  const disabled = featureDisabledResponse("liveLocation")
  assert.deepEqual(disabled.body, { error: "Not found" })
  assert.equal(disabled.status, 404)

  const disabledCalls = featureDisabledResponse("calls")
  assert.deepEqual(disabledCalls.body, { error: "Not found" })
  assert.equal(disabledCalls.status, 404)
})

// ── location-sharing.ts: cross-trip isolation ──────────────────────────────
// The route guard scopes access to ONE trip id (via getTripAccess), but
// activeLocationsFor itself takes a bare journeyId with no further check —
// it must never blend another trip's rows into the result even when a
// session for a different trip happens to exist in the same table.
function fakeLocationDb(seed = {}) {
  const tables = {
    trip_location_sessions: seed.trip_location_sessions ?? [],
    trip_member_locations: seed.trip_member_locations ?? [],
  }
  function builder(table) {
    const filters = []
    let single = false
    function matching() { return tables[table].filter(r => filters.every(f => f(r))) }
    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      gt(col, val) { filters.push(r => r[col] > val); return api },
      is(col, val) { filters.push(r => r[col] === val); return api },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return api },
      select() { return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) {
        const rows = matching()
        return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return { from: builder, _tables: tables }
}

test("activeLocationsFor never returns another trip's live locations", async () => {
  const db = fakeLocationDb({
    trip_location_sessions: [
      { id: "sess-a", journey_id: "trip-A", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
      { id: "sess-b", journey_id: "trip-B", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
    ],
    trip_member_locations: [
      { session_id: "sess-a", journey_id: "trip-A", user_id: "user-1", latitude: 1, longitude: 1 },
      { session_id: "sess-b", journey_id: "trip-B", user_id: "user-1", latitude: 2, longitude: 2 },
    ],
  })
  const locationsForA = await activeLocationsFor("trip-A", db)
  assert.equal(locationsForA.length, 1)
  assert.equal(locationsForA[0].sessionId, "sess-a")
})

test("pingLocation rejects a session id/user pair that does not exist for this trip's session table", async () => {
  const db = fakeLocationDb({ trip_location_sessions: [] })
  await assert.rejects(() => pingLocation("no-such-session", "user-1", "trip-A", { lat: 1, lng: 1 }, db))
})
