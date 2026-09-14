/**
 * Amount-reconciliation verification — run with:  npm run verify:amounts
 *
 * Exercises the real `reconcileAmounts()` and `isNonItemRow()` from the pipeline
 * against the two receipts that actually failed in the field, plus regression
 * cases that must NOT be touched. No LLM, no network, no deploy — money logic
 * is silent when it breaks, so it needs to be provable locally.
 */
import assert from "node:assert/strict"
import { reconcileAmounts, isNonItemRow, type ReconcilableAmounts , shouldUseDocAiFallback, formatDocAiFields, lineItemSumMismatch } from "../pipeline/extractor"
import { isValidThaiTaxId } from "../pipeline/tax-id"
import { vatModel, lineItemSumCheck } from "../pipeline/amounts"
import { numericOnlyOcr } from "../pipeline/extractor"
import { amountBase, checkVat } from "../pipeline/validator"

type Amounts = Partial<ReconcilableAmounts>

function make(over: Amounts): ReconcilableAmounts {
  return {
    subtotal: 0, discount_amount: 0, delivery_fee: 0,
    vat_amount: 0, wht_amount: 0, total_amount: 0, paid_amount: 0,
    confidence_score: 1, line_items: [], extraction_issues: [],
    ...over,
  }
}

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

console.log("\n▶ Field failures — must be corrected\n")

check("Fuji ฿420 VAT-included receipt: total 523 → 420", () => {
  const d = reconcileAmounts(make({ subtotal: 420, vat_amount: 27.48, total_amount: 523 }))
  assert.equal(d.total_amount, 420)
  assert.ok(d.confidence_score < 1, "confidence must drop after a correction")
  assert.ok(d.extraction_issues!.length > 0, "must record why it changed")
})

check("ยอดชา ฿68 no-VAT receipt: total 60 → 68 (line items corroborate)", () => {
  const d = reconcileAmounts(make({
    subtotal: 68, vat_amount: 0, total_amount: 60,
    line_items: [{ amount: 19 }, { amount: 49 }],
  }))
  assert.equal(d.total_amount, 68)
  assert.ok(d.confidence_score < 1)
})

console.log("\n▶ Regressions — correct data must be left ALONE\n")

check("VAT-exclusive tax invoice 100 + 7 = 107 untouched", () => {
  const d = reconcileAmounts(make({ subtotal: 100, vat_amount: 7, total_amount: 107 }))
  assert.equal(d.total_amount, 107)
})

check("VAT-inclusive receipt already correct (420/27.48/420) untouched", () => {
  const d = reconcileAmounts(make({ subtotal: 420, vat_amount: 27.48, total_amount: 420 }))
  assert.equal(d.total_amount, 420)
})

check("no-VAT total kept when line items do NOT corroborate subtotal", () => {
  // Only evidence is the subtotal itself → too risky to overwrite the total.
  const d = reconcileAmounts(make({
    subtotal: 68, vat_amount: 0, total_amount: 60, line_items: [{ amount: 12 }],
  }))
  assert.equal(d.total_amount, 60)
})

check("legit discount on a no-VAT bill is respected", () => {
  const d = reconcileAmounts(make({
    subtotal: 100, vat_amount: 0, discount_amount: 10, total_amount: 90,
    line_items: [{ amount: 60 }, { amount: 40 }],
  }))
  assert.equal(d.total_amount, 90)
})

check("missing total is derived from subtotal + VAT", () => {
  const d = reconcileAmounts(make({ subtotal: 200, vat_amount: 14, total_amount: 0 }))
  assert.equal(d.total_amount, 214)
})

console.log("\n▶ A misread subtotal must not overwrite a correct total\n")

check("7-Eleven ฿58: 'subtotal 100' is the cash tendered → total stays 58", () => {
  // Production doc 67156d80. The slip reads: one item 2 × 29 = 58, เงินสด 100,
  // ทอน 42. The model put the cash tendered into subtotal and a misread 9 into
  // VAT, and the old tolerance — 2% of the BASE — accepted a VAT that is 28.6%
  // wrong, then "corrected" a perfectly good ฿58 up to ฿109.
  const d = reconcileAmounts(make({
    subtotal: 100, vat_amount: 9, total_amount: 58,
    line_items: [{ amount: 58 }],
  }))
  assert.equal(d.total_amount, 58)
})

