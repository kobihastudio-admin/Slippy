import assert from "node:assert/strict"
import test from "node:test"

import {
  isUuid,
  parseMessagesQuery,
  resolvePostMsgType,
  pickDirectConversation,
  validateCreateConversation,
  findDirectConversationId,
  directPairKey,
  getOrCreateDirectConversation,
} from "./chat-access.ts"

const ME = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const THIRD = "33333333-3333-4333-8333-333333333333"
const q = (s) => new URLSearchParams(s)

// ── isUuid ────────────────────────────────────────────────────────────────
test("isUuid accepts a v4 uuid in either case and rejects everything else", () => {
  assert.equal(isUuid(ME), true)
  assert.equal(isUuid(ME.toUpperCase()), true)
  for (const bad of ["", "abc", "../etc/passwd", `${ME}x`, `{${ME}}`, "1;drop table", ME.slice(1), null, undefined, 42, {}]) {
    assert.equal(isUuid(bad), false, JSON.stringify(bad))
  }
})

// ── parseMessagesQuery ───────────────────────────────────────────────────
test("parseMessagesQuery defaults to 30 and no cursor", () => {
  assert.deepEqual(parseMessagesQuery(q("")), { ok: true, limit: 30, before: null })
})

test("parseMessagesQuery clamps the limit to 1..100 and rejects non-integers", () => {
  assert.equal(parseMessagesQuery(q("limit=40")).limit, 40)
  assert.equal(parseMessagesQuery(q("limit=100")).limit, 100)
  assert.equal(parseMessagesQuery(q("limit=1000")).limit, 100)
  for (const bad of ["limit=0", "limit=-5", "limit=abc", "limit=1.5", "limit=", "limit=NaN", "limit=1e3", "limit=%20"]) {
    assert.equal(parseMessagesQuery(q(bad)).ok, false, bad)
  }
})

test("parseMessagesQuery keeps a valid cursor EXACTLY (no rounding: Postgres has microseconds)", () => {
  const c = "2026-11-09T15:55:12.123456+00:00"
  assert.deepEqual(parseMessagesQuery(new URLSearchParams({ before: c })), { ok: true, limit: 30, before: c })
  assert.equal(parseMessagesQuery(new URLSearchParams({ before: "2026-11-09T15:55:12Z" })).before, "2026-11-09T15:55:12Z")
})

test("parseMessagesQuery repairs a '+' that a client left unencoded (it arrives as a space)", () => {
  // `?before=2026-11-09T15:55:12.5+00:00` is read by URLSearchParams as "...12.5 00:00".
  const r = parseMessagesQuery(q("before=2026-11-09T15:55:12.5+00:00"))
  assert.deepEqual(r, { ok: true, limit: 30, before: "2026-11-09T15:55:12.5+00:00" })
})

test("parseMessagesQuery rejects a malformed or hostile cursor and repeated parameters", () => {
  for (const bad of ["yesterday", "2026-13-45T00:00:00Z", "2026-11-09", "x);drop", "", "2026-11-09T15:55:12.5+00:00,id.gt.1"]) {
    assert.equal(parseMessagesQuery(new URLSearchParams({ before: bad })).ok, false, JSON.stringify(bad))
  }
  assert.equal(parseMessagesQuery(q("limit=5&limit=6")).ok, false)
  assert.equal(parseMessagesQuery(q("before=2026-11-09T15:55:12Z&before=2026-11-08T15:55:12Z")).ok, false)
})

// ── resolvePostMsgType ───────────────────────────────────────────────────
test("resolvePostMsgType defaults to text and only allows what the web client sends", () => {
  assert.equal(resolvePostMsgType(undefined), "text")
  for (const ok of ["text", "image", "video", "file"]) assert.equal(resolvePostMsgType(ok), ok)
})

test("resolvePostMsgType refuses system / payment_request / slip and anything unknown", () => {
  for (const bad of ["system", "payment_request", "slip", "", "TEXT", "text ", null, 1, {}, ["text"]]) {
    assert.equal(resolvePostMsgType(bad), null, JSON.stringify(bad))
  }
})

// ── pickDirectConversation ───────────────────────────────────────────────
const direct = (id, ...members) => ({ id, type: "direct", memberIds: members })
const group = (id, ...members) => ({ id, type: "group", memberIds: members })

test("pickDirectConversation finds the direct room of exactly these two people", () => {
  assert.equal(pickDirectConversation([direct("d1", ME, OTHER)], ME, OTHER), "d1")
  assert.equal(pickDirectConversation([direct("d1", OTHER, ME)], ME, OTHER), "d1")
})

