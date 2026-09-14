/**
 * Capture-geometry verification — run with:  npm run verify:capture
 *
 * Thai script is the first thing to die when a receipt reaches the model at too
 * few pixels, and nothing about that failure is visible in the output: the
 * amounts stay perfect while the words quietly turn into non-words. So the two
 * decisions that control resolution — when to slice a tall page, and when to
 * declare a capture too small to read — are pure functions with the real
 * production dimensions pinned as test cases.
 *
 * Every "measured" number below came from re-downloading the actual uploaded
 * file for that document id and running the real preprocessor over it.
 */
import assert from "node:assert/strict"
import {
  effectiveWidth, planSliceCount, MODEL_LONG_EDGE, MIN_EFFECTIVE_WIDTH,
} from "../pipeline/preprocessor"
import { isResolutionTooLow, MIN_SHORT_SIDE, isUnreadableCapture } from "../pipeline/image-quality"
import { getModelTier, PLAN_MODEL_TIER } from "../pipeline/model-tier"
import { containsThai } from "../pipeline/extractor"

let passed = 0, failed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}\n     ${(err as Error).message.split("\n")[0]}`) }
}

console.log("\n▶ Effective width — what the model actually receives\n")

check("a page taller than the long-edge cap loses width proportionally", () => {
  // The vision API rescales the LONG edge to MODEL_LONG_EDGE, so for a portrait
  // page the width the model sees is that cap ÷ aspect ratio. That single
  // identity is the whole reason Thai degrades on tall receipts.
  assert.equal(effectiveWidth(2000, 4000), Math.round(2000 * MODEL_LONG_EDGE / 4000))
})

check("a page under the raised cap is no longer rescaled at all", () => {
  // 1000×2000 lost 22% of its width under the 1568 ceiling (→784px). On
  // Sonnet 5's 2576 ceiling it is simply passed through. This is the shape of
  // the whole change: pages that used to arrive degraded now arrive intact.
  assert.ok(2000 < MODEL_LONG_EDGE, "premise: this page now fits under the cap")
  assert.equal(effectiveWidth(1000, 2000), 1000)
})

check("a page already under the cap is passed through untouched", () => {
  assert.equal(effectiveWidth(762, 800), 762)
  assert.equal(effectiveWidth(1200, 1500), 1200)
})

check("a landscape page is capped on its width", () => {
  assert.equal(effectiveWidth(3000, 1000), MODEL_LONG_EDGE)
})

check("degenerate input never divides by zero", () => {
  assert.equal(effectiveWidth(0, 0), 0)
  assert.equal(effectiveWidth(100, 0), 0)
})

console.log("\n▶ Slicing — driven by effective width, not a fixed aspect ratio\n")

check("Café Amazon 1387×2309 no longer needs slicing at all", () => {
  // doc 50d38945 — the receipt this whole slicing apparatus was built for. At
  // the 1568 ceiling it reached the model 942px wide and returned
  // "บริษัท เอิ่นดีมเบลลู 88 จำกัด" and "TW ครึ่งของต้มเบิ้ลซ้อกโกแลด AMZ", so
  // the fix was to cut it into pieces that each arrived wider.
  //
  // At 2576 the whole page fits: 2309 is under the cap, so it arrives at its
  // native 1387px in ONE image. The slicing did not get better — it became
  // unnecessary, which is cheaper (one image, not two) and strictly better
  // (no seam through a line of text).
  assert.equal(effectiveWidth(1387, 2309), 1387)
  assert.ok(effectiveWidth(1387, 2309) >= MIN_EFFECTIVE_WIDTH)
  assert.equal(planSliceCount(1387, 2309), 1)
})

check("Lotus's 1205×3866 stops slicing once slices arrive at native width", () => {
  // doc 20ff83e0. Under the 1568 ceiling this needed 4 slices to keep each
  // piece from being rescaled. Under 2576 two slices already clear it, and a
  // third would add an image and a seam for nothing.
  //
  // Note what slicing can and cannot do: this page is 1205px across, which is
  // below MIN_EFFECTIVE_WIDTH no matter how it is cut. Slicing recovers the
  // width the CAP took away; it cannot add pixels the camera never captured.
  // That is the resolution gate's job, not the slicer's.
  const count = planSliceCount(1205, 3866)
  assert.equal(count, 2)
  const stride = Math.floor(3866 / count)
  const tallestSlice = Math.ceil(stride * 1.24)   // middle slice: overlap both sides
  assert.equal(effectiveWidth(1205, tallestSlice), 1205, "every slice arrives at native width")
  assert.ok(1205 < MIN_EFFECTIVE_WIDTH, "and native is still under the floor — a capture problem")
})

check("CMD 2000×2276 is NOT sliced (measured 1378px — read correctly)", () => {
  assert.ok(effectiveWidth(2000, 2276) >= MIN_EFFECTIVE_WIDTH)
  assert.equal(planSliceCount(2000, 2276), 1)
})

check("7-Eleven 2000×2100 is NOT sliced (measured 1493px)", () => {
  assert.equal(planSliceCount(2000, 2100), 1)
})

check("slicing is never used to paper over a small original", () => {
  // doc 77b66503 was uploaded 762×800. It already arrives un-rescaled, so
  // cutting it up adds nothing and costs an extra image — the resolution gate
  // is what has to speak up here, not the slicer.
  assert.equal(planSliceCount(762, 800), 1)
})

check("a very long receipt gets as many slices as it needs, up to the cap", () => {
  assert.equal(planSliceCount(1200, 7000), 4)   // was 5 under the 1568 ceiling
  assert.ok(planSliceCount(1200, 100000) <= 5, "cap must hold")
})

check("slice counts are always at least 1", () => {
  for (const [w, h] of [[0, 0], [100, 0], [0, 100], [1, 1]]) {
    assert.ok(planSliceCount(w, h) >= 1, `${w}×${h}`)
  }
})

console.log("\n▶ Resolution gate — the check the docblock promised but never had\n")

check("both 7-Eleven captures that garbled are rejected as too small", () => {
  // 762×800 and 908×778 — under a megapixel. No OCR reads 7pt Thai from that,
  // and until now nothing anywhere said so: image-quality.ts measured the
  // ALREADY-UPSCALED 2000px page and had no size check at all.
  assert.equal(isResolutionTooLow(762, 800), true)
  assert.equal(isResolutionTooLow(908, 778), true)
})

check("captures with enough pixels are accepted", () => {
  assert.equal(isResolutionTooLow(1205, 3866), false)  // Lotus's — thermal, read well
  assert.equal(isResolutionTooLow(1387, 2309), false)  // Café Amazon — enough pixels, just badly sliced
})

check("CMD 1187×1351 is a known false positive, and a cheap one", () => {
  // Laser-printed A5 with large type, so it read perfectly at 1187px — 13px
  // under the floor. The floor is not lowered to accommodate it: the penalty
  // for tripping this flag is a prompt warning plus an escalation to the
  // stronger model, never a rejection, so a false positive costs a few satang.
  // The opposite error costs a document full of invented Thai. Lotus's still
  // returned one bad word at 1205px, which is the argument against going lower.
  assert.equal(isResolutionTooLow(1187, 1351), true)
})

check("the floor matches the on-device gate in ImageQualityChecker", () => {
  // ios/Slippy/Views/Documents/DocumentScannerView.swift ImageQuality.minShortSide
  assert.equal(MIN_SHORT_SIDE, 1200)
  assert.equal(isResolutionTooLow(MIN_SHORT_SIDE, MIN_SHORT_SIDE), false)
  assert.equal(isResolutionTooLow(MIN_SHORT_SIDE - 1, 5000), true)
})

check("unknown dimensions are not reported as a problem", () => {
  assert.equal(isResolutionTooLow(0, 0), false)
})

console.log("\n▶ Flagging a reading that may be an invention\n")

check("the fabricated Pet Republic receipt is flagged", () => {
  // A faded ฿210 pet-shop bill came back as a ฿1,765.50 cake shop: wrong vendor,
  // wrong items, wrong every number — and internally perfect arithmetic, so no
  // reconciliation check could ever catch it. Ink contrast 21 (floor 25) and
  // the model's own confidence 0.55 were the two facts that were true.
  //
  // This raises a flag on the document; it no longer refuses it. Blocking cost
  // 8 of ~34 uploads in one production session — including a pharmacy bill that
  // was fully legible and summed exactly to its printed total — because the
  // confidence input varies run to run on the same image.
  assert.equal(isUnreadableCapture({ degradedCapture: true, confidence: 0.55 }), true)
})

check("a degraded capture the model read WELL raises no flag", () => {
  // Same days, same kind of imperfect photo, confidence 0.78–0.80, read
  // correctly. Refusing these would make the gate worse than the disease.
  assert.equal(isUnreadableCapture({ degradedCapture: true, confidence: 0.80 }), false)
  assert.equal(isUnreadableCapture({ degradedCapture: true, confidence: 0.78 }), false)
})

check("a clean capture is never flagged, however cautious the model", () => {
  // Low confidence on a good photo is honesty about a hard receipt, not a
  // fabrication — the capture is there for a human to check against.
  assert.equal(isUnreadableCapture({ degradedCapture: false, confidence: 0.3 }), false)
  assert.equal(isUnreadableCapture({ degradedCapture: false, confidence: 0 }), false)
})

check("both conditions are required, neither alone", () => {
  assert.equal(isUnreadableCapture({ degradedCapture: false, confidence: 0.55 }), false)
  assert.equal(isUnreadableCapture({ degradedCapture: true, confidence: 0.61 }), false)
})

console.log("\n▶ Thai never reads on Haiku\n")

check("a Thai receipt is detected from the OCR pass's own text", () => {
  assert.equal(containsThai("สุกี้ บุฟเฟต์ ผู้ใหญ่ 657.00"), true)
  assert.equal(containsThai("ร้านลานนา"), true)
})

check("one Thai character is enough — the shop name is what identifies the expense", () => {
  // A bill with English items and a Thai shop name still fails where it matters.
  assert.equal(containsThai("ORSPACE คาเฟ่ / Grape Tea Smoothie 120.00"), true)
})

check("a purely English/numeric receipt still qualifies for the cheap model", () => {
  assert.equal(containsThai("Ramen Osaka\nTonkotsu Ramen DX 240.00\nGrand Total 685.00"), false)
  assert.equal(containsThai("7-ELEVEN 58.00"), false)
  assert.equal(containsThai(""), false)
})

console.log("\n▶ Plan → model tier routing\n")

check("paying plans get the model they are paying for", () => {
  // The bug this replaces: the pipeline selected a `plan_id` column that does
  // not exist, so every org — including the one on `business` — silently read
  // its receipts on Haiku.
  assert.equal(getModelTier("business"),   "priority")
  assert.equal(getModelTier("premium"),    "priority")
  assert.equal(getModelTier("enterprise"), "priority")
  assert.equal(getModelTier("pro"),        "smart")
  assert.equal(getModelTier("team"),       "smart")
})

check("free and starter are the only plans routed to the cheap tier", () => {
  assert.equal(getModelTier("free"),    "haiku")
  assert.equal(getModelTier("starter"), "haiku")
  const cheap = Object.entries(PLAN_MODEL_TIER).filter(([, t]) => t === "haiku").map(([p]) => p)
  assert.deepEqual(cheap.sort(), ["free", "starter"])
})

check("not knowing the plan does NOT downgrade the customer", () => {
  // A failed lookup means we don't know what they pay for, which is no reason
  // to hand them the weakest reader — that is precisely how the missing-column
  // bug stayed invisible for so long.
  assert.equal(getModelTier(undefined), "smart")
  assert.equal(getModelTier(null),      "smart")
  assert.equal(getModelTier(""),        "smart")
  assert.equal(getModelTier("plan_that_does_not_exist_yet"), "smart")
})

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
