/**
 * Recalculating a receipt's totals after a line item is edited.
 *
 * WHY THIS FILE EXISTS
 * The review screen used to do it in four lines:
 *
 *     subtotal = Σ line items
 *     vatRate  = vat_amount / subtotal
 *     vat      = subtotal × vatRate
 *     total    = subtotal + vat − discount + fee − wht
 *
 * Two assumptions are baked in there, and Thai receipts break both.
 *
 *   1. That the line items measure the SUBTOTAL. On a VAT-included receipt the
 *      printed item prices already carry the tax, so they sum to the TOTAL.
 *   2. That the total is always subtotal PLUS vat. On a VAT-included receipt
 *      the VAT is carved out of the total, not added to it.
 *
 * A real Jones Salad bill (doc a3d41d8c, 22 Aug 2026) hit both at once. The
 * pipeline read the paper perfectly — subtotal 800, VAT 56, GRAND TOTAL 856,
 * matching the printed "Tax Summary: Taxable 800.00 / Tax 56.00" — and the
 * items summed to 856, because they are printed gross. One touch in the review
 * screen turned that into:
 *
 *     subtotal = 856          ← the gross item sum written into the net field
 *     vatRate  = 56 / 800     = 0.07
 *     vat      = 856 × 0.07   = 59.92   ← VAT charged on a base that had it already
 *     total    = 856 + 59.92  = 915.92  ← ฿59.92 more than was actually paid
 *
 * Nothing caught it. 856 + 59.92 = 915.92 is internally consistent, so the
 * reconciler recorded "balanced". That is the recurring failure here: a wrong
 * number that agrees with itself passes every arithmetic check, because the
 * checks test consistency and a fabrication is consistent with itself. The only
 * defence is to carry the document's own conventions forward instead of
 * re-deriving them from figures that have already been overwritten.
 *
 * So both conventions are read ONCE from the document as it loaded — see
 * `readAmountShape` — and every later edit is interpreted through them.
 * Renaming a dish is not evidence that the receipt changed how it prints tax.
 *
 * This is the browser-side twin of api/src/pipeline/amounts.ts, which resolves
 * the same inclusive/exclusive question by the same nearest-match rule.
 */

export const VAT_RATE = 0.07

/** How the total relates to the base: VAT added on top, carved out, or absent. */
export type VatConvention = "exclusive" | "inclusive" | "none"

/** Which figure the line-item amounts add up to on this receipt. */
export type ItemsMeasure = "subtotal" | "total"

export interface AmountShape {
  vat: VatConvention
  items: ItemsMeasure
}

export interface AmountForm {
  subtotal?: number | null
  vat_amount?: number | null
  total_amount?: number | null
  discount_amount?: number | null
  delivery_fee?: number | null
  wht_amount?: number | null
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** delivery fee − discount − withholding: the part that is convention-neutral. */
const tailOf = (f: AmountForm): number =>
  n(f.delivery_fee) - n(f.discount_amount) - n(f.wht_amount)

/**
 * Read both conventions off the document as it currently stands.
 *
 * Call this ONCE, on the figures as loaded from the server, and hold the result
 * for the lifetime of the edit session. Re-deriving it after an edit would read
 * the conventions off numbers this module just wrote, which is how a single
 * wrong recalculation becomes permanent.
 *
 * Both questions are settled by asking which reading the document's own printed
 * total is closer to — the total is the figure a customer actually paid, so it
 * is the best witness to how the rest was meant to add up.
 */
export function readAmountShape(f: AmountForm, itemSum: number): AmountShape {
  const subtotal = n(f.subtotal)
  const vat      = n(f.vat_amount)
  const total    = n(f.total_amount)
  const tail     = tailOf(f)

  // ── VAT convention ──
  // "inclusive" means total ≈ subtotal (+tail); "exclusive" means the VAT is
  // added on the way to the total. When there is no usable total to compare
  // against, fall back to testing the VAT figure itself against 7% and 7/107 of
  // the base — the server's `vatModel` rule.
  let vatConvention: VatConvention
  if (vat <= 0) {
    vatConvention = "none"
  } else if (total > 0) {
    const asInclusive = Math.abs(total - (subtotal + tail))
    const asExclusive = Math.abs(total - (subtotal + vat + tail))
    vatConvention = asInclusive < asExclusive ? "inclusive" : "exclusive"
  } else {
    const base = Math.max(0, subtotal + n(f.delivery_fee) - n(f.discount_amount))
    const asInclusive = Math.abs(vat - base * VAT_RATE / (1 + VAT_RATE))
    const asExclusive = Math.abs(vat - base * VAT_RATE)
    vatConvention = asInclusive < asExclusive ? "inclusive" : "exclusive"
  }

  // ── What the items measure ──
  // Ties go to "subtotal": that is the ordinary layout, and on a VAT-included
  // receipt subtotal and total are equal anyway, so a tie costs nothing.
  const items: ItemsMeasure =
    itemSum > 0 && total > 0 && Math.abs(itemSum - total) < Math.abs(itemSum - subtotal)
      ? "total"
      : "subtotal"

  return { vat: vatConvention, items }
}

/**
 * Recompute subtotal, VAT and total from a new line-item sum, holding `shape`.
 *
 * The tail (fee/discount/WHT) is taken from `f` unchanged — those are typed by
 * hand, never derived from the items.
 */
export function recalcTotals(
  f: AmountForm,
  itemSum: number,
  shape: AmountShape,
): { subtotal: number; vat_amount: number; total_amount: number } {
  const sum  = +itemSum.toFixed(2)
  const tail = tailOf(f)
  const r2   = (v: number) => +v.toFixed(2)

  if (shape.items === "total") {
    // The items are printed gross, so their sum IS the money charged. Work
    // backwards to the base rather than forwards from it.
    const total = r2(sum)
    const net   = total - tail
    if (shape.vat === "none")      return { subtotal: r2(net), vat_amount: 0, total_amount: total }
    if (shape.vat === "inclusive") {
      const vat = r2(net * VAT_RATE / (1 + VAT_RATE))
      return { subtotal: r2(net), vat_amount: vat, total_amount: total }
    }
    // Exclusive: net = subtotal + vat, and vat = subtotal × 7%.
    const subtotal = r2(net / (1 + VAT_RATE))
    return { subtotal, vat_amount: r2(net - subtotal), total_amount: total }
  }

  // The items measure the subtotal — the ordinary case.
  if (shape.vat === "none")      return { subtotal: sum, vat_amount: 0, total_amount: r2(sum + tail) }
  if (shape.vat === "inclusive") {
    const vat = r2(sum * VAT_RATE / (1 + VAT_RATE))
    return { subtotal: sum, vat_amount: vat, total_amount: r2(sum + tail) }
  }
  const vat = r2(sum * VAT_RATE)
  return { subtotal: sum, vat_amount: vat, total_amount: r2(sum + vat + tail) }
}
