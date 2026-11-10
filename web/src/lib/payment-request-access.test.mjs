import assert from "node:assert/strict"
import test from "node:test"

import { validatePaymentRequestBody } from "./payment-request-input.ts"
import { checkConversationMembership } from "./conversation-membership.ts"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"
const U3 = "33333333-3333-4333-8333-333333333333"

// ── validatePaymentRequestBody ───────────────────────────────────────────
test("the smallest valid request is just an amount; everything else becomes null", () => {
  assert.deepEqual(validatePaymentRequestBody({ amount: 150 }), {
    ok: true,
    value: { amount: 150, payerId: null, description: null, promptpayId: null, conversationId: null, splitBillId: null },
  })
})

test("a full valid request keeps every field", () => {
  const r = validatePaymentRequestBody({
    amount: 99.5, payerId: U2, description: "  ค่าข้าว  ", promptpayId: "081-234-5678", conversationId: U1, splitBillId: U3,
  })
  assert.deepEqual(r, {
    ok: true,
    value: { amount: 99.5, payerId: U2, description: "ค่าข้าว", promptpayId: "081-234-5678", conversationId: U1, splitBillId: U3 },
  })
})

test("the amount must be a finite positive number below the numeric(14,2) limit", () => {
  for (const bad of [0, -1, -0.001, Number.NaN, Infinity, "100", null, undefined, true, {}, [], 1e12, 1e15]) {
    assert.equal(validatePaymentRequestBody({ amount: bad }).ok, false, String(bad))
  }
  assert.equal(validatePaymentRequestBody({ amount: 999_999_999_999.99 }).ok, true)
})

test("the amount is rounded to 2 decimals, so the QR and the stored value are the same number", () => {
  const r = validatePaymentRequestBody({ amount: 10.126 })
  assert.equal(r.ok && r.value.amount, 10.13)
  assert.equal(validatePaymentRequestBody({ amount: 0.001 }).ok, false)   // rounds to 0.00: not a positive amount
})

test("description: trimmed, blank becomes null, at most 200 characters, must be a string", () => {
  assert.equal(validatePaymentRequestBody({ amount: 1, description: "   " }).value.description, null)
  assert.equal(validatePaymentRequestBody({ amount: 1, description: "x".repeat(200) }).ok, true)
  assert.equal(validatePaymentRequestBody({ amount: 1, description: "x".repeat(201) }).ok, false)
  for (const bad of [5, {}, [], true]) assert.equal(validatePaymentRequestBody({ amount: 1, description: bad }).ok, false)
})

test("promptpayId: a mobile number (10 digits from 0), a 13-digit id or a 15-digit e-wallet id; formatting is allowed", () => {
  for (const ok of ["0812345678", "081-234-5678", "081 234 5678", "1234567890123", "123456789012345", "006681234567890"]) {
    assert.equal(validatePaymentRequestBody({ amount: 1, promptpayId: ok }).ok, true, ok)
  }
  for (const bad of ["123", "abc", "08123456789", "1234567890", "12345678901234", "0812345678x", "<script>", "0".repeat(40), 123, {}]) {
    assert.equal(validatePaymentRequestBody({ amount: 1, promptpayId: bad }).ok, false, JSON.stringify(bad))
  }
})

test("a blank promptpayId means 'not given' (the route then uses the organization's default), as before", () => {
  for (const blank of ["", "   ", null, undefined]) {
    const r = validatePaymentRequestBody({ amount: 1, promptpayId: blank })
    assert.equal(r.ok && r.value.promptpayId, null, JSON.stringify(blank))
  }
})

test("payerId / conversationId / splitBillId must be uuids when given (null is fine)", () => {
  for (const key of ["payerId", "conversationId", "splitBillId"]) {
    assert.equal(validatePaymentRequestBody({ amount: 1, [key]: null }).ok, true, `${key}=null`)
    assert.equal(validatePaymentRequestBody({ amount: 1, [key]: "not-a-uuid" }).ok, false, `${key}=bad`)
    assert.equal(validatePaymentRequestBody({ amount: 1, [key]: 42 }).ok, false, `${key}=number`)
    assert.equal(validatePaymentRequestBody({ amount: 1, [key]: "1;drop table users" }).ok, false, `${key}=sql`)
  }
})

test("the body itself must be an object", () => {
  for (const bad of [null, undefined, "x", 5, [], [{ amount: 1 }]]) assert.equal(validatePaymentRequestBody(bad).ok, false)
})

// ── checkConversationMembership ──────────────────────────────────────────
/** A stand-in for the Supabase client that records what was asked and answers with `result`. */
function fakeDb(result) {
  const calls = { tables: [], selects: [], eqs: [] }
  const builder = {
    select(cols) { calls.selects.push(cols); return builder },
    eq(col, val) { calls.eqs.push([col, val]); return builder },
    async maybeSingle() { if (result instanceof Error) throw result; return result },
  }
  return { db: { from(t) { calls.tables.push(t); return builder } }, calls }
}

test("a member is recognised, and the query is filtered by BOTH the room and the user", async () => {
  const { db, calls } = fakeDb({ data: { user_id: U1 }, error: null })
  assert.equal(await checkConversationMembership(db, U2, U1), "member")
  assert.deepEqual(calls.tables, ["conversation_members"])
  assert.deepEqual(calls.eqs.sort(), [["conversation_id", U2], ["user_id", U1]].sort())
})

test("no row means not a member", async () => {
  const { db } = fakeDb({ data: null, error: null })
  assert.equal(await checkConversationMembership(db, U2, U1), "not-member")
})

test("a database error is reported as an error, never as 'member'", async () => {
  assert.equal(await checkConversationMembership(fakeDb({ data: null, error: { message: "boom" } }).db, U2, U1), "error")
  assert.equal(await checkConversationMembership(fakeDb({ data: { user_id: U1 }, error: { message: "boom" } }).db, U2, U1), "error")
  assert.equal(await checkConversationMembership(fakeDb(new Error("network")).db, U2, U1), "error")
})

test("a malformed id is 'not-member' without asking the database", async () => {
  const { db, calls } = fakeDb({ data: { user_id: U1 }, error: null })
  assert.equal(await checkConversationMembership(db, "not-a-uuid", U1), "not-member")
  assert.equal(await checkConversationMembership(db, U2, ""), "not-member")
  assert.deepEqual(calls.tables, [])
})
