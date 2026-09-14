/**
 * Failure classification — run with:  npm run verify:failures
 *
 * The five KOFUKU uploads that all showed "ผิดพลาด" were killed by
 * `400 … "Your credit balance is too low to access the Anthropic API"`.
 * Nothing was wrong with the documents, but the app blamed them, the worker
 * retried the billing error three times, and the only fix offered to the user
 * was to photograph the receipts again.
 */
import assert from "node:assert/strict"
import { classifyFailure, shouldAutoReplay, PROVIDER_OUTAGE_NOTE } from "../pipeline/failure-kind"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

console.log("\n▶ Provider-side failures — never the document's fault\n")

check("the exact field failure: out of credit", () => {
  assert.equal(classifyFailure(
    `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API, please go to Plans & Billing to upgrade or purchase credits."}}`
  ), "provider")
})
check("bad API key", () => {
  assert.equal(classifyFailure(`401 {"type":"authentication_error","message":"invalid x-api-key"}`), "provider")
})
check("permission error", () => {
  assert.equal(classifyFailure("403 permission_error: not allowed"), "provider")
})
check("provider failures are replayed automatically", () => {
  assert.equal(shouldAutoReplay(classifyFailure("credit balance too low")), true)
})
check("the user-facing note blames the service, not the receipt", () => {
  assert.ok(PROVIDER_OUTAGE_NOTE.includes("ไม่ใช่ที่เอกสารของคุณ"))
  assert.ok(PROVIDER_OUTAGE_NOTE.includes("ไม่ต้องถ่ายใหม่"))
})

console.log("\n▶ Everything else keeps its old behaviour\n")

check("rate limit / overload stays transient", () => {
  assert.equal(classifyFailure("429 rate_limit_error"), "transient")
  assert.equal(classifyFailure("529 overloaded_error"), "transient")
})
check("timeouts stay transient", () => {
  assert.equal(classifyFailure("Extraction timed out after 120000ms"), "transient")
})
check("an unreadable image is still the document's problem", () => {
  assert.equal(classifyFailure("Unexpected token < in JSON at position 0"), "document")
  assert.equal(classifyFailure("could not process image media_type"), "document")
})
check("a document failure is NOT auto-replayed (only the user can fix it)", () => {
  assert.equal(shouldAutoReplay(classifyFailure("invalid base64 image")), false)
})
check("unknown stays unknown rather than guessing", () => {
  assert.equal(classifyFailure("something nobody predicted"), "unknown")
  assert.equal(shouldAutoReplay("unknown"), false)
})


console.log("\n▶ DocAI takes over when the provider is down\n")

import { estimateUsd } from "../pipeline/usage-meter"

check("a provider outage is the ONLY failure that hands off to DocAI", () => {
  // Re-reading with DocAI cannot fix a blurred photo or a non-financial
  // document, so paying for a second vendor there would be pure waste.
  assert.equal(classifyFailure("credit balance too low"), "provider")
  assert.notEqual(classifyFailure("invalid base64 image"), "provider")
  assert.notEqual(classifyFailure("429 rate_limit_error"), "provider")
})

check("cache accounting: a read is far cheaper than a write", () => {
  const write = estimateUsd("claude-haiku-4-5", { cache_creation_input_tokens: 10_000 })
  const read  = estimateUsd("claude-haiku-4-5", { cache_read_input_tokens: 10_000 })
  const fresh = estimateUsd("claude-haiku-4-5", { input_tokens: 10_000 })
  assert.ok(read < fresh, "a cache read must beat sending the tokens fresh")
  assert.ok(write > fresh, "a cache write costs MORE than fresh — it only pays off on later reads")
  assert.ok(read < write / 10, "and the read has to be dramatically cheaper for that trade to work")
})

check("an escalation to Sonnet is priced above Haiku", () => {
  const h = estimateUsd("claude-haiku-4-5",  { input_tokens: 10_000, output_tokens: 1_000 })
  const s = estimateUsd("claude-sonnet-4-5", { input_tokens: 10_000, output_tokens: 1_000 })
  assert.ok(s > h * 2, "so the logs make an escalation visibly expensive")
})

check("an unknown model is costed as the expensive one, never as free", () => {
  assert.ok(estimateUsd("some-future-model", { input_tokens: 10_000 }) > 0)
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
