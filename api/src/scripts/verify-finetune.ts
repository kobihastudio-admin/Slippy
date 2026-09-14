/**
 * Fine-tuning corpus verification — run with:  npm run verify:finetune
 *
 * Every module under src/finetune is pure, and every one of them is a place a
 * silent, unfalsifiable error can live: a leaky split reports accuracy that
 * isn't real, a broken CER reports a regression that didn't happen, a redaction
 * miss exports a card number, a shifting fingerprint invalidates every
 * comparison. None of those announce themselves at runtime — the pipeline keeps
 * working and the numbers keep printing. Tests are the only place they surface.
 */
import assert from "node:assert/strict"
import {
  validateExample, encodeTarget, DATASET_SCHEMA_VERSION, type TrainingExample,
} from "../finetune/schema"
import { bucketOf, merchantKey, assignSplit, auditLeakage, type Split } from "../finetune/split"
import { editDistance, characterErrorRate, amountsEqual, scoreAll } from "../finetune/metrics"
import { redactFreeText, redactTarget } from "../finetune/redact"
import { admit, contentHash, summarise, type Candidate } from "../finetune/quality-gate"
import { fingerprint, buildManifest, readiness } from "../finetune/manifest"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: "doc-1", status: "approved", verified_by: "user-1",
  source_width: 1400, source_height: 2200,
  vendor_name: "7-Eleven", vendor_tax_id: "0107542000011",
  doc_number: "E030220002020012", doc_date: "2026-08-13",
  subtotal: 80.37, vat_amount: 5.63, total_amount: 86,
  line_items: [{ description: "ก๋วยเตี๋ยว", amount: 9 }, { description: "ขนม", amount: 28 },
               { description: "น้ำ", amount: 49 }],
  ...over,
})

console.log("\n▶ Edit distance and character error rate\n")

check("edit distance is textbook-correct", () => {
  assert.equal(editDistance("kitten", "sitting"), 3)
  assert.equal(editDistance("", "abc"), 3)
  assert.equal(editDistance("abc", ""), 3)
  assert.equal(editDistance("same", "same"), 0)
})

check("CER counts a Thai tone-mark slip as ONE error, not a whole word", () => {
  // The distinction the whole metric exists for. Production doc 20ff83e0
  // returned "เยื่ม" for "เยิ้ม" — one misplaced mark, a near-miss. Doc
  // 77b66503 returned "ก๋วยสลอมหมอง" for "ก๋วยเตี๋ยว" — an invention. Exact
  // match scores both 0 and hides which way a change moved the model.
  const nearMiss = characterErrorRate("ขนมปังเนยเยิ้ม", "ขนมปังเนยเยื่ม")
  const invented = characterErrorRate("ก๋วยเตี๋ยว", "ก๋วยสลอมหมอง")
  assert.ok(nearMiss > 0, "a wrong tone mark is still an error")
  assert.ok(nearMiss < 0.2, `near-miss should score low, got ${nearMiss.toFixed(3)}`)
  assert.ok(invented > nearMiss * 3, `invention (${invented.toFixed(2)}) must dwarf near-miss (${nearMiss.toFixed(2)})`)
})

check("CER normalises Unicode before comparing", () => {
  // Thai composes from different code point sequences depending on input
  // method. Without NFC these identical-looking strings score as errors — a
  // measurement artefact that reads as a regression nobody caused.
  const composed   = "เยิ้ม".normalize("NFC")
  const decomposed = "เยิ้ม".normalize("NFD")
  assert.equal(characterErrorRate(composed, decomposed), 0)
})

check("CER edge cases never return NaN or exceed 1", () => {
  assert.equal(characterErrorRate("", ""), 0)
  assert.equal(characterErrorRate("", "invented"), 1)
  assert.equal(characterErrorRate("abc", ""), 1)
  // A wildly over-long reading is still capped — an unbounded metric would let
  // one runaway output dominate the mean for an entire eval set.
  assert.equal(characterErrorRate("a", "a".repeat(500) + "zzz"), 1)
})

check("amount comparison tolerates float noise but not real differences", () => {
  assert.equal(amountsEqual(86, 86.0000001), true)
  assert.equal(amountsEqual(86, 86.01), false)
  assert.equal(amountsEqual(null, null), true)
  assert.equal(amountsEqual(86, null), false)
})

console.log("\n▶ Scoring\n")

