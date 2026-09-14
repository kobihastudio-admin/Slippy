/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * The one place that decides what the numbers on a receipt mean.
 *
 * Everything about money on a Thai document reduces to a handful of relations,
 * printed under several conventions. The conventions are the hard part, and
 * for a long time the knowledge of them was scattered: `reconcileAmounts` held
 * fifteen separate copies of the arithmetic, the validator had its own, and the
 * training-corpus gate a third. Each learned conventions independently, which
 * meant each learned them at a different time — and the gaps between were
 * bugs that silently rewrote correct money:
 *
 *   • A ฿1,039 restaurant bill became ฿1,012.97 because the VAT base here
 *     excluded the 10% service charge (doc 37c7f466).
 *   • The same bill, once the extractor was fixed, was then flagged
 *     TOTAL_MISMATCH because the VALIDATOR's base still excluded it.
 *   • A ฿58 7-Eleven slip became ฿109 because the cash tendered was read as a
 *     subtotal and nothing checked the tender line (doc 67156d80).
 *
 * So the rule is now: nothing outside this module derives a monetary
 * relationship. Callers ask; they do not compute. A new convention is one
 * branch here plus one test, not an archaeology expedition through three files.
 */

export const VAT_RATE = 0.07

export interface AmountFields {
  subtotal?:        number
  discount_amount?: number
  delivery_fee?:    number
  vat_amount?:      number
  wht_amount?:      number
  total_amount?:    number
  /** Cash tendered / card charged, from the receipt's payment line. */
  paid_amount?:     number
  line_items?:      Array<{ amount?: unknown }>
}

/**
 * Model-authored JSON types amounts however the receipt printed them, so
 * "1,039.00" is an ordinary answer. Every read goes through here: a raw string
 * survives a `<= 0` guard and then turns each later comparison into NaN, which
 * is how the tender-line safeguard shipped switched permanently off.
 */