check("the tolerance is a share of the VAT, not of the base", () => {
  // Same shape, ten times the money: base 1000, true 7% VAT is 70, and 90 is
  // just as wrong here as 9 was against 100. Scaling with the base hid that.
  const d = reconcileAmounts(make({
    subtotal: 1000, vat_amount: 90, total_amount: 580,
    line_items: [{ amount: 580 }],
  }))
  assert.equal(d.total_amount, 580)
})

check("line items backing the total (and contradicting the subtotal) win", () => {
  // Belt and braces: even when the VAT does check out against the subtotal,
  // line items that add up to the total and NOT to the subtotal mean the
  // subtotal is the misread number.
  const d = reconcileAmounts(make({
    subtotal: 100, vat_amount: 7, total_amount: 58,
    line_items: [{ amount: 29 }, { amount: 29 }],
  }))
  assert.equal(d.total_amount, 58)
})

check("a genuinely misread total IS still corrected when items back the subtotal", () => {
  // The protection above must not become a blanket veto: here the items agree
  // with the subtotal, so the total is the odd one out and gets fixed.
  const d = reconcileAmounts(make({
    subtotal: 100, vat_amount: 7, total_amount: 100,
    line_items: [{ amount: 60 }, { amount: 40 }],
  }))
  assert.equal(d.total_amount, 107)
})

check("a real VAT (within 5% of 7%) still confirms the pair", () => {
  // 27.48 is exactly 7/107 of 420 — rounding noise must not disarm the check.
  const d = reconcileAmounts(make({ subtotal: 420, vat_amount: 27.5, total_amount: 523 }))
  assert.equal(d.total_amount, 420)
})

console.log("\n▶ Service charge — the ฿94 that rewrote a ฿1,039 bill\n")

check("CoCo Ichibanya: service charge read → total stays 1,039", () => {
  // Production doc 37c7f466, confirmed against the paper:
  //   SubTotal 945 / Service Charge(10%) 94 / Total 1,039 / VAT Included 67.97
  // 1039 × 7/107 = 67.97 exactly — the VAT base is subtotal PLUS the service
  // charge, which is why the old vatBase (subtotal alone) mis-read this as a
  // VAT-exclusive receipt and "corrected" 1,039 down to 1,012.97.
  const d = reconcileAmounts(make({
    subtotal: 945, delivery_fee: 94, vat_amount: 67.97, total_amount: 1039,
    line_items: [{ amount: 945 }],
  }))
  assert.equal(d.total_amount, 1039)
})

check("the same bill with the service charge MISSED is saved by the paid amount", () => {
  // What the extractor actually produced before the prompt knew about service
  // charges. The receipt prints "M/C 1,039.00" — the amount the card was
  // charged — which is the strongest possible confirmation of a total.
  const d = reconcileAmounts(make({
    subtotal: 945, vat_amount: 67.97, total_amount: 1039, paid_amount: 1039,
    line_items: [{ amount: 945 }],
  }))
  assert.equal(d.total_amount, 1039)
  assert.ok(d.extraction_issues!.some(i => i.includes("ยอดที่ชำระ")),
    "must say why it kept the total instead of silently doing nothing")
})

check("a paid amount arriving as a formatted STRING still vetoes", () => {
  // The model writes amounts the way a receipt prints them. paid_amount was
  // omitted from the numeric coercion block, so "1,039.00" reached the veto as
  // a string: it passed the `<= 0` guard, then every comparison became NaN and
  // the safeguard silently switched itself off. Shipped and deployed that way.
  const d = reconcileAmounts(make({
    subtotal: 945, vat_amount: 67.97, total_amount: 1039,
    paid_amount: "1,039.00" as unknown as number,
    line_items: [{ amount: 945 }],
  }))
  assert.equal(d.total_amount, 1039)
})

check("a nonsense paid amount cannot disable a real correction", () => {
  for (const junk of ["abc", "", NaN, Infinity, null, undefined]) {
    const d = reconcileAmounts(make({
      subtotal: 420, vat_amount: 27.48, total_amount: 523,
      paid_amount: junk as unknown as number,
    }))
    assert.equal(d.total_amount, 420, `junk paid_amount ${String(junk)} must not veto`)
  }
})