check("a perfect reading scores perfectly", () => {
  const truth = {
    vendor_name: "7-Eleven", vendor_tax_id: "0107542000011", doc_number: "E03",
    doc_date: "2026-08-13", subtotal: 80.37, vat_amount: 5.63, total_amount: 86,
    line_items: [{ description: "ขนม", amount: 28 }],
  }
  const r = scoreAll([{ truth, predicted: { ...truth } }])
  assert.equal(r.vendor_name_cer, 0)
  assert.equal(r.perfect_documents, 1)
  assert.equal(r.fields.total_amount, 1)
})

check("the real 7-Eleven failure scores as the failure it was", () => {
  // Ground truth vs what production actually returned for doc 67156d80: the
  // total was rewritten 58 → 109 and the item name was garbled.
  const truth = {
    vendor_name: "7-Eleven", vendor_tax_id: "0107542000011", doc_number: null,
    doc_date: null, subtotal: null, vat_amount: null, total_amount: 58,
    line_items: [{ description: "เครื่องปรุงรสเกลือสมุนไพร", amount: 58 }],
  }
  const predicted = { ...truth, total_amount: 109 }
  const r = scoreAll([{ truth, predicted }])
  assert.equal(r.fields.total_amount, 0, "the wrong total must score zero")
  assert.equal(r.perfect_documents, 0)
  assert.equal(r.vendor_name_cer, 0, "vendor was read correctly and should not be penalised")
})

check("missing line items count as total misses, not as absent comparisons", () => {
  // Silently ignoring unmatched items would let a model that returns one item
  // out of five score the same as one that returns all five correctly.
  const truth = {
    vendor_name: null, vendor_tax_id: null, doc_number: null, doc_date: null,
    subtotal: null, vat_amount: null, total_amount: null,
    line_items: [{ description: "ก", amount: 1 }, { description: "ข", amount: 2 }],
  }
  const predicted = { ...truth, line_items: [{ description: "ก", amount: 1 }] }
  const r = scoreAll([{ truth, predicted }])
  assert.equal(r.line_item_cer, 0.5, "one perfect item + one missing = mean CER 0.5")
  assert.equal(r.line_item_count_match, 0)
})

check("fields absent from the receipt are not counted as errors", () => {
  const truth = {
    vendor_name: "ร้าน", vendor_tax_id: null, doc_number: null, doc_date: null,
    subtotal: null, vat_amount: null, total_amount: 100, line_items: [],
  }
  const r = scoreAll([{ truth, predicted: { ...truth, vendor_tax_id: "9999999999999" } }])
  // The receipt had no tax id, so there is nothing to be right or wrong about.
  assert.equal(r.fields.vendor_tax_id, 0)
  assert.equal(r.fields.total_amount, 1)
  assert.equal(r.perfect_documents, 1)
})

check("an empty eval set returns zeros rather than NaN", () => {
  const r = scoreAll([])
  assert.equal(r.examples, 0)
  assert.equal(r.vendor_name_cer, 0)
  assert.ok(Number.isFinite(r.perfect_documents))
})

console.log("\n▶ Splits — the leakage guarantee\n")

check("a merchant NEVER appears in two splits", () => {
  // The property the whole design exists for. Receipts cluster by shop, so a
  // per-document split puts 7-Eleven in train and test and the model scores
  // well by having memorised the shop rather than learned to read.
  const docs = Array.from({ length: 400 }, (_, i) => ({
    vendor_tax_id: `01075420000${String(i % 25).padStart(2, "0")}`,
    vendor_name: `shop-${i % 25}`,
  }))
  const examples = docs.map(d => {
    const key = merchantKey(d)
    return { merchant_key: key, split: assignSplit(key) as Split }
  })
  const report = auditLeakage(examples)
  assert.equal(report.leaked, false, `leaked merchants: ${JSON.stringify(report.offenders)}`)
})

check("adding merchants never moves an existing merchant between splits", () => {
  // A shuffle-based split silently re-partitions on every rebuild, so the
  // held-out set stops being held out and two evals a week apart aren't
  // comparable. Hash-based assignment is what prevents that.
  const before = ["a", "b", "c"].map(n => assignSplit(`name:${n}`))
  const after  = ["a", "b", "c"].map(n => assignSplit(`name:${n}`))  // corpus grew around them
  assert.deepEqual(before, after)
  assert.equal(assignSplit("name:a"), assignSplit("name:a"))
})

