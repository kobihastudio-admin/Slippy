/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Shared split-resolution logic for the multi-payer trip expense system
 * (life_journeys / trip_expenses / expense_splits — see migrations 030, 060).
 * Used by both the dashboard API (web/src/app/api/trips/[id]/expenses) and the
 * LIFF API (web/src/app/api/liff/trips/[id]/expenses) so the math behind
 * "who owes what for this one expense" only lives in one place.
 *
 * Each `trip_expenses` row has its own payer (paid_by_id) and its own split
 * method — a trip with 5 expenses can have 5 different payers and 5
 * different ways of dividing each one. The *settlement* (who ultimately owes
 * whom, net, across the whole trip) is computed separately by the
 * `calculate_trip_settlement` SQL function once all expenses are saved.
 */

export type SplitMode = "equal" | "individual" | "percent" | "shares" | "exclude"

export interface ResolveSplitsInput {
  totalAmount:    number
  participantIds: string[]                  // who's included in this expense
  splitMode:      SplitMode
  splitValues:    Record<string, number>     // raw per-person input — meaning depends on splitMode
}

export interface ResolvedSplit {
  participantId: string
  amount:        number
}

const ROUND_TOLERANCE = 0.5 // baht — rounding slop allowed when validating user-entered totals

/** Rounds to 2dp and nudges the last entry so the sum exactly equals `total` (avoids ฿0.01 drift). */
function distributeWithRoundingFix(amounts: number[], total: number): number[] {
  const rounded = amounts.map(a => Math.round(a * 100) / 100)
  const sum = rounded.reduce((s, a) => s + a, 0)
  const drift = Math.round((total - sum) * 100) / 100
  if (drift !== 0 && rounded.length > 0) {
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 100) / 100
  }
  return rounded
}

/**
 * Resolves one expense's split_mode + raw input into a concrete per-person
 * amount for every included participant. Throws a Thai-language error
 * message (safe to surface directly to the user) when the input is
 * inconsistent — e.g. percentages that don't add up to 100.
 */
