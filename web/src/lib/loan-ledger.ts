/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { calcMonthlyPayment, buildAmortization, type AmortizationResult } from "./loan-amortization"

export interface LoanRecord {
  principal:      number
  annualRatePct:  number
  termMonths:     number
  startDate:      string // ISO date (YYYY-MM-DD)
}

export interface PaymentRecord {
  paymentDate: string // ISO date
  amount:      number
}

export interface LedgerMonth {
  month:            number
  monthLabel:       string // "YYYY-MM"
  scheduledPayment: number
  actualPaid:       number
  interest:         number
  principalPaid:    number
  extraPaid:        number
  balance:          number
  shortfall:        number // > 0 when actualPaid didn't cover the scheduled payment that month
}

export interface LedgerResult {
  months:              LedgerMonth[]
  currentBalance:      number
  totalPaid:           number
  totalInterestPaid:   number
  totalPrincipalPaid:  number
  monthsElapsed:        number
  isPaidOff:            boolean
  scheduledPayment:     number
  /** Balance the original (no-extra) schedule would show at this same point in time — for "ahead/behind schedule" comparison. */
  theoreticalBalanceNow: number
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

/**
 * Replays actual logged payments against the loan's rate, month by month,
 * to derive how much of each payment was interest vs principal — same
 * "ลดต้นลดดอก" logic as the what-if calculator, but driven by real payment
 * dates/amounts instead of an assumed schedule. If a month's payments don't
 * cover the scheduled interest, the shortfall is flagged rather than
 * silently amortized (no negative-amortization handling in v1).
 */
export function buildLedger(loan: LoanRecord, payments: PaymentRecord[], asOfDate: Date = new Date()): LedgerResult {
  const start = new Date(loan.startDate)
  const scheduledPayment = calcMonthlyPayment(loan.principal, loan.annualRatePct, loan.termMonths)
  const monthlyRate = loan.annualRatePct / 100 / 12
  const monthsElapsed = Math.max(0, Math.min(monthsBetween(start, asOfDate), loan.termMonths))

  const sorted = [...payments].sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())

  let balance = loan.principal
  const months: LedgerMonth[] = []
  let totalPaid = 0
  let totalInterestPaid = 0
  let totalPrincipalPaid = 0

  for (let m = 1; m <= monthsElapsed && balance > 0.01; m++) {
    const bucketStart = new Date(start.getFullYear(), start.getMonth() + m - 1, start.getDate())
    const bucketEnd   = new Date(start.getFullYear(), start.getMonth() + m, start.getDate())

    const actualPaid = sorted
      .filter(p => {
        const d = new Date(p.paymentDate)
        return d >= bucketStart && d < bucketEnd
      })
      .reduce((s, p) => s + p.amount, 0)

    const interest      = balance * monthlyRate
    const principalPaid = Math.min(Math.max(actualPaid - interest, 0), balance)
    const shortfall      = Math.max(scheduledPayment - actualPaid, 0)
    const extraPaid       = Math.max(actualPaid - scheduledPayment, 0)
    const interestCovered = Math.min(interest, actualPaid)

    balance -= principalPaid
    totalPaid          += actualPaid
    totalInterestPaid  += interestCovered
    totalPrincipalPaid += principalPaid

    months.push({
      month: m,
      monthLabel: `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}`,
      scheduledPayment, actualPaid, interest, principalPaid, extraPaid,
      balance: Math.max(balance, 0), shortfall,
    })
  }

  // What the balance would be right now under the original, no-extra schedule —
  // reuses the same amortization engine as the what-if calculator.
  const theoretical = buildAmortization({ principal: loan.principal, annualRatePct: loan.annualRatePct, termMonths: loan.termMonths })
  const theoreticalBalanceNow = theoretical.schedule[Math.min(monthsElapsed, theoretical.schedule.length) - 1]?.balance
    ?? loan.principal

  return {
    months,
    currentBalance: Math.max(balance, 0),
    totalPaid, totalInterestPaid, totalPrincipalPaid,
    monthsElapsed,
    isPaidOff: balance <= 0.01,
    scheduledPayment,
    theoreticalBalanceNow,
  }
}

export interface ProjectionResult {
  remainingMonths:     number
  projectedPayoffDate: string
  remainingInterest:   AmortizationResult["totalInterest"]
}

/**
 * Projects forward from the current actual balance under the loan's
 * original rate/no extra payments — "if you just keep paying the scheduled
 * amount from here, when do you finish and how much more interest?"
 */
export function projectRemaining(loan: LoanRecord, ledger: LedgerResult, asOfDate: Date = new Date()): ProjectionResult | null {
  const remainingTerm = loan.termMonths - ledger.monthsElapsed
  if (ledger.isPaidOff || remainingTerm <= 0 || ledger.currentBalance <= 0.01) return null

  const projection = buildAmortization({
    principal: ledger.currentBalance,
    annualRatePct: loan.annualRatePct,
    termMonths: remainingTerm,
  })

  const payoff = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + projection.monthsToPayoff, asOfDate.getDate())

  return {
    remainingMonths: projection.monthsToPayoff,
    projectedPayoffDate: payoff.toISOString().slice(0, 10),
    remainingInterest: projection.totalInterest,
  }
}