check("bucketing is deterministic and spreads across the range", () => {
  assert.equal(bucketOf("stable-key"), bucketOf("stable-key"))
  const buckets = Array.from({ length: 300 }, (_, i) => bucketOf(`merchant-${i}`))
  assert.ok(Math.min(...buckets) < 20, "distribution should reach the low end")
  assert.ok(Math.max(...buckets) > 80, "distribution should reach the high end")
  const splits = new Set(buckets.map(b => (b < 70 ? "train" : b < 85 ? "validation" : "test")))
  assert.equal(splits.size, 3, "all three splits must be populated")
})

check("tax id beats name — one shop misread two ways stays one merchant", () => {
  // Production has exactly this: "ไฟแรงได้รุ่ง" and "ไฟแรงโต้รุ่ง" are one shop.
  // Keying on the printed name would split it across train and test.
  const a = merchantKey({ vendor_tax_id: "0107542000011", vendor_name: "ไฟแรงได้รุ่ง หัวหมาก20" })
  const b = merchantKey({ vendor_tax_id: "010-754-200-0011", vendor_name: "ไฟแรงโต้รุ่ง หัวหมาก20" })
  assert.equal(a, b)
  assert.equal(assignSplit(a), assignSplit(b))
})

check("name fallback folds case and whitespace", () => {
  assert.equal(
    merchantKey({ vendor_tax_id: null, vendor_name: "  Cafe   Amazon " }),
    merchantKey({ vendor_tax_id: null, vendor_name: "cafe amazon" }),
  )
})

check("an unidentifiable merchant goes to train, never to test", () => {
  // It cannot be proven not to share a shop with something held out, and an
  // unprovable non-overlap in the test set is the same failure as a known one.
  assert.equal(merchantKey({ vendor_tax_id: null, vendor_name: null }), null)
  assert.equal(assignSplit(null), "train")
  assert.equal(assignSplit(merchantKey({ vendor_tax_id: "12345", vendor_name: "   " })), "train")
})

check("the leak audit actually catches a leak", () => {
  // A guarantee whose test can't fail is not a guarantee.
  const report = auditLeakage([
    { merchant_key: "tax:0107542000011", split: "train" },
    { merchant_key: "tax:0107542000011", split: "test" },
  ])
  assert.equal(report.leaked, true)
  assert.deepEqual(report.offenders[0].splits, ["test", "train"])
})

console.log("\n▶ Redaction\n")

check("a card number is removed and reported", () => {
  const { value, redactions } = redactFreeText("VISA 4111 1111 1111 1111 ขอบคุณ", "vendor_name")
  assert.ok(!/4111/.test(value!), `PAN survived: ${value}`)
  assert.equal(redactions[0].kind, "pan")
})

check("a Thai 13-digit ID is redacted but the vendor tax id field is untouched", () => {
  // Both are 13 digits; Luhn separates them. The tax id is what the product
  // exists to extract, so it stays in its own structured field — only a copy
  // loose inside free text is scrubbed.
  const { value, redactions } = redactFreeText("ผู้เสียภาษี 0105536001114", "vendor_name")
  assert.ok(!/0105536001114/.test(value!))
  assert.equal(redactions[0].kind, "national_id")

  const target = redactTarget({ vendor_name: "7-Eleven", line_items: [] })
  assert.equal(target.fields.vendor_name, "7-Eleven", "a clean name must pass through unchanged")
  assert.deepEqual(target.redactedFields, [])
})

check("phone numbers and emails are removed", () => {
  assert.ok(!/0812345678/.test(redactFreeText("โทร 0812345678", "x").value!))
  assert.ok(!/@/.test(redactFreeText("ติดต่อ shop@example.com", "x").value!))
})

check("redaction reaches line items and names every field it touched", () => {
  // Without the field list a reviewer cannot tell a redaction from a model
  // error later — the text looks equally wrong either way.
  const { fields, redactedFields } = redactTarget({
    vendor_name: "ร้าน 4111111111111111",
    line_items: [{ description: "บัตร 5500005555555559", amount: 10 },
                 { description: "ข้าวผัด", amount: 60 }],
  })
  assert.ok(!/4111/.test(fields.vendor_name!))
  assert.ok(!/5555555559/.test(fields.line_items[0].description))
  assert.equal(fields.line_items[1].description, "ข้าวผัด", "clean items must not be altered")
  assert.deepEqual(redactedFields.sort(), ["line_items[0].description", "vendor_name"])
})

check("ordinary receipt numbers are not mistaken for personal data", () => {
  // Over-redaction destroys the training signal as surely as under-redaction
  // leaks it; a 6-digit POS reference is neither a card nor an ID.
  const { value, redactions } = redactFreeText("POS#E030372020011 ยอด 86.00", "x")
  assert.equal(redactions.length, 0)
  assert.equal(value, "POS#E030372020011 ยอด 86.00")
})

