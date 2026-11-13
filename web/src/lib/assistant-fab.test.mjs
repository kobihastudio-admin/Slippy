// Run: cd web && node --experimental-strip-types --test src/lib/assistant-fab.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_FAB, DRAG_THRESHOLD, FAB_MARGIN, FAB_SIZE,
  POST_DRAG_CLICK_MS, clampBottom, clickFollowsDrag, isDrag, parseFabState, serializeFabState, snapSide, stateAfterDrop,
} from "./assistant-fab.ts"

const VIEW = { width: 390, height: 800 }

test("the default is the old corner, shown", () => {
  assert.deepEqual(DEFAULT_FAB, { side: "right", bottom: FAB_MARGIN, hidden: false })
})

test("clampBottom keeps the whole button on screen", () => {
  assert.equal(clampBottom(-50, 800), 8)
  assert.equal(clampBottom(0, 800), 8)
  assert.equal(clampBottom(300, 800), 300)
  assert.equal(clampBottom(5000, 800), 800 - FAB_SIZE - 8)
  assert.equal(clampBottom(Number.NaN, 800), FAB_MARGIN, "NaN falls back to the margin")
  assert.equal(clampBottom(100, 40), 8, "a tiny viewport never gives a negative bound")
})

test("snapSide picks the nearer edge by the button centre", () => {
  assert.equal(snapSide(10, 390), "left")
  assert.equal(snapSide(194, 390), "left")
  assert.equal(snapSide(195, 390), "right")
  assert.equal(snapSide(380, 390), "right")
})

test("stateAfterDrop: dropped near the left, mid height", () => {
  const s = stateAfterDrop({ left: 20, top: 400 }, VIEW)
  assert.deepEqual(s, { side: "left", bottom: 800 - 400 - FAB_SIZE, hidden: false })
})

test("stateAfterDrop: dropped off the top, off the right, below the bottom is pulled back on screen", () => {
  assert.equal(stateAfterDrop({ left: 500, top: -100 }, VIEW).side, "right")
  assert.equal(stateAfterDrop({ left: 500, top: -100 }, VIEW).bottom, 800 - FAB_SIZE - 8)
  assert.equal(stateAfterDrop({ left: 100, top: 2000 }, VIEW).bottom, 8)
})

test("stateAfterDrop keeps the hidden flag it is given", () => {
  assert.equal(stateAfterDrop({ left: 0, top: 0 }, VIEW, true).hidden, true)
})

test("parseFabState: valid, clamped, and tolerant of garbage", () => {
  const stored = serializeFabState({ side: "left", bottom: 250.4, hidden: true })
  assert.deepEqual(parseFabState(stored, 800), { side: "left", bottom: 250, hidden: true })
  assert.deepEqual(parseFabState(JSON.stringify({ side: "right", bottom: 9999 }), 800), { side: "right", bottom: 800 - FAB_SIZE - 8, hidden: false })
  for (const bad of [null, undefined, "", "not json", "null", "42", "[]", "{", JSON.stringify({ side: "up", bottom: "x", hidden: "yes" })]) {
    const s = parseFabState(bad, 800)
    assert.ok(s.side === "left" || s.side === "right", `side for ${bad}`)
    assert.ok(Number.isFinite(s.bottom) && s.bottom >= 8, `bottom for ${bad}`)
    assert.equal(s.hidden, false, `a broken value never hides the button: ${bad}`)
  }
})

test("a saved height that no longer fits (rotated phone) is pulled back on screen", () => {
  assert.equal(parseFabState(serializeFabState({ side: "right", bottom: 700, hidden: false }), 360).bottom, 360 - FAB_SIZE - 8)
})

test("isDrag: a tap with a little jitter is not a drag", () => {
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 }), false)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: DRAG_THRESHOLD, y: 0 }), false)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: DRAG_THRESHOLD + 1, y: 0 }), true)
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 10, y: 40 }), true)
})

test("clickFollowsDrag ignores only the click right after a drop, never a later tap", () => {
  assert.equal(clickFollowsDrag(1000, null), false, "nothing was dragged")
  assert.equal(clickFollowsDrag(1000, 990), true, "the click that follows pointer-up")
  assert.equal(clickFollowsDrag(1000 + POST_DRAG_CLICK_MS - 1, 1000), true)
  assert.equal(clickFollowsDrag(1000 + POST_DRAG_CLICK_MS, 1000), false, "a real tap after the window")
  assert.equal(clickFollowsDrag(5000, 1000), false, "a tap seconds later opens the window")
  assert.equal(clickFollowsDrag(900, 1000), false, "a clock that went backwards never blocks")
})
