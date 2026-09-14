/**
 * Receipt row-classification verification — run with:  npm run verify:rows
 * Exercises the real classifier against the row types that keep getting
 * mis-bucketed, in Thai and English. No LLM, no network.
 */
import assert from "node:assert/strict"
import {
  classifyReceiptRow, reclassifyLineItems, normalizeLabel,
  type RowRole, type ReclassifiableDoc, type LearnedOverrides,
} from "../pipeline/receipt-rows"
import {
  deriveRowRoleCorrections, aggregateLearnedOverrides,
} from "../pipeline/receipt-feedback"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}
const roleOf = (label: string, amount?: number): RowRole =>
  classifyReceiptRow({ label, amount }).role

console.log("\n▶ Single-row classification (TH + EN)\n")

check("real products → item", () => {
  for (const l of ["ไอติมกะทิกาด หลวง เชียงใหม่", "ขนมปังเนยเยิ้มเชียงใหม่",
                   "PORK YAKINIKU BENTO S", "ข้าวผัดรวมมิตร", "Cafe Latte", "ค่าสมาชิกรายปี"]) {
    assert.equal(roleOf(l, 49), "item", l)
  }
})
check("totals & subtotal", () => {
  assert.equal(roleOf("Subtotal"), "subtotal")
  assert.equal(roleOf("ยอดก่อนภาษี"), "subtotal")
  assert.equal(roleOf("Total"), "total")
  assert.equal(roleOf("ยอดรวมทั้งสิ้น"), "total")
  assert.equal(roleOf("Grand Total"), "total")
})
check("tax", () => {
  assert.equal(roleOf("VAT 7%"), "vat")
  assert.equal(roleOf("ภาษีมูลค่าเพิ่ม"), "vat")
})
check("tender & change", () => {
  assert.equal(roleOf("Cash"), "tender")
  assert.equal(roleOf("เงินสด"), "tender")
  assert.equal(roleOf("MasterCard 5239"), "tender")
  assert.equal(roleOf("พร้อมเพย์"), "tender")
  assert.equal(roleOf("Change"), "change")
  assert.equal(roleOf("เงินทอน"), "change")
})
check("discount / promotion / freebie", () => {
  assert.equal(roleOf("ส่วนลด"), "discount")
  assert.equal(roleOf("Discount"), "discount")
  assert.equal(roleOf("โปรโมชั่นสมาชิก"), "discount")
  assert.equal(roleOf("คูปองส่วนลด"), "discount")
  assert.equal(roleOf("ของแถม"), "freebie")
  assert.equal(roleOf("Free"), "freebie")
  // Unlabelled ฿0 / negative rows fall back structurally
  assert.equal(roleOf("น้ำเปล่า", 0), "freebie")
  assert.equal(roleOf("โปรพิเศษ", -20), "discount")
})
check("service / delivery fees", () => {
  assert.equal(roleOf("ค่าบริการ 10%"), "service_charge")
  assert.equal(roleOf("Service Charge"), "service_charge")
  assert.equal(roleOf("ค่าจัดส่ง"), "delivery_fee")
  assert.equal(roleOf("Delivery Fee"), "delivery_fee")
})
check("points / count / metadata noise", () => {
  assert.equal(roleOf("คะแนนพิเศษเมื่อสมัครสมาชิกครั้งแรก"), "loyalty")
  assert.equal(roleOf("Items: 2"), "count")
  assert.equal(roleOf("Powered by FoodStory"), "noise")
  assert.equal(roleOf("TAX ID: 0105561207571"), "noise")
})

console.log("\n▶ Bulk re-classification of a whole receipt\n")

