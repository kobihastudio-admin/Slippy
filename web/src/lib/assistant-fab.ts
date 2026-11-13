// Where the floating Slippy Assistant button sits. It used to be pinned to the bottom-right corner, which covers the
// send button of the chat and the actions of other pages on a phone. The user can now drag it (it snaps to the left or
// right edge at the height where it was dropped) or hide it (a small tab stays on the edge to bring it back).
// Pure functions, so `src/lib/assistant-fab.test.mjs` can check them without a browser.

export type FabSide = "left" | "right"

export interface FabState {
  side: FabSide
  /** Distance from the bottom edge of the viewport to the bottom of the button, in px. */
  bottom: number
  hidden: boolean
}

export const FAB_SIZE = 56
/** Gap kept between the button and the screen edges. */
export const FAB_MARGIN = 16
/** Smallest allowed distance from the top / bottom edge while dragging. */
const EDGE = 8
export const FAB_STORAGE_KEY = "slippy.assistant.fab.v1"
/** Pointer movement (px) before a press counts as a drag instead of a tap. */
export const DRAG_THRESHOLD = 6

export const DEFAULT_FAB: FabState = { side: "right", bottom: FAB_MARGIN, hidden: false }

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

/** Keeps the button fully on screen vertically. */
export function clampBottom(bottom: number, viewportHeight: number, size: number = FAB_SIZE): number {
  const max = Math.max(EDGE, viewportHeight - size - EDGE)
  if (!finite(bottom)) return FAB_MARGIN
  return Math.min(Math.max(bottom, EDGE), max)
}

/** Which edge a button released at horizontal centre `centerX` snaps to. */
export function snapSide(centerX: number, viewportWidth: number): FabSide {
  return centerX < viewportWidth / 2 ? "left" : "right"
}

/**
 * The saved state for a button dropped with its top-left corner at (left, top): the nearest side and the height above
 * the bottom edge, clamped to the screen. `hidden` is kept from the previous state.
 */
export function stateAfterDrop(
  drop: { left: number; top: number },
  viewport: { width: number; height: number },
  hidden = false,
  size: number = FAB_SIZE,
): FabState {
  return {
    side: snapSide(drop.left + size / 2, viewport.width),
    bottom: clampBottom(viewport.height - drop.top - size, viewport.height, size),
    hidden,
  }
}

/** Reads what was stored; anything that is not a valid state gives the default (a broken value must never hide the button). */
export function parseFabState(raw: string | null | undefined, viewportHeight: number): FabState {
  if (!raw) return DEFAULT_FAB
  try {
    const value = JSON.parse(raw) as Partial<FabState> | null
    if (typeof value !== "object" || value === null) return DEFAULT_FAB
    return {
      side: value.side === "left" ? "left" : "right",
      bottom: clampBottom(finite(value.bottom) ? value.bottom : FAB_MARGIN, viewportHeight),
      hidden: value.hidden === true,
    }
  } catch {
    return DEFAULT_FAB
  }
}

export function serializeFabState(state: FabState): string {
  return JSON.stringify({ side: state.side, bottom: Math.round(state.bottom), hidden: state.hidden })
}

/** Whether a press that moved from `start` to `now` is a drag (not a tap). */
export function isDrag(start: { x: number; y: number }, now: { x: number; y: number }): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > DRAG_THRESHOLD
}

/** A click this soon after a drag ended belongs to the drag, not to a tap (some browsers send one after pointer-up). */
export const POST_DRAG_CLICK_MS = 350

/**
 * Whether a click at `now` should be ignored because a drag ended at `droppedAt` (both `performance.now()` values; null
 * when nothing was dragged). Time-based on purpose: a browser that sends no click after a drag must not leave the next
 * real tap swallowed.
 */
export function clickFollowsDrag(now: number, droppedAt: number | null): boolean {
  return droppedAt !== null && now - droppedAt >= 0 && now - droppedAt < POST_DRAG_CLICK_MS
}