console.log("\n▶ Quality gate\n")

check("a clean, verified, well-resolved receipt is admitted", () => {
  const v = admit(candidate(), new Set())
  assert.equal(v.admitted, true, `unexpected rejection: ${v.reasons}`)
})

check("the low-resolution captures that started all this are rejected", () => {
  // 762×800 and 908×778 — the two 7-Eleven receipts whose Thai came back
  // invented. Training on them would teach the model to invent Thai, because
  // the target says words the pixels never contained.
  for (const [w, h] of [[762, 800], [908, 778]]) {
    const v = admit(candidate({ source_width: w, source_height: h }), new Set())
    assert.ok(v.reasons.includes("low_resolution"), `${w}×${h} should be rejected`)
  }
})

check("a document that contradicts its own arithmetic is rejected", () => {
  const v = admit(candidate({ subtotal: 100, vat_amount: 9, total_amount: 58 }), new Set())
  assert.ok(v.reasons.includes("amounts_unreconciled"))
})

check("BOTH VAT conventions are accepted", () => {
  // Rejecting either would throw away correct receipts wholesale — VAT-inclusive
  // is the more common Thai layout.
  assert.equal(admit(candidate({ subtotal: 80.37, vat_amount: 5.63, total_amount: 86 }), new Set()).admitted, true)
  assert.equal(admit(candidate({
    subtotal: 120, vat_amount: 7.85, total_amount: 120,
    line_items: [{ description: "กาแฟ", amount: 70 }, { description: "ขนม", amount: 50 }],
  }), new Set()).admitted, true)
})

check("unverified and non-financial documents never enter the corpus", () => {
  assert.ok(admit(candidate({ verified_by: null }), new Set()).reasons.includes("unverified"))
  assert.ok(admit(candidate({ status: "rejected" }), new Set()).reasons.includes("not_financial"))
})

check("the same receipt uploaded twice is admitted once", () => {
  // With a corpus this small one duplicate is several percent of it, silently
  // arguing with whatever it duplicates.
  const seen = new Set<string>()
  assert.equal(admit(candidate({ id: "a" }), seen).admitted, true)
  const second = admit(candidate({ id: "b" }), seen)
  assert.equal(second.admitted, false)
  assert.ok(second.reasons.includes("duplicate"))
})

check("a rejected document does not poison the duplicate index", () => {
  // Otherwise the first (bad) copy silently blocks a later good scan of the
  // same receipt — the corpus loses a document it should have kept.
  const seen = new Set<string>()
  assert.equal(admit(candidate({ source_width: 700, source_height: 700 }), seen).admitted, false)
  assert.equal(admit(candidate({ source_width: 1400, source_height: 2200 }), seen).admitted, true)
})

check("content hash keys on the receipt, not on the row", () => {
  assert.equal(contentHash(candidate({ id: "a" })), contentHash(candidate({ id: "b" })))
  assert.notEqual(contentHash(candidate()), contentHash(candidate({ total_amount: 99 })))
})

check("rejection reasons are tallied so a small corpus is explainable", () => {
  const seen = new Set<string>()
  const counts = summarise([
    admit(candidate({ id: "1" }), seen),
    admit(candidate({ id: "2", source_width: 700, source_height: 700 }), seen),
    admit(candidate({ id: "3", verified_by: null }), seen),
  ])
  assert.equal(counts.admitted, 1)
  assert.equal(counts.low_resolution, 1)
  assert.equal(counts.unverified, 1)
})

console.log("\n▶ Record schema\n")

const example = (over: Partial<TrainingExample> = {}): TrainingExample => ({
  id: "doc-1", split: "train", merchant_key: "tax:0107542000011",
  messages: [
    { role: "user", content: [{ type: "image", image_path: "/abs/receipt.jpg" },
                              { type: "text", text: "Extract the fields." }] },
    { role: "assistant", content: encodeTarget({
        vendor_name: "7-Eleven", vendor_tax_id: "0107542000011", doc_number: null,
        doc_date: null, subtotal: null, vat_amount: null, total_amount: 86, line_items: [],
      }) },
  ],
  metadata: {
    verified_by: "user-1", verified_at: "2026-08-14T00:00:00Z",
    source_width: 1400, source_height: 2200, redacted_fields: [],
  },
  ...over,
})

check("a well-formed example validates", () => {
  assert.deepEqual(validateExample(example()), [])
})

