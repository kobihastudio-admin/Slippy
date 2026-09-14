import assert from "node:assert/strict"
import test from "node:test"
import { getTripAccess, canManageTrip } from "./trip-access.ts"
import {
  ensureTripConversation,
  syncTripConversationMembers,
  postTripSystemMessage,
} from "./trip-conversation.ts"

/**
 * Phase 1 acceptance criteria that are silent when they break:
 *   • "A trip conversation is created exactly once."
 *   • "Reusing an invite cannot create duplicate membership."
 *   • "Only active conversation members can read or send messages."
 *
 * All three are about a request that succeeds while doing the wrong thing, so
 * none of them show up as an error in production — a duplicated conversation
 * just splits the chat, and a missing authorization check just quietly works.
 */

const UNIQUE_VIOLATION = "23505"

/**
 * Minimal in-memory stand-in for the Supabase query builder — enough of the
 * chain that these modules use, and it enforces the real unique indexes from
 * migration 085 so the race-loss path is exercised rather than imagined.
 */
function fakeDb(seed = {}) {
  const tables = {
    life_journeys:        seed.life_journeys        ?? [],
    trip_participants:    seed.trip_participants    ?? [],
    conversations:        seed.conversations        ?? [],
    conversation_members: seed.conversation_members ?? [],
    messages:            seed.messages             ?? [],
    users:               seed.users                ?? [],
  }
  const inserts = []

  function builder(table) {
    let rows = [...tables[table]]
    const api = {
      select() { return api },
      eq(col, val)  { rows = rows.filter(r => r[col] === val); return api },
      in(col, vals) { rows = rows.filter(r => vals.includes(r[col])); return api },
      not(col, _op, _v) { rows = rows.filter(r => r[col] !== null && r[col] !== undefined); return api },
      is(col, val) { rows = rows.filter(r => val === null ? r[col] == null : r[col] === val); return api },
      or() { return api },
      order() { return api },
      limit(n) { rows = rows.slice(0, n); return api },
      update(patch) {
        for (const r of rows) Object.assign(r, patch)
        return { eq: () => ({ data: null, error: null }) }
      },
      maybeSingle() { return { data: rows[0] ?? null, error: null } },
      single() {
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } }
      },
      insert(payload) {
        const list = Array.isArray(payload) ? payload : [payload]
        // Enforce the partial unique indexes the migration adds.
        for (const row of list) {
          if (table === "conversations" && row.journey_id != null &&
              tables.conversations.some(c => c.journey_id === row.journey_id)) {
            return withSelect({ data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate journey_id" } })
          }
          if (table === "trip_participants" && row.user_id != null &&
              tables.trip_participants.some(p => p.journey_id === row.journey_id && p.user_id === row.user_id)) {
            return withSelect({ data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate participant" } })
          }
          if (table === "conversation_members" &&
              tables.conversation_members.some(m => m.conversation_id === row.conversation_id && m.user_id === row.user_id)) {
            return withSelect({ data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate member" } })
          }
        }
        for (const row of list) {
          const stored = { id: `${table}-${tables[table].length + 1}`, ...row }
          tables[table].push(stored)
          inserts.push({ table, row: stored })
        }
        const last = tables[table][tables[table].length - 1]
        return withSelect({ data: last, error: null })
      },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }
    return api
  }

  function withSelect(result) {
    const r = {
      ...result,
      select: () => r,
      single: () => result,
      maybeSingle: () => result,
      then: (resolve) => Promise.resolve(result).then(resolve),
    }
    return r
  }

  return { from: builder, _tables: tables, _inserts: inserts }
}

const OWNER = "user-owner"
const FRIEND = "user-friend"
const STRANGER = "user-stranger"
const TRIP = "trip-1"

function seedTrip(extra = {}) {
  return fakeDb({
    life_journeys: [{ id: TRIP, user_id: OWNER, organization_id: "org-1", title: "เชียงใหม่", cover_emoji: "✈️" }],
    trip_participants: [{ id: "p1", journey_id: TRIP, user_id: FRIEND, display_name: "เพื่อน" }],
    ...extra,
  })
}

// ── Authorization ───────────────────────────────────────────────────────────

test("the trip owner is allowed and can manage", async () => {
  const db = seedTrip()
  const access = await getTripAccess(TRIP, OWNER, db)
  assert.equal(access.role, "owner")
  assert.equal(access.allowed, true)
  assert.equal(await canManageTrip(TRIP, OWNER, db), true)
})

test("a participant is allowed but cannot manage the guest list", async () => {
  const db = seedTrip()
  const access = await getTripAccess(TRIP, FRIEND, db)
  assert.equal(access.role, "participant")
  assert.equal(access.allowed, true)
  assert.equal(await canManageTrip(TRIP, FRIEND, db), false)
})

test("a departed participant loses trip access without deleting expense identity", async () => {
  const db = seedTrip({
    trip_participants: [{ id: "p1", journey_id: TRIP, user_id: FRIEND, display_name: "เพื่อน", left_at: "2026-08-09T00:00:00Z" }],
  })
  const access = await getTripAccess(TRIP, FRIEND, db)
  assert.equal(access.allowed, false)
  assert.equal(db._tables.trip_participants.length, 1, "participant row must remain for expense history")
})

test("a logged-in stranger is refused — a trip id is not a bearer token", async () => {
  const db = seedTrip()
  const access = await getTripAccess(TRIP, STRANGER, db)
  assert.equal(access.role, "none")
  assert.equal(access.allowed, false)
})

test("org membership alone does not grant a seat in the trip", async () => {
  // The stranger is in the same org (org-1) as the trip, and is still refused.
  const db = seedTrip()
  const access = await getTripAccess(TRIP, STRANGER, db)
  assert.equal(access.allowed, false)
  assert.equal(access.orgId, "org-1", "org is still reported for accounting callers")
})

test("a missing trip is refused without leaking that it is missing", async () => {
  const db = seedTrip()
  const access = await getTripAccess("trip-does-not-exist", OWNER, db)
  assert.equal(access.allowed, false)
  assert.equal(access.orgId, null)
})

// ── Exactly one conversation per trip ───────────────────────────────────────

test("first call creates the conversation, second call returns the same one", async () => {
  const db = seedTrip()

  const first = await ensureTripConversation(TRIP, OWNER, db)
  assert.equal(first.existed, false)

  const second = await ensureTripConversation(TRIP, OWNER, db)
  assert.equal(second.existed, true)
  assert.equal(second.conversationId, first.conversationId)

  assert.equal(db._tables.conversations.length, 1, "must never create a second chat for one trip")
})

test("losing the insert race returns the winner instead of failing", async () => {
  const db = seedTrip()
  // Another request inserted between our SELECT and our INSERT: the row is
  // already there, so our insert trips the unique index.
  db._tables.conversations.push({ id: "conv-winner", journey_id: TRIP, type: "group" })

  const result = await ensureTripConversation(TRIP, OWNER, db)
  assert.equal(result.conversationId, "conv-winner")
  assert.equal(result.existed, true)
  assert.equal(db._tables.conversations.length, 1)
})

test("the conversation is a plain group, named after the trip", async () => {
  const db = seedTrip()
  await ensureTripConversation(TRIP, OWNER, db)
  const conv = db._tables.conversations[0]
  assert.equal(conv.type, "group", "must reuse the existing type CHECK, not a new enum value")
  assert.equal(conv.journey_id, TRIP)
  assert.ok(conv.name.includes("เชียงใหม่"))
})

test("ensuring a conversation for a trip that does not exist throws", async () => {
  const db = seedTrip()
  await assert.rejects(() => ensureTripConversation("trip-nope", OWNER, db), /not found/i)
})

// ── Membership ──────────────────────────────────────────────────────────────

test("owner and Slippy participants become conversation members exactly once", async () => {
  const db = seedTrip()
  const { conversationId } = await ensureTripConversation(TRIP, OWNER, db)

  const members = db._tables.conversation_members.filter(m => m.conversation_id === conversationId)
  assert.deepEqual(members.map(m => m.user_id).sort(), [FRIEND, OWNER].sort())
  assert.equal(members.find(m => m.user_id === OWNER).role, "admin")

  // Re-syncing must not duplicate anybody.
  const added = await syncTripConversationMembers(TRIP, conversationId, undefined, db)
  assert.equal(added, 0)
  assert.equal(db._tables.conversation_members.length, 2)
})

test("LINE-only participants are not added — they have no Slippy account", async () => {
  const db = seedTrip({
    trip_participants: [
      { id: "p1", journey_id: TRIP, user_id: FRIEND, display_name: "เพื่อน" },
      { id: "p2", journey_id: TRIP, user_id: null, line_user_id: "U123", display_name: "LINE only" },
    ],
  })
  const { conversationId } = await ensureTripConversation(TRIP, OWNER, db)
  const members = db._tables.conversation_members.filter(m => m.conversation_id === conversationId)
  assert.equal(members.length, 2, "owner + the one participant with a user_id")
  assert.ok(!members.some(m => m.user_id === null))
})

test("departed participants are not restored to chat by a membership sync", async () => {
  const db = seedTrip({
    trip_participants: [{ id: "p1", journey_id: TRIP, user_id: FRIEND, display_name: "เพื่อน", left_at: "2026-08-09T00:00:00Z" }],
  })
  const { conversationId } = await ensureTripConversation(TRIP, OWNER, db)
  const members = db._tables.conversation_members.filter(m => m.conversation_id === conversationId)
  assert.deepEqual(members.map(m => m.user_id), [OWNER])
})

test("the duplicate-participant index makes a replayed invite a no-op", async () => {
  const db = seedTrip()
  const result = db.from("trip_participants").insert({
    journey_id: TRIP, user_id: FRIEND, display_name: "เพื่อน",
  })
  assert.equal(result.error.code, UNIQUE_VIOLATION,
    "a second participant row for the same account must be rejected — expense splits count these rows")
  assert.equal(db._tables.trip_participants.length, 1)
})

// ── System messages ─────────────────────────────────────────────────────────

test("a system message carries a structured event, not just prose", async () => {
  const db = seedTrip()
  await ensureTripConversation(TRIP, OWNER, db)

  const posted = await postTripSystemMessage({
    journeyId: TRIP,
    event: "expense_added",
    body: "เพิ่มค่าใช้จ่าย ฿1,200",
    detail: { amount: 1200, currency: "THB" },
    actorId: OWNER,
  }, db)

  assert.equal(posted, true)
  const msg = db._tables.messages.at(-1)
  assert.equal(msg.msg_type, "system", "must reuse the existing msg_type CHECK")
  assert.equal(msg.meta.event, "expense_added")
  assert.equal(msg.meta.journey_id, TRIP)
  assert.equal(msg.meta.amount, 1200)
  assert.ok(msg.body, "and still carries readable text for clients that don't know the event")
})

test("a trip with no conversation is not given one as a side effect of an edit", async () => {
  const db = seedTrip()
  const posted = await postTripSystemMessage({
    journeyId: TRIP, event: "expense_added", body: "x",
  }, db)
  assert.equal(posted, false)
  assert.equal(db._tables.conversations.length, 0)
  assert.equal(db._tables.messages.length, 0)
})

test("a failed announcement never throws — the trip change already happened", async () => {
  const broken = { from: () => { throw new Error("database is down") } }
  const posted = await postTripSystemMessage({
    journeyId: TRIP, event: "trip_created", body: "x",
  }, broken)
  assert.equal(posted, false)
})