export function num(value: unknown): number {
  const n = Number(String(value ?? 0).replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * The figure VAT is charged on and the total is built from:
 * line-item subtotal, plus service charge / delivery fee, minus discount.
 */
export function amountBase(d: AmountFields): number {
  return Math.max(0, num(d.subtotal) + num(d.delivery_fee) - num(d.discount_amount))
}

export type VatConvention = "exclusive" | "inclusive" | "unresolved"

export interface VatModel {
  base: number
  /** VAT added on top of the base. */
  exclusive: number
  /** VAT already embedded within the base. */
  inclusive: number
  /** Which one the document's own VAT figure actually matches. */
  convention: VatConvention
  /** The expected VAT under the resolved convention (0 when unresolved). */
  expected: number
}

/**
 * Resolves which VAT convention a document uses.
 *
 * The tolerance is a share of the VAT, never of the base. VAT is ~7% of the
 * base, so an allowance of 2% of the base is permanently ~29% of the VAT — on
 * a ฿100 base that accepted anything from ฿5 to ฿9 as "a 7% figure", which is
 * how a misread ฿9 was treated as proof and a correct ฿58 total was rewritten.
 */
export function vatModel(d: AmountFields, relTolerance = 0.05, floor = 0.5): VatModel {
  const base      = amountBase(d)
  const vat       = num(d.vat_amount)
  const exclusive = +(base * VAT_RATE).toFixed(2)
  const inclusive = +(base * VAT_RATE / (1 + VAT_RATE)).toFixed(2)

  if (base <= 0 || vat <= 0) {
    return { base, exclusive, inclusive, convention: "unresolved", expected: 0 }
  }

  const dExc = Math.abs(vat - exclusive)
  const dInc = Math.abs(vat - inclusive)
  const nearest = dInc <= dExc ? inclusive : exclusive
  const tolerance = Math.max(floor, nearest * relTolerance)

  if (Math.min(dExc, dInc) > tolerance) {
    // The VAT is not a 7% figure of this base under either reading. Saying so
    // is the point: forcing it into the nearest convention is what produced a
    // confidently wrong total.
    return { base, exclusive, inclusive, convention: "unresolved", expected: 0 }
  }

  return {
    base, exclusive, inclusive,
    convention: dInc <= dExc ? "inclusive" : "exclusive",
    expected:   nearest,
  }
}

/**
 * The total implied by the amounts, under the resolved VAT convention.
 * Null when the convention could not be resolved — there is then no defensible
 * expectation to compare a printed total against.
 */
export function expectedTotal(d: AmountFields): number | null {
  const vat = vatModel(d)
  const tail = num(d.delivery_fee) - num(d.discount_amount) - num(d.wht_amount)
  if (vat.convention === "inclusive") return +(num(d.subtotal) + tail).toFixed(2)
  if (vat.convention === "exclusive") return +(num(d.subtotal) + num(d.vat_amount) + tail).toFixed(2)
  if (num(d.vat_amount) === 0)        return +(num(d.subtotal) + tail).toFixed(2)
  return null
}

export type SumConvention = "gross" | "net" | "vat_inclusive"

export interface LineItemSumCheck {
  sum: number
  /** The target the items came closest to — what to report as "expected". */
  expected: number
  convention: SumConvention
  mismatch: boolean
}

/** ฿2 or 2% of the subtotal, whichever is larger — protects small receipts. */
const LINE_ITEM_TOLERANCE_ABS = 2
const LINE_ITEM_TOLERANCE_PCT = 0.02

/**
 * Whether the line items add up, under any of the three conventions shops use:
 *
 *   gross — discount is its own line, items are list prices summing to subtotal
 *   net   — discount is deducted per line, so items sum to subtotal − discount
 *   incl  — shelf prices contain VAT and the foot breaks it out, so items sum
 *           to subtotal + VAT (7-Eleven: 80.37 + 5.63 = 86.00)
 *
 * Testing only `gross` declared correct receipts broken twice over and burned a
 * DocAI retry on each. Returns null when there is nothing to compare.
 */
export function lineItemSumCheck(d: AmountFields): LineItemSumCheck | null {
  const items = Array.isArray(d.line_items) ? d.line_items : []
  const subtotal = num(d.subtotal)
  if (!items.length || subtotal === 0) return null

  const sum = items.reduce((s, i) => s + num(i.amount), 0)
  const tolerance = Math.max(LINE_ITEM_TOLERANCE_ABS, subtotal * LINE_ITEM_TOLERANCE_PCT)

  const candidates: Array<{ convention: SumConvention; expected: number }> = [
    { convention: "gross",         expected: subtotal },
    { convention: "net",           expected: subtotal - num(d.discount_amount) },
    { convention: "vat_inclusive", expected: subtotal + num(d.vat_amount) },
  ]
  const best = candidates.reduce((a, b) =>
    Math.abs(sum - b.expected) < Math.abs(sum - a.expected) ? b : a
  )

  return {
    sum:        +sum.toFixed(2),
    expected:   +best.expected.toFixed(2),
    convention: best.convention,
    mismatch:   Math.abs(sum - best.expected) > tolerance,
  }
}

export interface TotalEvidence {
  /** The receipt's own tender line agrees with the printed total. */
  paidConfirmsTotal: boolean
  /** Line items add up to the printed total. */
  itemsBackTotal: boolean
  /** Line items add up to the printed subtotal. */
  itemsBackSubtotal: boolean
  /**
   * Items vouch for the total AND contradict the subtotal — so the subtotal is
   * the misread figure and the total must not be recomputed from it.
   */
  totalOutranksSubtotal: boolean
}

/**
 * What independently corroborates the printed total.
 *
 * Both live wrong-total bugs had confirmation sitting on the paper while the
 * total was rewritten anyway: a "เงินสด 100" cash line, and an "M/C 1,039.00"
 * card line. A figure a machine had to agree with outranks arithmetic
 * assembled from figures that may themselves be misread.
 */
export function totalEvidence(d: AmountFields): TotalEvidence {
  const total    = num(d.total_amount)
  const subtotal = num(d.subtotal)
  const paid     = num(d.paid_amount)
  const items    = Array.isArray(d.line_items) ? d.line_items : []
  const lineSum  = +items.reduce((s, i) => s + num(i.amount), 0).toFixed(2)

  const paidConfirmsTotal = paid > 0 && total > 0
    && Math.abs(paid - total) <= Math.max(0.5, total * 0.005)

  const itemsBackTotal = items.length > 0 && total > 0
    && Math.abs(lineSum - total) <= Math.max(1, total * 0.02)
  const itemsBackSubtotal = items.length > 0 && subtotal > 0
    && Math.abs(lineSum - subtotal) <= Math.max(1, subtotal * 0.02)

  return {
    paidConfirmsTotal,
    itemsBackTotal,
    itemsBackSubtotal,
    totalOutranksSubtotal: itemsBackTotal && !itemsBackSubtotal,
  }
}