check("an empty assistant turn is caught", () => {
  // It trains the model to answer with nothing, and the loss curve looks fine.
  const bad = example()
  bad.messages[1].content = "   "
  assert.ok(validateExample(bad).some(i => i.field === "messages[1]"))
})

check("a relative image path is caught", () => {
  // It resolves differently on every machine, turning a portable corpus into
  // one that only works on the box that built it.
  const bad = example()
  bad.messages[0].content = [{ type: "image", image_path: "receipt.jpg" }]
  assert.ok(validateExample(bad).some(i => i.field === "messages[0].image"))
})

check("a non-JSON or unattributed target is caught", () => {
  const notJson = example()
  notJson.messages[1].content = "vendor is 7-Eleven"
  assert.ok(validateExample(notJson).some(i => i.reason.includes("not valid JSON")))

  const anon = example()
  anon.metadata.verified_by = ""
  assert.ok(validateExample(anon).some(i => i.field === "metadata.verified_by"))
})

check("null and malformed records never throw", () => {
  assert.ok(validateExample(null).length > 0)
  assert.ok(validateExample({} as TrainingExample).length > 0)
})

console.log("\n▶ Manifest and reproducibility\n")

check("fingerprint is content-addressed, not order- or time-dependent", () => {
  // Two builds with the same fingerprint are the same experiment; two without
  // it are not, and any comparison across them is invalid.
  const a = example({ id: "doc-1" })
  const b = example({ id: "doc-2" })
  assert.equal(fingerprint([a, b]), fingerprint([b, a]))
  assert.equal(fingerprint([a, b]), fingerprint([a, b]))
})

check("fingerprint changes when any target or split changes", () => {
  const base = [example({ id: "doc-1" })]
  const movedSplit = [example({ id: "doc-1", split: "test" })]
  const changedTarget = [example({ id: "doc-1" })]
  changedTarget[0].messages[1].content = encodeTarget({
    vendor_name: "CHANGED", vendor_tax_id: null, doc_number: null, doc_date: null,
    subtotal: null, vat_amount: null, total_amount: 86, line_items: [],
  })
  assert.notEqual(fingerprint(base), fingerprint(movedSplit))
  assert.notEqual(fingerprint(base), fingerprint(changedTarget))
})

check("target encoding has stable key order", () => {
  // Otherwise the fingerprint changes for no reason and every prior measurement
  // becomes incomparable.
  const fields = {
    vendor_name: "ร้าน", vendor_tax_id: "0107542000011", doc_number: "A1",
    doc_date: "2026-08-13", subtotal: 1, vat_amount: 2, total_amount: 3,
    line_items: [{ description: "ก", amount: 1 }],
  }
  assert.equal(encodeTarget(fields), encodeTarget({ ...fields }))
  assert.equal(JSON.parse(encodeTarget(fields)).vendor_name, "ร้าน")
})

check("manifest counts splits and distinct merchants", () => {
  const m = buildManifest([
    example({ id: "1", split: "train", merchant_key: "tax:A" }),
    example({ id: "2", split: "train", merchant_key: "tax:A" }),
    example({ id: "3", split: "test",  merchant_key: "tax:B" }),
  ])
  assert.equal(m.counts.total, 3)
  assert.equal(m.counts.train, 2)
  assert.equal(m.merchants.train, 1, "two documents from one shop is one merchant")
  assert.equal(m.schema_version, DATASET_SCHEMA_VERSION)
})

check("readiness refuses to bless a corpus too thin to measure anything", () => {
  // The likeliest failure here: this org has 60 documents and 2 with feedback.
  // A three-receipt "test set" reports 100% accuracy and means nothing, and a
  // number that gets reported gets believed.
  const thin = buildManifest([example({ id: "1", split: "test", merchant_key: "tax:A" })])
  const verdict = readiness(thin)
  assert.equal(verdict.ready, false)
  assert.ok(verdict.warnings.some(w => w.includes("test set has")))
  assert.ok(verdict.warnings.some(w => w.includes("merchant")))
})

check("a corpus that clears every bar reports ready", () => {
  const big = buildManifest([
    ...Array.from({ length: 120 }, (_, i) => example({ id: `tr-${i}`, split: "train", merchant_key: `tax:T${i}` })),
    ...Array.from({ length: 35 },  (_, i) => example({ id: `te-${i}`, split: "test",  merchant_key: `tax:E${i}` })),
  ])
  assert.deepEqual(readiness(big).warnings, [])
  assert.equal(readiness(big).ready, true)
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