check("a paid amount that does NOT match the total never vetoes a real correction", () => {
  // Partial payments and deposits exist; the veto only applies when the tender
  // line agrees with the total that was read.
  const d = reconcileAmounts(make({
    subtotal: 420, vat_amount: 27.48, total_amount: 523, paid_amount: 200,
  }))
  assert.equal(d.total_amount, 420)
})

check("HomePro: VAT-inclusive with a discount is left alone", () => {
  // Production doc 477c77b4: Sub Total 987 / Discount −29.61 / TOTAL 957.39 /
  // VAT 62.63, and 957.39 × 7/107 = 62.63.
  const d = reconcileAmounts(make({
    subtotal: 987, discount_amount: 29.61, vat_amount: 62.63, total_amount: 957.39,
    paid_amount: 957.39,
    line_items: [{ amount: 105.73 }, { amount: 445.23 }, { amount: 406.43 }],
  }))
  assert.equal(d.total_amount, 957.39)
})

check("a service charge on a VAT-EXCLUSIVE receipt still adds up", () => {
  // subtotal 1000 + service 100 = 1100 base, VAT added on top = 77, total 1177.
  const d = reconcileAmounts(make({
    subtotal: 1000, delivery_fee: 100, vat_amount: 77, total_amount: 1177,
  }))
  assert.equal(d.total_amount, 1177)
})

console.log("\n▶ Validator: VAT + total base must know about fees and discounts\n")

check("CoCo: VAT-inclusive on subtotal + service charge passes", () => {
  // The bug this catches only appeared AFTER the extractor learned to read
  // service charges: the reconciler had the full formula, the validator did
  // not, so a now-correct ฿1,039 bill came back flagged TOTAL_MISMATCH.
  const d = { subtotal: 945, delivery_fee: 94, discount_amount: 0, vat_amount: 67.97 }
  assert.equal(amountBase(d), 1039)
  assert.equal(checkVat(d).ok, true)
})

check("HomePro: VAT-inclusive on subtotal minus discount passes", () => {
  const d = { subtotal: 987, delivery_fee: 0, discount_amount: 29.61, vat_amount: 62.63 }
  assert.equal(amountBase(d), 957.39)
  assert.equal(checkVat(d).ok, true)
})

check("plain VAT-exclusive still passes", () => {
  assert.equal(checkVat({ subtotal: 100, vat_amount: 7 }).ok, true)
})

check("the validator keeps its ฿1 tolerance floor on small receipts", () => {
  // Pins a behaviour change the consolidation nearly smuggled in: the core
  // defaults to a ฿0.50 floor for the reconciler, and taking that default here
  // doubled the strictness on every receipt under ฿1,000. Nothing else would
  // have caught it — the warning it produces looks exactly like a real one.
  assert.equal(checkVat({ subtotal: 500, vat_amount: 35.8 }).ok, true,  "within ฿1 must pass")
  assert.equal(checkVat({ subtotal: 500, vat_amount: 36.5 }).ok, false, "beyond ฿1 must fail")
})

check("a genuinely wrong VAT is still caught", () => {
  assert.equal(checkVat({ subtotal: 945, delivery_fee: 94, vat_amount: 200 }).ok, false)
  assert.equal(checkVat({ subtotal: 100, vat_amount: 25 }).ok, false)
})

check("the base never goes negative on an over-read discount", () => {
  assert.equal(amountBase({ subtotal: 100, discount_amount: 500 }), 0)
})

check("net-as-total detection uses the fee-inclusive base too", () => {
  // The block that spots "the total is really the pre-VAT net" kept its own
  // `subtotal * 7/107` sixty lines above the block that had been taught about
  // service charges — the same defect, twice, in one function. Consolidating
  // into ./amounts removed it by construction; this pins it.
  //
  // Bill: items 1000, service 100, discount 150 unread, VAT-inclusive on the
  // discounted base. Nothing here may be silently rewritten.
  const d = reconcileAmounts(make({
    subtotal: 1000, delivery_fee: 100, vat_amount: 62.15, total_amount: 950,
    paid_amount: 950, line_items: [{ amount: 1000 }],
  }))
  assert.equal(d.total_amount, 950, "a tender-confirmed total is never rewritten")
})