export function resolveExpenseSplits(input: ResolveSplitsInput): ResolvedSplit[] {
  const { totalAmount, participantIds, splitMode, splitValues } = input
  if (!participantIds.length) throw new Error("ต้องเลือกคนที่ร่วมจ่ายอย่างน้อย 1 คน")
  if (totalAmount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0")

  if (splitMode === "equal" || splitMode === "exclude") {
    const each = totalAmount / participantIds.length
    const amounts = distributeWithRoundingFix(participantIds.map(() => each), totalAmount)
    return participantIds.map((id, i) => ({ participantId: id, amount: amounts[i] }))
  }

  if (splitMode === "individual") {
    const amounts = participantIds.map(id => {
      const v = splitValues[id]
      if (v == null) throw new Error(`ยังไม่ได้ระบุจำนวนเงินของบางคน`)
      return Number(v)
    })
    const sum = amounts.reduce((s, a) => s + a, 0)
    if (Math.abs(sum - totalAmount) > ROUND_TOLERANCE) {
      throw new Error(`ยอดที่ระบุรวมกัน (${sum.toFixed(2)}) ไม่ตรงกับยอดรวม (${totalAmount.toFixed(2)})`)
    }
    const fixed = distributeWithRoundingFix(amounts, totalAmount)
    return participantIds.map((id, i) => ({ participantId: id, amount: fixed[i] }))
  }

  if (splitMode === "percent") {
    const pcts = participantIds.map(id => {
      const v = splitValues[id]
      if (v == null) throw new Error(`ยังไม่ได้ระบุเปอร์เซ็นต์ของบางคน`)
      return Number(v)
    })
    const sumPct = pcts.reduce((s, p) => s + p, 0)
    if (Math.abs(sumPct - 100) > 0.5) {
      throw new Error(`เปอร์เซ็นต์รวมกันต้องเท่ากับ 100 (ตอนนี้รวมได้ ${sumPct}%)`)
    }
    const amounts = distributeWithRoundingFix(pcts.map(p => totalAmount * (p / 100)), totalAmount)
    return participantIds.map((id, i) => ({ participantId: id, amount: amounts[i] }))
  }

  if (splitMode === "shares") {
    const shares = participantIds.map(id => {
      const v = splitValues[id]
      if (v == null || Number(v) <= 0) throw new Error(`ยังไม่ได้ระบุจำนวนหุ้นของบางคน`)
      return Number(v)
    })
    const totalShares = shares.reduce((s, v) => s + v, 0)
    const amounts = distributeWithRoundingFix(shares.map(s => totalAmount * (s / totalShares)), totalAmount)
    return participantIds.map((id, i) => ({ participantId: id, amount: amounts[i] }))
  }

  throw new Error(`split_mode ไม่รู้จัก: ${splitMode}`)
}

/**
 * Recomputes `trip_participants.amount_owed`/`amount_paid` for every
 * participant in a trip from the current `expense_splits` rows. Called after
 * any expense add/edit/delete so the trip-level totals (and the dashboard's
 * stat cards) stay in sync — the settlement RPC reads expense_splits/
 * trip_expenses directly so it doesn't depend on this, but the per-person
 * totals shown elsewhere do.
 */
export async function recalculateTripOwed(
  tripId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<void> {
  const { data: splits } = await admin.from("expense_splits")
    .select("participant_id, amount, is_paid, trip_expenses!inner(journey_id, paid_by_id)")
    .eq("trip_expenses.journey_id", tripId)

  if (!splits) return

  const owed: Record<string, number> = {}
  const paid: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of splits as any[]) {
    const pid = s.participant_id
    owed[pid] = (owed[pid] ?? 0) + Number(s.amount)
    if (s.is_paid) paid[pid] = (paid[pid] ?? 0) + Number(s.amount)
  }

  for (const [pid, amt] of Object.entries(owed)) {
    await admin.from("trip_participants").update({
      amount_owed: amt,
      amount_paid: paid[pid] ?? 0,
    }).eq("id", pid)
  }
}

export interface CreateExpenseInput {
  tripId:        string
  paidById:      string
  title:         string
  amount:        number
  category?:     string
  splitMode?:    SplitMode
  splitWith?:    string[]
  splitValues?:  Record<string, number>
  documentId?:   string
  note?:         string
  expenseDate?:  string
  /** Currency the expense was actually entered in — defaults to the trip's
   * base_currency (see migration 073). */
  currency?:       string
  /** Manual exchange-rate override (1 unit of `currency` = this many units
   * of the trip's base_currency) — e.g. the rate a card was actually
   * charged at. When omitted, resolved automatically from expenseDate via
   * getExchangeRate(). */
  exchangeRate?:   number
}

/**
 * Creates one trip_expenses row + its expense_splits, and recalculates
 * per-participant totals — the single place this happens, so a manually
 * added expense (api/trips/[id]/expenses) and an auto-generated recurring
 * one (api/trips/recurring/run) are computed identically. Throws the same
 * Thai-language validation errors as resolveExpenseSplits.
 *
 * Split math always operates on the trip's base_currency amount
 * (amount_base_currency) — a JPY expense in a THB-base trip is converted
 * BEFORE resolveExpenseSplits runs, so expense_splits/trip_participants/
 * calculate_trip_settlement stay single-currency and unchanged by this.
 */
export async function createTripExpense(
  input: CreateExpenseInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<string> {
  const { data: trip } = await admin.from("life_journeys")
    .select("split_mode, base_currency").eq("id", input.tripId).single()

  const { data: participants } = await admin.from("trip_participants")
    .select("id").eq("journey_id", input.tripId)

  if (!participants?.length) throw new Error("No participants")

  const splitMode = input.splitMode ?? (trip?.split_mode as SplitMode) ?? "equal"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const splitWith = input.splitWith?.length ? input.splitWith : participants.map((p: any) => p.id)

  const baseCurrency = (trip?.base_currency as string) ?? "THB"
  const currency     = input.currency ?? baseCurrency
  const expenseDate  = input.expenseDate ?? new Date().toISOString().slice(0, 10)

  let exchangeRate: number
  let rateIsManual = false
  if (input.exchangeRate != null) {
    exchangeRate = Number(input.exchangeRate)
    rateIsManual = true
  } else if (currency === baseCurrency) {
    exchangeRate = 1
  } else {
    const { getExchangeRate } = await import("@/lib/exchange-rates")
    exchangeRate = await getExchangeRate(expenseDate, currency, baseCurrency, admin)
  }

  const amountBase = Math.round(Number(input.amount) * exchangeRate * 100) / 100

  const resolved = resolveExpenseSplits({
    totalAmount: amountBase,
    participantIds: splitWith,
    splitMode,
    splitValues: input.splitValues ?? {},
  })

  const { data: expense, error } = await admin.from("trip_expenses").insert({
    journey_id:   input.tripId,
    document_id:  input.documentId ?? null,
    paid_by_id:   input.paidById,
    currency,
    exchange_rate: exchangeRate,
    amount_base_currency: amountBase,
    rate_is_manual: rateIsManual,
    title:        input.title,
    amount:       input.amount,
    category:     input.category ?? "other",
    split_mode:   splitMode,
    split_with:   splitWith,
    split_values: input.splitValues ?? {},
    note:         input.note ?? null,
    expense_date: expenseDate,
  }).select("id").single()

  if (error || !expense) throw new Error(error?.message ?? "สร้างรายจ่ายไม่สำเร็จ")

  await admin.from("expense_splits").insert(
    resolved.map(r => ({
      expense_id:     expense.id,
      participant_id: r.participantId,
      amount:         r.amount,
      is_paid:        r.participantId === input.paidById,
    }))
  )

  await recalculateTripOwed(input.tripId, admin)

  return expense.id as string
}
