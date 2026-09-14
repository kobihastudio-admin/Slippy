/**
 * Merchant "same store" key verification — run with:  npm run verify:vendor
 * Proves that OCR / branch / legal-word variants of one store collapse to a
 * single key, while genuinely different stores stay apart.
 */
import assert from "node:assert/strict"
import { canonicalMerchantKey } from "../pipeline/merchant-key"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}
const key = (name?: string | null, taxId?: string | null) => canonicalMerchantKey({ name, taxId })

console.log("\n▶ Tax id — format-independent gold standard\n")

check("dashed vs plain 13-digit tax id → same key", () => {
  assert.equal(key("ฟูจิ", "0-1055-61207-57-1"), "0105561207571")
  assert.equal(key("ฟูจิ", "0-1055-61207-57-1"), key("อะไรก็ได้", "0105561207571"))
})
check("tax id wins over a different printed name", () => {
  assert.equal(key("ยอดชา คาเฟ่ โลตัส", "0105561207571"),
               key("บริษัท ยอดชา จำกัด",  "0105561207571"))
})
check("partial (<13 digit) tax id falls back to the name", () => {
  assert.equal(key("ร้านกาแฟดี", "01055"), key("ร้านกาแฟดี", null))
})

console.log("\n▶ Name normalization — branch / legal words / punctuation\n")

check("branch suffix (สาขา …) is dropped", () => {
  assert.equal(key("ยอดชา คาเฟ่ สาขาโลตัสรามอินทรา"), key("ยอดชา คาเฟ่"))
})
check("English 'branch …' is dropped", () => {
  assert.equal(key("Cafe Amazon Branch Rama 9"), key("Cafe Amazon"))
})
check("legal words (บริษัท / จำกัด / Co., Ltd.) are dropped", () => {
  assert.equal(key("บริษัท ฟูจิ กูร์เม ครีเอชั่น จำกัด"), key("ฟูจิ กูร์เม ครีเอชั่น"))
  assert.equal(key("ABC Trading Co., Ltd."), key("ABC Trading"))
})
check("parenthesised branch code is dropped", () => {
  assert.equal(key("โรงพยาบาลพระรามเก้า (DD103)"), key("โรงพยาบาลพระรามเก้า"))
})
check("spacing / punctuation / case don't matter", () => {
  assert.equal(key("Cafe  Amazon."), key("cafe amazon"))
})

console.log("\n▶ Different stores must NOT collapse\n")

check("distinct names → distinct keys", () => {
  assert.notEqual(key("ยอดชา คาเฟ่"), key("สตาร์บัคส์"))
  assert.notEqual(key("Cafe Amazon"), key("Cafe Amazing"))
})
check("empty / junk → empty key (caller skips upsert)", () => {
  assert.equal(key("   "), "")
  assert.equal(key(null, "  -  "), "")
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