check("every consumer agrees on one base — reconciler, validator, corpus gate", () => {
  // The single property this whole refactor exists to guarantee. CoCo's numbers
  // went through three modules and two of them disagreed about what the base
  // was, which is how one correct bill produced two different wrong answers.
  const doc = { subtotal: 945, delivery_fee: 94, discount_amount: 0, vat_amount: 67.97 }
  assert.equal(amountBase(doc), 1039)
  assert.equal(checkVat(doc).base, 1039)
  assert.equal(checkVat(doc).ok, true)
  const reconciled = reconcileAmounts(make({ ...doc, total_amount: 1039, line_items: [{ amount: 945 }] }))
  assert.equal(reconciled.total_amount, 1039)
})

check("DOCAI_ENABLED=0 silences every DocAI trigger", () => {
  // The three earlier triggers fire on things that are true of most Thai
  // receipts, so without a master switch there was no way to stop paying for a
  // second vendor short of editing code.
  const firesEverything = { confidence: 0.1, minLineItemConfidence: 0.1, sumMismatch: true,
                            degradedCapture: true, lineItems: [{ description: "น้ำเปล่า" }],
                            thaiGroundingEnabled: true }
  assert.equal(shouldUseDocAiFallback(firesEverything), true, "premise: this would normally fire")
  assert.equal(shouldUseDocAiFallback({ ...firesEverything, enabled: false }), false)
})

check("omitting the switch leaves behaviour exactly as it was", () => {
  const d = { confidence: 0.1, minLineItemConfidence: 0.9, sumMismatch: false,
              degradedCapture: false, lineItems: [] }
  assert.equal(shouldUseDocAiFallback(d), true)
  assert.equal(shouldUseDocAiFallback({ ...d, enabled: true }), true)
})

console.log("\n▶ Receipts that print their own totals\n")

check("Ramen Osaka: a 7% service charge belongs in the VAT base", () => {
  // Paper: Total 598.00 / Service (7%) 41.86 / Before VAT 640.21 / VAT 44.79 /
  // Grand Total 685.00. The service charge was dropped because the prompt named
  // only the "Service Charge(10%)" spelling, so the base came out 598 and both
  // VAT and total were flagged on a bill whose every number was right.
  const d = { subtotal: 598, delivery_fee: 41.86, vat_amount: 44.79, total_amount: 685 }
  assert.equal(amountBase(d), 639.86)
  assert.equal(vatModel(d).convention, "exclusive")
  const recon = reconcileAmounts(make(d))
  assert.equal(recon.total_amount, 685, "a printed grand total must survive")
})

check("the café bill: printed total outranks a sum built from misread items", () => {
  // Paper: Subtotal 295.00 / Total 295.00 / Before VAT 275.70 / VAT 19.30, and
  // two items at 145 and 150. Both item prices were misread (445 and 120), the
  // totals were rebuilt from them, and ฿295 was recorded as ฿584.30 — internally
  // consistent (565 + 19.30) and reconciled "balanced", which is exactly why no
  // arithmetic check could catch it.
  //
  // What is testable here is the shape once the total is read correctly: an
  // inclusive-VAT base of 295 with VAT 19.30 must reconcile and stay put.
  const d = { subtotal: 295, vat_amount: 19.30, total_amount: 295,
              line_items: [{ amount: 145 }, { amount: 150 }] }
  assert.equal(vatModel(d).convention, "inclusive")
  assert.equal(+(295 * 7 / 107).toFixed(2), 19.30)
  assert.equal(reconcileAmounts(make(d)).total_amount, 295)
  const sum = lineItemSumCheck(d)!
  assert.equal(sum.mismatch, false, "145 + 150 = 295 agrees with the printed total")
})

console.log("\n▶ Document AI text: numbers kept, transliterated Thai dropped\n")

check("the real DocAI output for a Thai receipt yields figures and no words", () => {
  // Verbatim from Google Document AI on production doc 27ac9e3d. The processor
  // configured here cannot read Thai — it transliterates it into Latin — while
  // reading every number perfectly.
  const raw = [
    "TAX ID: 0105562009772",
    "tulafaulu / Turada",
    "24 ningnaw 2569 20:15",
    "3 Quwwa lugj",
    "657.00",
    "LAND UỐN",
    "774.00",
  ].join("\n")
  const out = numericOnlyOcr(raw)
  assert.ok(out.includes("657.00") && out.includes("774.00"), "figures must survive")
  assert.ok(out.includes("0105562009772"), "the tax id is a figure and survives")
  for (const junk of ["Quwwa", "ningnaw", "tulafaulu", "LAND"]) {
    assert.ok(!out.includes(junk), `transliterated "${junk}" must not reach the prompt`)
  }
})

