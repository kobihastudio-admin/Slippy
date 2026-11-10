import assert from "node:assert/strict"
import test from "node:test"

import {
  parsePatchBody,
  canViewPaymentRequest,
  decidePatch,
  canAttachSlipDocument,
} from "./payment-request-policy.ts"

const REQ = "11111111-1111-4111-8111-111111111111"   // requester
const PAY = "22222222-2222-4222-8222-222222222222"   // designated payer
const MEM = "33333333-3333-4333-8333-333333333333"   // another member of the room the card is in
const STR = "44444444-4444-4444-8444-444444444444"   // stranger
const DOC = "55555555-5555-4555-8555-555555555555"
const ROOM = "66666666-6666-4666-8666-666666666666"

const pr = (over = {}) => ({ requester_id: REQ, payer_id: PAY, conversation_id: ROOM, status: "pending", ...over })

// ── parsePatchBody ───────────────────────────────────────────────────────
test("parsePatchBody accepts mark_paid (optionally with a slip document) and cancel", () => {
  assert.deepEqual(parsePatchBody({ action: "mark_paid" }), { ok: true, action: "mark_paid", slipDocId: null })
  assert.deepEqual(parsePatchBody({ action: "mark_paid", slipDocId: DOC }), { ok: true, action: "mark_paid", slipDocId: DOC })
  assert.deepEqual(parsePatchBody({ action: "cancel" }), { ok: true, action: "cancel", slipDocId: null })
})

test("parsePatchBody rejects unknown actions, bad bodies, bad document ids, and a document with cancel", () => {
  for (const bad of [null, undefined, "x", 5, [], {}, { action: "delete" }, { action: "" }, { action: 7 }, { action: "MARK_PAID" }]) {
    assert.equal(parsePatchBody(bad).ok, false, JSON.stringify(bad))
  }
  assert.equal(parsePatchBody({ action: "mark_paid", slipDocId: "nope" }).ok, false)
  assert.equal(parsePatchBody({ action: "mark_paid", slipDocId: 5 }).ok, false)
  assert.equal(parsePatchBody({ action: "cancel", slipDocId: DOC }).ok, false)
})

// ── canViewPaymentRequest ────────────────────────────────────────────────
test("the requester, the designated payer and a member of the room the card is in can view it", () => {
  assert.equal(canViewPaymentRequest(pr(), REQ, false), true)
  assert.equal(canViewPaymentRequest(pr(), PAY, false), true)
  assert.equal(canViewPaymentRequest(pr(), MEM, true), true)
})

test("a stranger cannot view it, and 'room member' counts only if the request was posted in a room", () => {
  assert.equal(canViewPaymentRequest(pr(), STR, false), false)
  assert.equal(canViewPaymentRequest(pr({ conversation_id: null }), MEM, true), false)
  assert.equal(canViewPaymentRequest(pr({ payer_id: null, conversation_id: null }), STR, false), false)
  assert.equal(canViewPaymentRequest(pr({ payer_id: null, conversation_id: null }), REQ, false), true)
})

// ── decidePatch ──────────────────────────────────────────────────────────
test("mark_paid: only the requester or the designated payer, and only while pending", () => {
  assert.equal(decidePatch("mark_paid", pr(), REQ), "apply")
  assert.equal(decidePatch("mark_paid", pr(), PAY), "apply")
  assert.equal(decidePatch("mark_paid", pr(), MEM), "forbidden")   // a room member is not enough
  assert.equal(decidePatch("mark_paid", pr(), STR), "forbidden")
})

test("mark_paid on an open request (no payer): only the requester", () => {
  assert.equal(decidePatch("mark_paid", pr({ payer_id: null }), REQ), "apply")
  assert.equal(decidePatch("mark_paid", pr({ payer_id: null }), MEM), "forbidden")
  assert.equal(decidePatch("mark_paid", pr({ payer_id: null }), STR), "forbidden")
})

test("mark_paid is idempotent when already paid, and refused for cancelled or expired requests", () => {
  assert.equal(decidePatch("mark_paid", pr({ status: "paid" }), PAY), "already")
  assert.equal(decidePatch("mark_paid", pr({ status: "cancelled" }), PAY), "conflict")
  assert.equal(decidePatch("mark_paid", pr({ status: "expired" }), PAY), "conflict")
})

test("cancel: only the requester, and only while pending", () => {
  assert.equal(decidePatch("cancel", pr(), REQ), "apply")
  assert.equal(decidePatch("cancel", pr(), PAY), "forbidden")     // the payer cannot cancel the requester's request
  assert.equal(decidePatch("cancel", pr(), STR), "forbidden")
  assert.equal(decidePatch("cancel", pr({ status: "cancelled" }), REQ), "already")
  assert.equal(decidePatch("cancel", pr({ status: "paid" }), REQ), "conflict")
  assert.equal(decidePatch("cancel", pr({ status: "expired" }), REQ), "conflict")
})

test("a forbidden caller is told 'forbidden' even if the status would also be a conflict (no state leak)", () => {
  assert.equal(decidePatch("mark_paid", pr({ status: "cancelled" }), STR), "forbidden")
  assert.equal(decidePatch("cancel", pr({ status: "paid" }), STR), "forbidden")
})

// ── canAttachSlipDocument ────────────────────────────────────────────────
test("a slip document may be attached if the caller uploaded it or belongs to its organization", () => {
  const ORG = "77777777-7777-4777-8777-777777777777"
  const OTHER_ORG = "88888888-8888-4888-8888-888888888888"
  assert.equal(canAttachSlipDocument({ uploaded_by: PAY, organization_id: OTHER_ORG }, PAY, []), true)
  assert.equal(canAttachSlipDocument({ uploaded_by: REQ, organization_id: ORG }, PAY, [ORG]), true)
  assert.equal(canAttachSlipDocument({ uploaded_by: null, organization_id: ORG }, PAY, [ORG]), true)
})

test("someone else's document in an organization the caller is not in is refused; so is a missing document", () => {
  const ORG = "77777777-7777-4777-8777-777777777777"
  const OTHER_ORG = "88888888-8888-4888-8888-888888888888"
  assert.equal(canAttachSlipDocument({ uploaded_by: REQ, organization_id: ORG }, PAY, [OTHER_ORG]), false)
  assert.equal(canAttachSlipDocument({ uploaded_by: REQ, organization_id: ORG }, PAY, []), false)
  assert.equal(canAttachSlipDocument({ uploaded_by: null, organization_id: ORG }, PAY, []), false)
  assert.equal(canAttachSlipDocument(null, PAY, [ORG]), false)
  assert.equal(canAttachSlipDocument(undefined, PAY, [ORG]), false)
})
