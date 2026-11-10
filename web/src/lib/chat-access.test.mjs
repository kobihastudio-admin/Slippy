import assert from "node:assert/strict"
import test from "node:test"

import {
  isUuid,
  parseMessagesQuery,
  resolvePostMsgType,
  pickDirectConversation,
  validateCreateConversation,
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