test("pickDirectConversation never returns a shared GROUP (the bug: any shared room was opened as 'direct')", () => {
  assert.equal(pickDirectConversation([group("g1", ME, OTHER, THIRD)], ME, OTHER), null)
  assert.equal(pickDirectConversation([group("g1", ME, OTHER)], ME, OTHER), null)
})

test("pickDirectConversation ignores a direct-typed room with a third member or the wrong pair", () => {
  assert.equal(pickDirectConversation([direct("d1", ME, OTHER, THIRD)], ME, OTHER), null)
  assert.equal(pickDirectConversation([direct("d1", ME, THIRD)], ME, OTHER), null)
  assert.equal(pickDirectConversation([direct("d1", OTHER)], ME, OTHER), null)
})

test("pickDirectConversation skips unsuitable rooms and returns the first suitable one in the given order", () => {
  const rooms = [group("g1", ME, OTHER), direct("d2", ME, OTHER), direct("d3", ME, OTHER)]
  assert.equal(pickDirectConversation(rooms, ME, OTHER), "d2")
})

test("pickDirectConversation: nothing to pick, or 'chat with myself'", () => {
  assert.equal(pickDirectConversation([], ME, OTHER), null)
  assert.equal(pickDirectConversation([direct("d1", ME)], ME, ME), null)
})

// ── validateCreateConversation ───────────────────────────────────────────
test("validateCreateConversation: a direct room needs exactly one OTHER person", () => {
  assert.deepEqual(validateCreateConversation({ type: "direct", memberIds: [OTHER] }, ME),
    { ok: true, type: "direct", memberIds: [OTHER], name: null })
  assert.deepEqual(validateCreateConversation({ memberIds: [OTHER] }, ME),
    { ok: true, type: "direct", memberIds: [OTHER], name: null })
  assert.equal(validateCreateConversation({ type: "direct", memberIds: [OTHER, THIRD] }, ME).ok, false)
  assert.equal(validateCreateConversation({ type: "direct", memberIds: [ME] }, ME).ok, false)
  assert.equal(validateCreateConversation({ type: "direct", memberIds: [] }, ME).ok, false)
})

test("validateCreateConversation: group members are deduplicated and exclude the caller", () => {
  assert.deepEqual(
    validateCreateConversation({ type: "group", memberIds: [OTHER, THIRD, OTHER, ME], name: "  ก๊วน  " }, ME),
    { ok: true, type: "group", memberIds: [OTHER, THIRD], name: "ก๊วน" })
  assert.equal(validateCreateConversation({ type: "group", memberIds: [ME] }, ME).ok, false)
})

test("validateCreateConversation rejects bad types, non-uuid members, non-arrays and absurd names", () => {
  assert.equal(validateCreateConversation({ type: "channel", memberIds: [OTHER] }, ME).ok, false)
  assert.equal(validateCreateConversation({ type: "direct", memberIds: ["not-a-uuid"] }, ME).ok, false)
  assert.equal(validateCreateConversation({ type: "direct", memberIds: OTHER }, ME).ok, false)
  assert.equal(validateCreateConversation({ type: "group", memberIds: [OTHER], name: "x".repeat(101) }, ME).ok, false)
  assert.equal(validateCreateConversation(null, ME).ok, false)
  assert.equal(validateCreateConversation("hello", ME).ok, false)
})

// ── findDirectConversationId (the lookup send-qr and other server code use) ──
/**
 * A stand-in for the Supabase client. Every call chain is recorded and the awaited result comes from `answer`,
 * keyed by which of the three lookups it is (my rooms / their rooms among mine / the candidate rooms).
 */
function fakeLookup(answer) {
  const log = []
  const db = {
    from(table) {
      const q = { table, select: null, eqs: [], ins: [], order: null }
      log.push(q)
      const b = {
        select(c) { q.select = c; return b },
        eq(c, v) { q.eqs.push([c, v]); return b },
        in(c, v) { q.ins.push([c, v]); return b },
        order(c, o) { q.order = [c, o]; return b },
        then(resolve, reject) {
          const step = q.table === "conversations" ? "rooms" : (q.ins.length ? "theirs" : "mine")
          return Promise.resolve(answer(step, q)).then(resolve, reject)
        },
      }
      return b
    },
  }
  return { db, log }
}
const rows = (...ids) => ids.map((id) => ({ conversation_id: id }))
const room = (id, type, ...members) => ({ id, type, conversation_members: members.map((user_id) => ({ user_id })) })

