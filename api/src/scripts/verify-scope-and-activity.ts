/**
 * Scope gate + activity logging — run with:  npm run verify:scope
 *
 * Both guard against silent damage: a gate that is too strict throws away real
 * receipts users have already photographed, and an address that is logged in
 * full quietly turns a security log into a tracking log.
 */
import assert from "node:assert/strict"
import { checkDocumentScope, FINANCIAL_CATEGORIES } from "../pipeline/scope-gate"
import { truncateIp } from "../services/activity-log"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

console.log("\n▶ Scope gate — financial documents only\n")

check("every accepted category passes", () => {
  for (const c of FINANCIAL_CATEGORIES) {
    assert.equal(checkDocumentScope({ doc_category: c }).accepted, true, `${c} must be accepted`)
  }
})

check("a selfie is rejected — no category, no money, no items", () => {
  const v = checkDocumentScope({ doc_category: "other", total_amount: 0, line_items: [] })
  assert.equal(v.accepted, false)
  assert.match(v.reason ?? "", /ไม่ถูกหักโควตา/, "must tell the user their quota is safe")
  assert.match(v.reason ?? "", /ใบเสร็จ/, "must say what IS accepted, not only that this failed")
})

check("an unlabelled receipt with a total is KEPT", () => {
  // A classification miss must not destroy a real document — the user already
  // took the photo and believes the job is done.
  assert.equal(checkDocumentScope({ doc_category: "other", total_amount: 68 }).accepted, true)
})

check("an unlabelled receipt with line items is KEPT", () => {
  assert.equal(checkDocumentScope({
    doc_category: null, total_amount: 0, line_items: [{ description: "ไอติมกะทิ" }],
  }).accepted, true)
})

check("a subtotal alone is enough to keep it", () => {
  assert.equal(checkDocumentScope({ doc_category: "other", subtotal: 1046 }).accepted, true)
})

check("nothing at all is rejected rather than crashing", () => {
  assert.equal(checkDocumentScope(null).accepted, false)
  assert.equal(checkDocumentScope(undefined).accepted, false)
  assert.equal(checkDocumentScope({}).accepted, false)
})

console.log("\n▶ Activity log — correlate attacks, don't track people\n")

check("IPv4 keeps the network, drops the host", () => {
  assert.equal(truncateIp("27.130.34.57"), "27.130.34.0/24")
})

check("a proxy chain uses the client address, not the proxy", () => {
  assert.equal(truncateIp("27.130.34.57, 172.16.0.1"), "27.130.34.0/24")
})

check("IPv6 keeps only the routing prefix", () => {
  assert.equal(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348"), "2001:db8:85a3:8d3::/64")
})

check("missing or malformed input yields null, never a partial address", () => {
  assert.equal(truncateIp(null), null)
  assert.equal(truncateIp(""), null)
  assert.equal(truncateIp("not-an-ip"), null)
  assert.equal(truncateIp("999.1.1"), null)
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
