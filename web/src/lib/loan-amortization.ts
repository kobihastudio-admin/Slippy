/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * Thai mortgage/condo "ลดต้นลดดอก" amortization — interest each month is
 * charged on the outstanding principal balance, not the original loan
 * amount. Extra principal payments (โปะ) shrink that base for every
 * remaining month of the contract, which is why paying extra early in the
 * term saves far more interest than the same amount paid late.
 */

export interface LoanInput {
  principal:          number
  annualRatePct:      number
  termMonths:         number
  /** Extra principal paid every month, on top of the scheduled installment. */
  extraMonthly?:      number
  /** One-off extra principal payments, keyed by 1-indexed month number. */
  extraLumpSums?:     Record<number, number>
}

export interface AmortizationMonth {
  month:            number
  scheduledPayment: number
  interest:         number
  principalPaid:    number
  extraPaid:        number
  balance:          number
}

export interface AmortizationResult {
  schedule:         AmortizationMonth[]
  totalInterest:    number
  totalPaid:        number
  monthsToPayoff:   number
  monthlyPayment:   number
}

/** Standard fixed monthly installment for a fully-amortizing loan. */
export function calcMonthlyPayment(principal: number, annualRatePct: number, termMonths: number): number {
  const r = annualRatePct / 100 / 12
  if (r === 0) return principal / termMonths
  const factor = Math.pow(1 + r, termMonths)
  return (principal * r * factor) / (factor - 1)
}

/**
 * Runs the month-by-month schedule until the balance hits zero or the
 * contract term ends (whichever comes first — extra payments can finish
 * the loan early).
 */
export function buildAmortization(input: LoanInput): AmortizationResult {
  const { principal, annualRatePct, termMonths, extraMonthly = 0, extraLumpSums = {} } = input
  const monthlyPayment = calcMonthlyPayment(principal, annualRatePct, termMonths)
  const r = annualRatePct / 100 / 12

  let balance = principal
  const schedule: AmortizationMonth[] = []
  let totalInterest = 0
  let totalPaid = 0

  for (let month = 1; month <= termMonths && balance > 0.01; month++) {
    const interest = balance * r
    let principalPaid = Math.min(monthlyPayment - interest, balance)
    if (principalPaid < 0) principalPaid = 0 // guards against a misconfigured rate/term producing a negative amortization row

    let extraPaid = Math.min(extraMonthly + (extraLumpSums[month] ?? 0), balance - principalPaid)
    if (extraPaid < 0) extraPaid = 0

    balance = balance - principalPaid - extraPaid
    totalInterest += interest
    totalPaid += interest + principalPaid + extraPaid

    schedule.push({
      month,
      scheduledPayment: interest + principalPaid,
      interest,
      principalPaid,
      extraPaid,
      balance: Math.max(balance, 0),
    })
  }

  return {
    schedule,
    totalInterest,
    totalPaid,
    monthsToPayoff: schedule.length,
    monthlyPayment,
  }
}

export interface ScenarioComparison {
  baseline: AmortizationResult
  withExtra: AmortizationResult
  interestSaved: number
  monthsSaved: number
}

export function compareScenarios(input: LoanInput): ScenarioComparison {
  const baseline = buildAmortization({ ...input, extraMonthly: 0, extraLumpSums: {} })
  const withExtra = buildAmortization(input)
  return {
    baseline,
    withExtra,
    interestSaved: baseline.totalInterest - withExtra.totalInterest,
    monthsSaved:   baseline.monthsToPayoff - withExtra.monthsToPayoff,
  }
}