check("no word of any script can pass through", () => {
  // The guarantee is structural, not a filter that might be tuned wrong later:
  // the output is built FROM the digits, so nothing else can be in it.
  const out = numericOnlyOcr("สุกี้ บุฟเฟต์ ผู้ใหญ่ 657.00\nยอดสุทธิ 828.18")
  assert.ok(out.includes("657.00") && out.includes("828.18"))
  assert.ok(!/[A-Za-z\u0E00-\u0E7F]/.test(out.replace("ตัวเลขที่พบ:", "")), "no letters may remain")
})

check("single stray digits are noise, not figures", () => {
  assert.equal(numericOnlyOcr("a 1 b 2 c"), "")
})

check("empty input is handled", () => {
  assert.equal(numericOnlyOcr(""), "")
  assert.equal(numericOnlyOcr("no digits at all"), "")
})

console.log("\n▶ Thai tax ID validation\n")

check("real tax IDs from production pass the mod-11 checksum", () => {
  assert.equal(isValidThaiTaxId("0107542000011"), true, "CP All")
  assert.equal(isValidThaiTaxId("0107544000043"), true, "HomePro")
  assert.equal(isValidThaiTaxId("0105552046802"), true, "TANA CURRY HOUSE")
})

check("the misread CP All id from doc 67156d80 is rejected", () => {
  // Two 7-Eleven receipts carried different "CP All" tax IDs. This is the one
  // that isn't real — the checksum says so without needing a registry lookup.
  assert.equal(isValidThaiTaxId("0105536001114"), false)
})

check("repeated-digit placeholders are rejected", () => {
  // Production doc 3e3e4d8e stored "0000000000000". Thirteen zeros passes every
  // length check, and as a merchant key it would silently merge unrelated shops.
  assert.equal(isValidThaiTaxId("0000000000000"), false)
  assert.equal(isValidThaiTaxId("1111111111111"), false)
  assert.equal(isValidThaiTaxId("9999999999999"), false)
})

check("malformed input is rejected without throwing", () => {
  for (const bad of ["", "123", "01075420000112", "abcdefghijklm", null, undefined]) {
    assert.equal(isValidThaiTaxId(bad as string), false, String(bad))
  }
})

check("formatting is tolerated, content is not", () => {
  assert.equal(isValidThaiTaxId("0-1075-42000-01-1"), true)
  assert.equal(isValidThaiTaxId("0107542000012"), false, "wrong check digit")
})

console.log("\n▶ Non-item row filter\n")

check("payment / total / points rows are rejected", () => {
  for (const row of ["Items: 2", "Cash", "Change", "Subtotal", "Total", "VAT",
                     "ก่อนภาษี", "เงินทอน", "คะแนนพิเศษเมื่อสมัครสมาชิกครั้งแรก"]) {
    assert.ok(isNonItemRow(row), `should reject: ${row}`)
  }
})

check("real product names are kept", () => {
  for (const row of ["ไอติมกะทิกาด หลวง เชียงใหม่", "ขนมปังเนยเยิ้มเชียงใหม่",
                     "PORK YAKINIKU BENTO S", "ข้าวผัดรวมมิตร", "ค่าสมาชิกรายปี"]) {
    assert.ok(!isNonItemRow(row), `should keep: ${row}`)
  }
})

console.log("\n▶ Mislabeled net-as-total (an unread discount line)\n")

