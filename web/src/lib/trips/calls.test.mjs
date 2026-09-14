import assert from "node:assert/strict"
import test from "node:test"

process.env.NEXT_PUBLIC_LIVEKIT_URL = "wss://test.livekit.cloud"
process.env.LIVEKIT_API_KEY = "test-key"
process.env.LIVEKIT_API_SECRET = "test-secret-at-least-32-characters-long"

const { mintCallToken, endCallSession } = await import("./calls.ts")

function decodeJwtPayload(jwt) {
  const [, payload] = jwt.split(".")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
}

function fakeDb(seed = {}) {
  const tables = { trip_call_sessions: seed.trip_call_sessions ?? [] }
  function builder(table) {
    const filters = []
    let pendingUpdate = null
    let pendingInsert = null
    let single = false
    function matching() { return tables[table].filter(r => filters.every(f => f(r))) }
    function exec() {
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
      select() { return api },
      insert(row) { pendingInsert = row; return api },
      update(patch) { pendingUpdate = patch; return api },
      single() { single = true; return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) { return exec().then(resolve, reject) },
    }
    return api
  }
  return { from: builder, _tables: tables }
}

test("mintCallToken creates a new ringing call session when none exists", async () => {
  const db = fakeDb()
  const result = await mintCallToken("trip-1", "user-1", "conv-1", db)

  assert.equal(db._tables.trip_call_sessions.length, 1)
  const session = db._tables.trip_call_sessions[0]
  assert.equal(session.status, "ringing")
  assert.equal(session.journey_id, "trip-1")
  assert.equal(result.callSessionId, session.id)
})

test("mintCallToken reuses an already-ringing call instead of starting a second room", async () => {
  const db = fakeDb({ trip_call_sessions: [
    { id: "call-1", journey_id: "trip-1", room_name: "trip-trip-1", status: "ringing" },
  ] })
  const result = await mintCallToken("trip-1", "user-2", "conv-1", db)

  assert.equal(db._tables.trip_call_sessions.length, 1, "must not create a second room")
  assert.equal(result.callSessionId, "call-1")
  assert.equal(result.roomName, "trip-trip-1")
})

test("mintCallToken's JWT grants room-join for exactly the returned room", async () => {
  const db = fakeDb()
  const result = await mintCallToken("trip-2", "user-1", "conv-2", db)

  const payload = decodeJwtPayload(result.token)
  assert.equal(payload.sub, "user-1")
  assert.equal(payload.video.room, result.roomName)
  assert.equal(payload.video.roomJoin, true)
})

test("endCallSession marks the call ended with a timestamp", async () => {
  const db = fakeDb({ trip_call_sessions: [{ id: "call-1", journey_id: "trip-1", status: "ringing" }] })
  await endCallSession("call-1", "trip-1", db)

  const session = db._tables.trip_call_sessions[0]
  assert.equal(session.status, "ended")
  assert.ok(session.ended_at)
})

test("endCallSession is scoped to the given journeyId — cannot end another trip's call", async () => {
  const db = fakeDb({ trip_call_sessions: [{ id: "call-1", journey_id: "trip-1", status: "ringing" }] })
  await endCallSession("call-1", "someone-elses-trip", db)

  const session = db._tables.trip_call_sessions[0]
  assert.equal(session.status, "ringing", "a mismatched journeyId must not end someone else's call")
})