test("findDirectConversationId returns the direct room of exactly the two people, skipping a shared group", async () => {
  const { db, log } = fakeLookup((step) => ({
    mine: { data: rows("g1", "d1"), error: null },
    theirs: { data: rows("g1", "d1"), error: null },
    rooms: { data: [room("d1", "direct", ME, OTHER)], error: null },
  }[step]))
  assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: true, id: "d1" })
  // the candidates were asked for as: direct rooms only, among the rooms both are in, oldest first
  const rooms = log.find((q) => q.table === "conversations")
  assert.ok(rooms.eqs.some(([c, v]) => c === "type" && v === "direct"))
  assert.deepEqual(rooms.ins, [["id", ["g1", "d1"]]])
  assert.deepEqual(rooms.order, ["created_at", { ascending: true }])
  assert.match(rooms.select, /conversation_members\(user_id\)/)
})

test("findDirectConversationId ignores a direct-typed room that has a third member", async () => {
  const { db } = fakeLookup((step) => ({
    mine: { data: rows("d1"), error: null },
    theirs: { data: rows("d1"), error: null },
    rooms: { data: [room("d1", "direct", ME, OTHER, THIRD)], error: null },
  }[step]))
  assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: true, id: null })
})

test("findDirectConversationId: only a group in common means there is no direct room yet", async () => {
  const { db } = fakeLookup((step) => ({
    mine: { data: rows("g1"), error: null },
    theirs: { data: rows("g1"), error: null },
    rooms: { data: [], error: null },   // the type=direct filter leaves nothing
  }[step]))
  assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: true, id: null })
})

test("findDirectConversationId stops early, without asking for rooms, when nothing is shared", async () => {
  for (const sharedNothing of [{ mine: [], theirs: [] }, { mine: ["a"], theirs: [] }]) {
    const { db, log } = fakeLookup((step) => ({
      mine: { data: rows(...sharedNothing.mine), error: null },
      theirs: { data: rows(...sharedNothing.theirs), error: null },
      rooms: { data: [], error: null },
    }[step]))
    assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: true, id: null })
    assert.equal(log.some((q) => q.table === "conversations"), false)
  }
})

test("findDirectConversationId FAILS CLOSED: an error at any step is { ok: false }, never 'no room' (that would create a duplicate)", async () => {
  for (const failing of ["mine", "theirs", "rooms"]) {
    const { db } = fakeLookup((step) => step === failing
      ? { data: null, error: { message: "boom" } }
      : ({
          mine: { data: rows("d1"), error: null },
          theirs: { data: rows("d1"), error: null },
          rooms: { data: [room("d1", "direct", ME, OTHER)], error: null },
        }[step]))
    assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: false }, failing)
  }
  const { db } = fakeLookup(() => { throw new Error("network") })
  assert.deepEqual(await findDirectConversationId(db, ME, OTHER), { ok: false })
})

test("findDirectConversationId refuses a malformed id or 'a chat with myself' without asking the database", async () => {
  const { db, log } = fakeLookup(() => ({ data: [], error: null }))
  assert.deepEqual(await findDirectConversationId(db, ME, "nope"), { ok: false })
  assert.deepEqual(await findDirectConversationId(db, ME, ME), { ok: true, id: null })
  assert.equal(log.length, 0)
})

// ── directPairKey ─────────────────────────────────────────────────────────
test("directPairKey is the same for either order and for upper/lower case, smaller id first", () => {
  assert.equal(directPairKey(ME, OTHER), `${ME}:${OTHER}`)
  assert.equal(directPairKey(OTHER, ME), `${ME}:${OTHER}`)
  assert.equal(directPairKey(OTHER.toUpperCase(), ME.toUpperCase()), `${ME}:${OTHER}`)
})

test("directPairKey is null for a malformed id or a chat with myself", () => {
  assert.equal(directPairKey(ME, ME), null)
  assert.equal(directPairKey(ME, ME.toUpperCase()), null)
  for (const bad of ["", "nope", null, undefined, 42]) assert.equal(directPairKey(ME, bad), null)
})

// ── getOrCreateDirectConversation ─────────────────────────────────────────
/**
 * Fake client for the whole get-or-create flow. `answer(step)` supplies the result of each step:
 * mine / theirs / rooms (the lookup), insertConv, insertMembers, byKey (the room that won a race), deleteConv.
 * Every operation is recorded in `log`.
 */
function fakeCreate(answer) {
  const log = []
  const db = {
    from(table) {
      const q = { table, op: "select", row: null, eqs: [], ins: [] }
      log.push(q)
      const done = () => {
        let step
        if (table === "conversations") {
          step = q.op === "insert" ? "insertConv" : q.op === "delete" ? "deleteConv"
            : q.eqs.some(([c]) => c === "direct_pair_key") ? "byKey" : "rooms"
        } else {
          step = q.op === "insert" ? "insertMembers" : (q.ins.length ? "theirs" : "mine")
        }
        q.step = step
        return Promise.resolve(answer(step, q))
      }
      const b = {
        select() { return b },
        insert(row) { q.op = "insert"; q.row = row; return b },
        delete() { q.op = "delete"; return b },
        eq(c, v) { q.eqs.push([c, v]); return b },
        in(c, v) { q.ins.push([c, v]); return b },
        order() { return b },
        single() { return b },
        maybeSingle() { return b },
        then(resolve, reject) { return done().then(resolve, reject) },
      }
      return b
    },
  }
  return { db, log }
}
const noRoomYet = { mine: { data: [], error: null } }
const ok = (data) => ({ data, error: null })

