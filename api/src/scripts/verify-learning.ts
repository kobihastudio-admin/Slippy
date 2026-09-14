/**
 * Learning-loop verification — run with:  npm run verify:learning
 *
 * The loop that turns user corrections into prompt guidance is the one part of
 * the pipeline that can teach itself the wrong thing and then keep teaching it.
 * Everything it decides is silent: a bad pattern produces no error, just a
 * slightly worse reading on every future document.
 *
 * Production had six patterns, every one of them derived from a SINGLE
 * document, promoted to "seen 2+ times" because one receipt's edits were saved
 * twice fourteen seconds apart. These tests pin the rules that stop that.
 */
import assert from "node:assert/strict"
import { minePatterns, formatErrorPatternBlock } from "../pipeline/pattern-miner"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

const correction = (over: Partial<Parameters<typeof minePatterns>[0][number]> = {}) => ({
  id: "c1", document_id: "doc-1", field_name: "vendor_name",
  ai_value: "ไฟแรงได้รุ่ง หัวหมาก20", corrected_value: "ไฟแรงโต้รุ่ง หัวหมาก20",
  vendor_name: "ไฟแรงโต้รุ่ง หัวหมาก20", doc_category: "tax_invoice_simplified",
  ...over,
})

console.log("\n▶ Significance — one document is not a pattern\n")

check("saving one document's edits twice does NOT create a pattern", () => {
  // Exactly what happened in production: identical rows at 10:35:25 and
  // 10:35:39. The old counter incremented per row, so this scored 2 and was
  // promoted to a standing rule injected into every future prompt.
  const mined = minePatterns([correction(), correction({ id: "c2" })])
  assert.deepEqual(mined, [], "one document can never be significant")
})

check("the same mistake on TWO documents IS a pattern", () => {
  const mined = minePatterns([correction(), correction({ id: "c2", document_id: "doc-2" })])
  assert.equal(mined.length, 1)
  assert.equal(mined[0].correct_value, "ไฟแรงโต้รุ่ง หัวหมาก20")
})

check("occurrence_count means distinct documents, as its name claims", () => {
  // It used to mean "rows", which is why a count of 4 could sit next to an
  // example_doc_ids list of length 1 and nothing looked wrong.
  const mined = minePatterns([
    correction({ id: "a", document_id: "d1" }),
    correction({ id: "b", document_id: "d1" }),   // duplicate save
    correction({ id: "c", document_id: "d2" }),
    correction({ id: "d", document_id: "d3" }),
  ])
  assert.equal(mined[0].occurrence_count, 3)
  assert.equal(mined[0].example_doc_ids.length, 3)
  assert.equal(mined[0].occurrence_count, mined[0].example_doc_ids.length,
    "the count and the evidence list must never disagree")
})

check("a correction that changes nothing is ignored", () => {
  assert.deepEqual(minePatterns([
    correction({ ai_value: "same", corrected_value: "same", document_id: "d1" }),
    correction({ ai_value: "same", corrected_value: "same", document_id: "d2" }),
  ]), [])
})

check("empty and malformed input never throws", () => {
  assert.deepEqual(minePatterns([]), [])
  assert.deepEqual(minePatterns([correction({ ai_value: null as never })]), [])
})

console.log("\n▶ What reaches the prompt\n")

check("corrected AMOUNTS are never fed back as patterns", () => {
  // The single most dangerous thing this loop could learn. Production mined
  // "subtotal 579.44 → 620" and "total 620 → 663.4" from one reviewer
  // reconciling one VAT-inclusive receipt. As a rule that is not a misreading
  // at all, and telling the model "620 is really 663.40" would make it rewrite
  // an unrelated ฿620 receipt — a corruption loop, in the one place it is least
  // acceptable.
  const block = formatErrorPatternBlock([
    { field_name: "subtotal",     wrong_value: "579.44", correct_value: "620",
      pattern_type: "amount_format", occurrence_count: 4, example_doc_ids: ["d1", "d2"] },
    { field_name: "total_amount", wrong_value: "620", correct_value: "663.4",
      pattern_type: "amount_format", occurrence_count: 2, example_doc_ids: ["d1", "d2"] },
  ])
  assert.equal(block, "", "no amount pattern may reach the prompt")
})

check("text confusions DO reach the prompt — they generalise", () => {
  const block = formatErrorPatternBlock([
    { field_name: "vendor_name", wrong_value: "ไฟแรงได้รุ่ง", correct_value: "ไฟแรงโต้รุ่ง",
      pattern_type: "char_swap", occurrence_count: 2, example_doc_ids: ["d1", "d2"] },
  ])
  assert.ok(block.includes("ไฟแรงโต้รุ่ง"), "a glyph confusion is a property of the print, not of one bill")
})

check("a mixed batch passes the text through and drops the amounts", () => {
  const block = formatErrorPatternBlock([
    { field_name: "line_items.description", wrong_value: "กุ้งไข่หมี", correct_value: "กุ้งโดนัท",
      pattern_type: "char_swap", occurrence_count: 2, example_doc_ids: ["d1", "d2"] },
    { field_name: "vat_amount", wrong_value: "40.56", correct_value: "0",
      pattern_type: "amount_format", occurrence_count: 3, example_doc_ids: ["d1", "d2"] },
  ])
  assert.ok(block.includes("กุ้งโดนัท"))
  assert.ok(!block.includes("40.56"), "the amount must not leak in alongside")
})

check("no patterns produces no prompt block at all", () => {
  assert.equal(formatErrorPatternBlock([]), "")
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