check("KOFUKU: items 1126, unread −80 discount, net 1046 in total → total 1119.22", () => {
  // Real receipt. VAT 73.22 is exactly 7% of the NET 1046, while the recorded
  // subtotal 1126 is the pre-discount item sum — whose VAT-inclusive figure
  // (73.66) sits close enough to look like a match, which is what previously
  // locked in the wrong answer.
  const d = reconcileAmounts(make({
    subtotal: 1126, vat_amount: 73.22, total_amount: 1046,
    line_items: [{ amount: 259 }, { amount: 558 }, { amount: 259 }, { amount: 50 }],
  }))
  assert.equal(d.total_amount, 1119.22, "true total = net + VAT")
  assert.equal(d.discount_amount, 80, "the unread discount is recovered")
  assert.equal(d.subtotal, 1126, "subtotal stays the pre-discount item sum")
  // The books must balance: subtotal + VAT − discount = total.
  assert.equal(+(d.subtotal + d.vat_amount - d.discount_amount).toFixed(2), d.total_amount)
  assert.ok(d.confidence_score < 1)
  assert.ok(d.extraction_issues!.some(i => i.includes("ส่วนลด")), "must say a discount was inferred")
})

check("no discount is invented when the line items don't back the subtotal", () => {
  const d = reconcileAmounts(make({
    subtotal: 1126, vat_amount: 73.22, total_amount: 1046,
    line_items: [{ amount: 500 }],          // nowhere near 1126
  }))
  assert.equal(d.total_amount, 1119.22, "total is still corrected")
  assert.equal(d.discount_amount, 0, "but a discount must NOT be fabricated")
})

check("the same receipt read correctly (discount seen) is left alone", () => {
  // Convention: subtotal is the pre-discount item sum, so
  // total = subtotal + VAT − discount = 1126 + 73.22 − 80 = 1119.22.
  // This used to be wrecked: the 7% test ran against the raw 1126, matched the
  // VAT-inclusive model by coincidence, and rewrote the total to 1046.
  const d = reconcileAmounts(make({
    subtotal: 1126, vat_amount: 73.22, total_amount: 1119.22, discount_amount: 80,
    line_items: [{ amount: 1126 }],
  }))
  assert.equal(d.total_amount, 1119.22, "a correct total must survive")
  assert.equal(d.subtotal, 1126)
  assert.equal(d.discount_amount, 80)
})

check("KOFUKU as Sonnet reads it: subtotal = 'Before TAX' (already net) → total kept", () => {
  // The receipt prints BOTH "Subtotal 1126" and "Before TAX 1046"; the model
  // reported the latter as subtotal, with discount 80 and the correct total.
  // Subtracting the discount a second time used to wreck it (→ 1039.22).
  const d = reconcileAmounts(make({
    subtotal: 1046, discount_amount: 80, vat_amount: 73.22, total_amount: 1119.22,
  }))
  assert.equal(d.total_amount, 1119.22, "a correctly-read total must survive")
  assert.equal(d.subtotal, 1126, "normalized to the pre-discount convention")
  assert.equal(+(d.subtotal + d.vat_amount - d.discount_amount).toFixed(2), d.total_amount)
})

check("a true pre-discount subtotal is NOT inflated again", () => {
  // Already convention (A): 1126 + 73.22 − 80 = 1119.22. Must be left as-is.
  const d = reconcileAmounts(make({
    subtotal: 1126, discount_amount: 80, vat_amount: 73.22, total_amount: 1119.22,
  }))
  assert.equal(d.subtotal, 1126, "must not add the discount on top a second time")
  assert.equal(d.total_amount, 1119.22)
})

check("genuine VAT-inclusive receipt (total == subtotal) is NOT hijacked", () => {
  // total is not < subtotal here, so the new rule must not engage at all.
  const d = reconcileAmounts(make({ subtotal: 420, vat_amount: 27.48, total_amount: 420 }))
  assert.equal(d.total_amount, 420)
  assert.equal(d.subtotal, 420)
})

console.log("\n▶ Google DocAI fallback routing\n")

const goodItems = [{ description: "เซตข้าวหน้าเนื้อวากิว" }, { description: "น้ำเปล่า" }]
const baseOk = {
  confidence: 0.9, minLineItemConfidence: 0.9, sumMismatch: false,
  degradedCapture: false, lineItems: goodItems,
}

check("clean capture + confident model → no fallback (don't pay for nothing)", () => {
  assert.equal(shouldUseDocAiFallback(baseOk), false)
})

check("KOFUKU regression: confident model but degraded capture + Thai → fallback", () => {
  // The exact numbers the model self-reported while misreading the Thai:
  // this used to slip through, which is why DocAI had never run in production.
  assert.equal(shouldUseDocAiFallback({
    ...baseOk, confidence: 0.78, minLineItemConfidence: 0.85, degradedCapture: true,
  }), true)
})

