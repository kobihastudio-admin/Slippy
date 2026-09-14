import assert from "node:assert/strict"
import test from "node:test"
import { startLocationSession, stopLocationSession, pingLocation, activeLocationsFor } from "./location-sharing.ts"

function fakeDb(seed = {}) {
  const tables = {
    trip_location_sessions: seed.trip_location_sessions ?? [],
    trip_member_locations: seed.trip_member_locations ?? [],
  }
  function builder(table) {
    const filters = []
    let pendingUpdate = null
    let pendingInsert = null
    let pendingUpsertKey = null
    let single = false

    function matching() { return tables[table].filter(r => filters.every(f => f(r))) }
    function exec() {
      if (pendingUpsertKey) {
        const existing = tables[table].find(r => r[pendingUpsertKey] === pendingInsert[pendingUpsertKey])
        if (existing) Object.assign(existing, pendingInsert)
        else tables[table].push({ ...pendingInsert })
        return Promise.resolve({ data: null, error: null })
      }
      if (pendingInsert) {
        const row = { id: `${table}-${tables[table].length + 1}`, ...pendingInsert }
        tables[table].push(row)
        return Promise.resolve({ data: row, error: null })
      }
      const rows = matching()
      if (pendingUpdate) { for (const r of rows) Object.assign(r, pendingUpdate) }
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null })
    }
    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      gt(col, val) { filters.push(r => r[col] > val); return api },
      is(col, val) { filters.push(r => r[col] === val); return api },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return api },
      select() { return api },
      insert(row) { pendingInsert = row; return api },
      update(patch) { pendingUpdate = patch; return api },
      upsert(row, opts) { pendingInsert = row; pendingUpsertKey = opts.onConflict; return api },
      single() { single = true; return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) { return exec().then(resolve, reject) },
    }
    return api
  }
  return { from: builder, _tables: tables }
}

test("startLocationSession creates a session with an expiry in the future", async () => {
  const db = fakeDb()
  const before = Date.now()
  const session = await startLocationSession("trip-1", "user-1", "1h", db)

  assert.equal(db._tables.trip_location_sessions.length, 1)
  assert.equal(db._tables.trip_location_sessions[0].journey_id, "trip-1")
  assert.equal(db._tables.trip_location_sessions[0].user_id, "user-1")
  const expiresMs = new Date(session.expiresAt).getTime()
  assert.ok(expiresMs > before + 55 * 60_000 && expiresMs < before + 65 * 60_000, "1h duration should expire in ~60 minutes")
})

test("startLocationSession with 'eod' expires the same day, at or before 23:59:59 Bangkok time", async () => {
  const db = fakeDb()
  const session = await startLocationSession("trip-1", "user-1", "eod", db)
  const expires = new Date(session.expiresAt)
  const bkkHour = Number(expires.toLocaleString("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false }))
  assert.equal(bkkHour, 23, "eod must expire at 23:xx Bangkok time")
})

test("stopLocationSession sets stopped_at and is scoped to the caller's own user_id", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
  ] })
  await stopLocationSession("sess-1", "someone-else", db)
  assert.equal(db._tables.trip_location_sessions[0].stopped_at, null, "a mismatched user_id must not stop someone else's session")

  await stopLocationSession("sess-1", "user-1", db)
  assert.ok(db._tables.trip_location_sessions[0].stopped_at, "the session owner can stop it")
})

test("pingLocation upserts the latest position, never inserting a second row for the same session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
  ] })
  await pingLocation("sess-1", "user-1", "trip-1", { lat: 13.7, lng: 100.5 }, db)
  await pingLocation("sess-1", "user-1", "trip-1", { lat: 13.8, lng: 100.6 }, db)

  assert.equal(db._tables.trip_member_locations.length, 1, "must upsert, not accumulate history")
  assert.equal(db._tables.trip_member_locations[0].latitude, 13.8)
})

test("pingLocation rejects a ping against a stopped session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: new Date().toISOString() },
  ] })
  await assert.rejects(() => pingLocation("sess-1", "user-1", "trip-1", { lat: 1, lng: 1 }, db))
})

test("pingLocation rejects a ping against an expired session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() - 1000).toISOString(), stopped_at: null },
  ] })
  await assert.rejects(() => pingLocation("sess-1", "user-1", "trip-1", { lat: 1, lng: 1 }, db))
})

test("activeLocationsFor returns only positions from active (not stopped/expired) sessions", async () => {
  const db = fakeDb({
    trip_location_sessions: [
      { id: "active", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
      { id: "stopped", journey_id: "trip-1", user_id: "user-2", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: new Date().toISOString() },
      { id: "expired", journey_id: "trip-1", user_id: "user-3", expires_at: new Date(Date.now() - 1000).toISOString(), stopped_at: null },
    ],
    trip_member_locations: [
      { session_id: "active", journey_id: "trip-1", user_id: "user-1", latitude: 1, longitude: 1 },
      { session_id: "stopped", journey_id: "trip-1", user_id: "user-2", latitude: 2, longitude: 2 },
      { session_id: "expired", journey_id: "trip-1", user_id: "user-3", latitude: 3, longitude: 3 },
    ],
  })
  const locations = await activeLocationsFor("trip-1", db)
  assert.equal(locations.length, 1)
  assert.equal(locations[0].userId, "user-1")
})