check("FoodStory receipt → only real items remain, discount routed", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0, extraction_issues: [],
    line_items: [
      { description: "ไอติมกะทิกาด หลวง เชียงใหม่", amount: 19 },
      { description: "ขนมปังเนยเยิ้มเชียงใหม่", amount: 49 },
      { description: "ส่วนลดสมาชิก", amount: 10 },
      { description: "Items: 2", amount: 68 },
      { description: "Cash", amount: 70 },
      { description: "Change", amount: 2 },
      { description: "คะแนนพิเศษเมื่อสมัครสมาชิกครั้งแรก", amount: 1 },
      { description: "ก่อนภาษี", amount: 68 },
    ],
  }
  reclassifyLineItems(doc)
  assert.equal(doc.line_items!.length, 2, "only the 2 products survive")
  assert.deepEqual(doc.line_items!.map(i => i.description),
    ["ไอติมกะทิกาด หลวง เชียงใหม่", "ขนมปังเนยเยิ้มเชียงใหม่"])
  assert.equal(doc.discount_amount, 10, "discount routed to its field")
})

check("existing discount field is NOT double-counted", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 15, delivery_fee: 0,
    line_items: [{ description: "ส่วนลด", amount: 15 }, { description: "ชาเย็น", amount: 30 }],
  }
  reclassifyLineItems(doc)
  assert.equal(doc.discount_amount, 15, "kept the LLM's field, not summed again")
  assert.equal(doc.line_items!.length, 1)
})

check("freebie (฿0) stays visible, not summed", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0,
    line_items: [{ description: "น้ำเปล่า (ของแถม)", amount: 0 }, { description: "กาแฟ", amount: 45 }],
  }
  reclassifyLineItems(doc)
  assert.equal(doc.line_items!.length, 2, "freebie is displayed")
})

console.log("\n▶ Subtotal boundary — drop unknown rows AFTER the totals\n")

check("unknown promo line after Subtotal is dropped, real items before it kept", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0,
    line_items: [
      { description: "ชาไทยเย็น", amount: 45 },
      { description: "ขนมปังปิ้ง", amount: 30 },
      { description: "Subtotal", amount: 75 },
      { description: "รับสิทธิ์พิเศษวันนี้เท่านั้น", amount: 60 }, // unknown footer, no keyword
    ],
  }
  reclassifyLineItems(doc)
  assert.deepEqual(doc.line_items!.map(i => i.description), ["ชาไทยเย็น", "ขนมปังปิ้ง"])
})

check("summary row emitted FIRST must NOT wipe the real items (regression)", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0,
    line_items: [
      { description: "Total", amount: 120 },   // model put the total first
      { description: "ผัดกะเพราไก่", amount: 60 },
      { description: "ข้าวไข่เจียว", amount: 60 },
    ],
  }
  reclassifyLineItems(doc)
  assert.deepEqual(doc.line_items!.map(i => i.description), ["ผัดกะเพราไก่", "ข้าวไข่เจียว"])
})

check("boundary never empties a non-empty item list", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0,
    line_items: [
      { description: "Subtotal", amount: 90 }, { description: "VAT", amount: 6 },
      { description: "ลาเต้", amount: 45 }, { description: "ครัวซองต์", amount: 45 },
    ],
  }
  reclassifyLineItems(doc)
  assert.equal(doc.line_items!.length, 2)
})

check("a genuine qty×price item AFTER the total is NOT dropped (escape hatch)", () => {
  const doc: ReclassifiableDoc = {
    discount_amount: 0, delivery_fee: 0,
    line_items: [
      { description: "Total", amount: 100 },
      { description: "น้ำเปล่าเพิ่ม", quantity: 2, unit_price: 10, amount: 20 },
    ],
  }
  reclassifyLineItems(doc)
  assert.equal(doc.line_items!.length, 1)
  assert.equal(doc.line_items![0].description, "น้ำเปล่าเพิ่ม")
})

console.log("\n▶ Learned overrides win over the static lexicon\n")