check("degraded capture with NO Thai items → no fallback (Latin/numbers survive)", () => {
  assert.equal(shouldUseDocAiFallback({
    ...baseOk, degradedCapture: true,
    lineItems: [{ description: "Coca-Cola 325ml" }, { description: "Item 2" }],
  }), false)
})

check("the original self-reported triggers still work", () => {
  assert.equal(shouldUseDocAiFallback({ ...baseOk, confidence: 0.4 }), true, "low overall")
  assert.equal(shouldUseDocAiFallback({ ...baseOk, minLineItemConfidence: 0.5 }), true, "low item")
  assert.equal(shouldUseDocAiFallback({ ...baseOk, sumMismatch: true }), true, "sum mismatch")
})

check("DOCAI_ON_LOW_QUALITY=0 disables ONLY the quality trigger", () => {
  assert.equal(shouldUseDocAiFallback({
    ...baseOk, degradedCapture: true, qualityTriggerEnabled: false,
  }), false, "quality trigger is off")
  assert.equal(shouldUseDocAiFallback({
    ...baseOk, confidence: 0.3, degradedCapture: true, qualityTriggerEnabled: false,
  }), true, "but a genuinely low confidence must still fall back")
})

check("empty line items never crash the routing", () => {
  assert.equal(shouldUseDocAiFallback({ ...baseOk, degradedCapture: true, lineItems: [] }), false)
})

console.log("\n▶ DocAI prompt block — good numbers in, shredded item names out\n")

// Exactly what Google's Expense parser returned for the KOFUKU receipt.
const kofukuDocAi = {
  totalAmount: 1119.22, netAmount: 1126, totalTaxAmount: 73.22,
  confidence: {},
  lineItems: [
    { description: "&",                  amount: undefined },
    { description: undefined,            amount: 0 },
    { description: "SIMPLICITY:",        amount: 259 },
    { description: "Simplicity Set",     amount: undefined },
    { description: undefined,            amount: 558 },
    { description: "OP",                 amount: undefined },
  ],
} as any

check("money fields are always passed through — they were exactly right", () => {
  const block = formatDocAiFields(kofukuDocAi)
  assert.ok(block.includes("1119.22"), "total")
  assert.ok(block.includes("1126"),    "net")
  assert.ok(block.includes("73.22"),   "vat")
})

check("shredded item names are withheld, not presented as authoritative", () => {
  const block = formatDocAiFields(kofukuDocAi)
  assert.ok(!block.includes("SIMPLICITY:"), "must not offer a fragment as an item name")
  assert.ok(!block.includes("OP"),          "must not offer noise as an item name")
  assert.ok(block.includes("อ่านชื่อสินค้าได้ไม่ชัด"), "must say why they're absent")
})

check("coherent line items ARE passed through (a clean receipt keeps them)", () => {
  const block = formatDocAiFields({
    totalAmount: 300, confidence: {},
    lineItems: [
      { description: "Cafe Latte",  amount: 120, quantity: 2 },
      { description: "Croissant",   amount: 180 },
    ],
  } as any)
  assert.ok(block.includes("Cafe Latte"), "usable items must survive")
  assert.ok(block.includes("Croissant"))
  assert.ok(!block.includes("อ่านชื่อสินค้าได้ไม่ชัด"))
})


console.log("\n▶ Line-item sum vs the two discount conventions\n")

// KOFUKU prints the discount INTO each item line (259→239, 558→498), so the
// items sum to subtotal − discount. Testing only against the raw subtotal
// declared this correct receipt broken and paid for an escalation + a DocAI
// fallback on every scan of it.
check("net convention: items sum to subtotal − discount → NOT a mismatch", () => {
  assert.equal(lineItemSumMismatch({
    subtotal: 1126, discount_amount: 80,
    line_items: [
      { description: "SIMPLICITY", amount: 239 },
      { description: "Premium",    amount: 498 },
      { description: "Signature",  amount: 259 },
      { description: "น้ำเปล่า",     amount: 50  },
      { description: "ทาโกะยากิ (แลกคะแนน)", amount: 0 },
    ],
  } as any), false)
})

