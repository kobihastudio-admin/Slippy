import assert from "node:assert/strict"
import test from "node:test"
import { readAmountShape, recalcTotals } from "./vat.ts"

/**
 * Every case below is a real production document. The money logic here is
 * silent when it is wrong — a bad total reconciles perfectly against the bad
 * subtotal that produced it — so the only thing that catches a regression is a
 * receipt somebody has read with their eyes.
 */

// ── doc a3d41d8c — Jones Salad Esplanade, 22 Aug 2026 ────────────────────────
// Paper: SUBTOTAL 856.00 · GRAND TOTAL 856.00 · Tax Summary VAT@7% taxable
// 800.00, tax 56.00. The item prices are printed gross, so they sum to 856.
// This is the bill the old code turned into ฿915.92.
const jones = {
  subtotal: 800, vat_amount: 56, total_amount: 856,
  discount_amount: 0, delivery_fee: 0, wht_amount: 0,
}
const jonesItems = 856

test("Jones Salad: line items are recognised as measuring the total", () => {
  const shape = readAmountShape(jones, jonesItems)
  assert.equal(shape.items, "total")
  assert.equal(shape.vat, "exclusive")   // 800 + 56 = 856
})

test("Jones Salad: editing an item does not inflate the total", () => {
  const shape = readAmountShape(jones, jonesItems)
  // Re-running with the unchanged sum must be a no-op. It was not: this
  // returned 856 / 59.92 / 915.92.
  assert.deepEqual(recalcTotals(jones, jonesItems, shape), {
    subtotal: 800, vat_amount: 56, total_amount: 856,
  })
})

test("Jones Salad: a real item change moves the total by exactly that much", () => {
  const shape = readAmountShape(jones, jonesItems)
  // The ฿15 ไข่หวาน line removed → paper total would be 841.
  const r = recalcTotals(jones, 841, shape)
  assert.equal(r.total_amount, 841)
  assert.equal(+(r.subtotal + r.vat_amount).toFixed(2), 841)
  assert.equal(r.vat_amount, 55.02)      // 841 / 1.07 × 7%
})

// ── The ordinary VAT-excluded layout — items sum to the SUBTOTAL ─────────────
const excluded = {
  subtotal: 1000, vat_amount: 70, total_amount: 1070,
  discount_amount: 0, delivery_fee: 0, wht_amount: 0,
}

test("VAT-excluded: items measure the subtotal and VAT is added on top", () => {
  const shape = readAmountShape(excluded, 1000)
  assert.equal(shape.items, "subtotal")
  assert.equal(shape.vat, "exclusive")
  assert.deepEqual(recalcTotals(excluded, 900, shape), {
    subtotal: 900, vat_amount: 63, total_amount: 963,
  })
})

// ── VAT-included, where subtotal and total are the same figure ───────────────
const included = {
  subtotal: 1070, vat_amount: 70, total_amount: 1070,
  discount_amount: 0, delivery_fee: 0, wht_amount: 0,
}

test("VAT-included: the total never grows by the VAT", () => {
  const shape = readAmountShape(included, 1070)
  assert.equal(shape.vat, "inclusive")
  const r = recalcTotals(included, 963, shape)
  assert.equal(r.total_amount, 963)
  assert.equal(r.vat_amount, 63)         // 963 × 7/107 — 963/107 = 9, ×7 = 63
})

// ── No VAT at all (doc 52acf4db, CMD pharmacy — "ไม่ใช่ใบกำกับภาษี") ─────────
test("no VAT: the total is the item sum, and no VAT is invented", () => {
  const cmd = {
    subtotal: 1200, vat_amount: 0, total_amount: 1200,
    discount_amount: 0, delivery_fee: 0, wht_amount: 0,
  }
  const shape = readAmountShape(cmd, 1200)
  assert.equal(shape.vat, "none")
  assert.deepEqual(recalcTotals(cmd, 1130, shape), {
    subtotal: 1130, vat_amount: 0, total_amount: 1130,
  })
})

// ── Fees and discounts stay out of the convention ────────────────────────────
test("delivery fee and discount are carried through untouched", () => {
  const delivery = {
    subtotal: 500, vat_amount: 35, total_amount: 575,
    discount_amount: 20, delivery_fee: 60, wht_amount: 0,
  }
  const shape = readAmountShape(delivery, 500)
  assert.equal(shape.items, "subtotal")
  assert.equal(shape.vat, "exclusive")
  // 400 + 28 VAT + 60 fee − 20 discount
  assert.deepEqual(recalcTotals(delivery, 400, shape), {
    subtotal: 400, vat_amount: 28, total_amount: 468,
  })
})

test("the shape is a fixed point — recalculating twice changes nothing", () => {
  for (const doc of [jones, excluded, included]) {
    const itemSum = doc === jones ? jonesItems : doc.subtotal
    const shape = readAmountShape(doc, itemSum)
    const once  = recalcTotals(doc, itemSum, shape)
    const twice = recalcTotals({ ...doc, ...once }, itemSum, shape)
    assert.deepEqual(twice, once)
  }
})