check("a learned label is reclassified per the override", () => {
  // "ค่าถุง" (bag fee) has no keyword → defaults to item; learning demotes it.
  assert.equal(classifyReceiptRow({ label: "ค่าถุง", amount: 2 }).role, "item")
  const overrides: LearnedOverrides = { [normalizeLabel("ค่าถุง")]: "noise" }
  assert.equal(classifyReceiptRow({ label: "ค่าถุง", amount: 2 }, overrides).role, "noise")
})

console.log("\n▶ Feedback loop — derive & aggregate corrections\n")

check("derive: user-removed rows → non_item, user-added rows → item", () => {
  const ai   = [{ description: "ลาเต้เย็น" }, { description: "ค่าถุง" }, { description: "โปรลด 10%" }]
  const user = [{ description: "ลาเต้เย็น" }, { description: "ครัวซองต์" }]
  const c = deriveRowRoleCorrections(ai, user)
  const byLabel = Object.fromEntries(c.map(x => [x.ai_value, x.corrected_value]))
  assert.equal(byLabel["ค่าถุง"], "non_item")
  assert.equal(byLabel["โปรลด 10%"], "non_item")
  assert.equal(byLabel["ครัวซองต์"], "item")
  assert.equal(byLabel["ลาเต้เย็น"], undefined) // unchanged → no correction
})

check("aggregate: a label needs ≥2 consistent corrections to be learned", () => {
  const once = aggregateLearnedOverrides([{ ai_value: "ค่าถุง", corrected_value: "non_item" }])
  assert.equal(Object.keys(once).length, 0, "one correction is not enough")

  const learned = aggregateLearnedOverrides([
    { ai_value: "ค่าถุง", corrected_value: "non_item" },
    { ai_value: "ค่าถุง", corrected_value: "non_item" },
  ])
  assert.equal(learned[normalizeLabel("ค่าถุง")], "noise")
})

check("aggregate: a single stray edit can't flip a dominant label", () => {
  const learned = aggregateLearnedOverrides([
    { ai_value: "เอสเพรสโซ่", corrected_value: "item" },
    { ai_value: "เอสเพรสโซ่", corrected_value: "item" },
    { ai_value: "เอสเพรสโซ่", corrected_value: "item" },
    { ai_value: "เอสเพรสโซ่", corrected_value: "non_item" }, // one stray
  ])
  assert.equal(learned[normalizeLabel("เอสเพรสโซ่")], "item")
})

console.log("\n▶ Parenthesised qualifiers must not hijack the row's role\n")

check("a real dish redeemed with points stays on the bill (KOFUKU regression)", () => {
  // "ทาโกะยากิ (แลกคะแนน)" — takoyaki paid for with loyalty points. The bare
  // /คะแนน/ pattern used to mark the whole row as a loyalty line, so a genuine
  // product silently vanished from the extracted items.
  const c = classifyReceiptRow({ label: "ทาโกะยากิ (แลกคะแนน)", amount: 0 })
  assert.notEqual(c.role, "loyalty")
  assert.ok(c.isDisplayable, "must still be shown as something the customer got")
})

check("other bracketed qualifiers are ignored too", () => {
  assert.ok(classifyReceiptRow({ label: "เกี้ยวทอด (ออร์เดิร์ฟ)", amount: 0 }).isDisplayable)
  assert.ok(classifyReceiptRow({ label: "น้ำเปล่า (ของแถม)", amount: 0 }).isDisplayable)
  assert.equal(classifyReceiptRow({ label: "ข้าวผัด (พิเศษ)", amount: 80 }).role, "item")
})

check("a keyword OUTSIDE the brackets still defines the row", () => {
  assert.equal(roleOf("คะแนนสะสม (Points)", 5), "loyalty")
  assert.equal(roleOf("ส่วนลด (สมาชิก)", 20), "discount")
  assert.equal(roleOf("Subtotal (ก่อนภาษี)", 75), "subtotal")
})

check("a row printed as ONLY a bracketed keyword is still classified", () => {
  // Stripping would leave nothing, so the full label has to be used.
  assert.equal(roleOf("(ส่วนลด)", 20), "discount")
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