check("gross convention: items sum to the subtotal itself → NOT a mismatch", () => {
  assert.equal(lineItemSumMismatch({
    subtotal: 1126, discount_amount: 80,
    line_items: [
      { description: "SIMPLICITY", amount: 259 },
      { description: "Premium",    amount: 558 },
      { description: "Signature",  amount: 259 },
      { description: "น้ำเปล่า",     amount: 50  },
    ],
  } as any), false)
})

check("a genuinely dropped item is still caught under both conventions", () => {
  // น้ำเปล่า ฿50 missing: 996 matches neither 1126 nor 1046.
  assert.equal(lineItemSumMismatch({
    subtotal: 1126, discount_amount: 80,
    line_items: [
      { description: "SIMPLICITY", amount: 239 },
      { description: "Premium",    amount: 498 },
      { description: "Signature",  amount: 259 },
    ],
  } as any), true)
})

check("no discount: behaviour is unchanged", () => {
  assert.equal(lineItemSumMismatch({
    subtotal: 300, line_items: [{ description: "A", amount: 120 }, { description: "B", amount: 180 }],
  } as any), false)
  assert.equal(lineItemSumMismatch({
    subtotal: 300, line_items: [{ description: "A", amount: 120 }],
  } as any), true)
})

check("VAT-inclusive prices: items sum to subtotal + VAT → NOT a mismatch", () => {
  // Production doc 77b66503. 7-Eleven prints shelf prices with VAT already in
  // them and breaks the tax out at the foot: มูลค่าสินค้า 80.37 + ภาษี 5.63 =
  // 86.00, and the item lines add up to 86.00. Testing only against the
  // ex-VAT subtotal made this correct receipt warn the user about a mismatch
  // that isn't there, and burned a DocAI retry on every scan of it.
  assert.equal(lineItemSumMismatch({
    subtotal: 80.37, vat_amount: 5.63,
    line_items: [
      { description: "ก๋วยเตี๋ยว", amount: 9  },
      { description: "ขนม",       amount: 28 },
      { description: "น้ำ",        amount: 49 },
    ],
  } as any), false)
})

check("a dropped item on a VAT-inclusive receipt is still caught", () => {
  // 37 matches neither 80.37 nor 86.00 — the third convention must not become
  // a blanket excuse.
  assert.equal(lineItemSumMismatch({
    subtotal: 80.37, vat_amount: 5.63,
    line_items: [
      { description: "ก๋วยเตี๋ยว", amount: 9  },
      { description: "ขนม",       amount: 28 },
    ],
  } as any), true)
})


console.log("\n▶ Thai grounding — DocAI on Thai documents only\n")

check("a healthy Thai receipt IS grounded when the flag is on", () => {
  // The Lotus receipt: confident model, sums balanced, sharp photo — every
  // existing trigger says "fine" while the Thai words come back wrong.
  assert.equal(shouldUseDocAiFallback({
    confidence: 0.95, minLineItemConfidence: 0.9, sumMismatch: false,
    degradedCapture: false, thaiGroundingEnabled: true,
    lineItems: [{ description: "ไอติมกะทิกาดหลวง" }],
  }), true)
})

check("the same receipt is NOT grounded when the flag is off", () => {
  assert.equal(shouldUseDocAiFallback({
    confidence: 0.95, minLineItemConfidence: 0.9, sumMismatch: false,
    degradedCapture: false, thaiGroundingEnabled: false,
    lineItems: [{ description: "ไอติมกะทิกาดหลวง" }],
  }), false)
})

check("a non-Thai receipt is never grounded, flag or not", () => {
  // DocAI would cost a second vendor for nothing: Latin text was never the
  // problem.
  assert.equal(shouldUseDocAiFallback({
    confidence: 0.95, minLineItemConfidence: 0.9, sumMismatch: false,
    degradedCapture: false, thaiGroundingEnabled: true,
    lineItems: [{ description: "Cafe Latte" }, { description: "Croissant" }],
  }), false)
})

check("grounding does not suppress the existing triggers", () => {
  // Low confidence still escalates even with the flag off.
  assert.equal(shouldUseDocAiFallback({
    confidence: 0.4, minLineItemConfidence: 0.9, sumMismatch: false,
    degradedCapture: false, thaiGroundingEnabled: false,
    lineItems: [{ description: "Cafe Latte" }],
  }), true)
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