test("getOrCreateDirectConversation reuses the existing direct room and creates nothing", async () => {
  const { db, log } = fakeCreate((step) => ({
    mine: ok(rows("d1")), theirs: ok(rows("d1")), rooms: ok([room("d1", "direct", ME, OTHER)]),
  }[step]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: true, id: "d1", created: false })
  assert.equal(log.some((q) => q.op === "insert"), false)
})

test("getOrCreateDirectConversation creates the room WITH the pair key, then both members (caller admin)", async () => {
  const { db, log } = fakeCreate((step) => ({
    mine: ok([]), insertConv: ok({ id: "new1" }), insertMembers: ok(null),
  }[step]))
  assert.deepEqual(await getOrCreateDirectConversation(db, OTHER, ME), { ok: true, id: "new1", created: true })
  const conv = log.find((q) => q.step === "insertConv")
  assert.deepEqual(conv.row, { type: "direct", created_by: OTHER, direct_pair_key: `${ME}:${OTHER}` })
  const members = log.find((q) => q.step === "insertMembers")
  assert.deepEqual(members.row, [
    { conversation_id: "new1", user_id: OTHER, role: "admin" },
    { conversation_id: "new1", user_id: ME, role: "member" },
  ])
})

test("getOrCreateDirectConversation passes an optional name through", async () => {
  const { db, log } = fakeCreate((step) => ({ mine: ok([]), insertConv: ok({ id: "n" }), insertMembers: ok(null) }[step]))
  await getOrCreateDirectConversation(db, ME, OTHER, { name: "hello" })
  assert.equal(log.find((q) => q.step === "insertConv").row.name, "hello")
})

test("a lost race (unique violation on the pair key) uses the room that won and creates no members", async () => {
  const { db, log } = fakeCreate((step) => ({
    mine: ok([]),
    insertConv: { data: null, error: { code: "23505", message: "duplicate key" } },
    byKey: ok({ id: "winner" }),
  }[step]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: true, id: "winner", created: false })
  assert.equal(log.some((q) => q.step === "insertMembers"), false)
  const byKey = log.find((q) => q.step === "byKey")
  assert.deepEqual(byKey.eqs, [["direct_pair_key", `${ME}:${OTHER}`], ["type", "direct"]])
})

test("a lost race whose winner cannot be found fails instead of creating a second room", async () => {
  for (const byKey of [ok(null), { data: null, error: { message: "boom" } }]) {
    const { db, log } = fakeCreate((step) => ({
      mine: ok([]), insertConv: { data: null, error: { code: "23505" } }, byKey,
    }[step]))
    assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: false })
    assert.equal(log.filter((q) => q.step === "insertConv").length, 1)
  }
})

test("any other insert error fails (no room, no members)", async () => {
  const { db, log } = fakeCreate((step) => ({
    mine: ok([]), insertConv: { data: null, error: { code: "42501", message: "rls" } },
  }[step]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: false })
  assert.equal(log.some((q) => q.step === "insertMembers"), false)
})

test("if the members cannot be added the empty room is removed again and the call fails", async () => {
  const { db, log } = fakeCreate((step) => ({
    mine: ok([]), insertConv: ok({ id: "new1" }),
    insertMembers: { data: null, error: { message: "boom" } }, deleteConv: ok(null),
  }[step]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: false })
  const del = log.find((q) => q.step === "deleteConv")
  assert.deepEqual(del.eqs, [["id", "new1"]])
})

test("a failed lookup never creates a room (fails closed)", async () => {
  const { db, log } = fakeCreate((step) => step === "mine" ? { data: null, error: { message: "boom" } } : ok([]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: false })
  assert.equal(log.some((q) => q.op === "insert"), false)
})

test("getOrCreateDirectConversation refuses bad ids and a chat with myself without touching the database", async () => {
  const { db, log } = fakeCreate(() => ok([]))
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, "nope"), { ok: false })
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, ME), { ok: false })
  assert.equal(log.length, 0)
})

test("a thrown error anywhere is { ok: false }", async () => {
  const { db } = fakeCreate((step) => { if (step === "insertConv") throw new Error("network"); return ok([]) })
  assert.deepEqual(await getOrCreateDirectConversation(db, ME, OTHER), { ok: false })
})
