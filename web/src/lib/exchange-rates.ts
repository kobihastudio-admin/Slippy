/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Historical FX rate lookup for multi-currency trip expenses — resolves
 * "1 unit of `from` = how many units of `to`, as of `date`", backed by a
 * Postgres cache (exchange_rates, see migration 073) so the same date+pair
 * is never re-fetched from the external API twice.
 *
 * Uses Frankfurter (frankfurter.dev) — free, keyless, ECB reference rates
 * going back to 1999. Good enough for expense-splitting purposes; not
 * intended for anything requiring bank-grade FX precision.
 */

const FRANKFURTER_BASE = "https://api.frankfurter.dev/v1"

/** Common currencies for the trip-currency picker UI — Frankfurter supports
 * more, but these cover the vast majority of trips Thai users take. */
export const COMMON_CURRENCIES = [
  "THB", "USD", "EUR", "GBP", "JPY", "SGD", "MYR", "KRW", "CNY", "VND", "HKD", "AUD",
] as const

export async function getExchangeRate(
  dateStr:  string,   // YYYY-MM-DD — the expense's own date, not "today"
  from:     string,
  to:       string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin:    any,
): Promise<number> {
  const fromCcy = from.toUpperCase()
  const toCcy   = to.toUpperCase()
  if (fromCcy === toCcy) return 1

  const { data: cached } = await admin
    .from("exchange_rates")
    .select("rate")
    .eq("rate_date", dateStr)
    .eq("from_currency", fromCcy)
    .eq("to_currency", toCcy)
    .maybeSingle()

  if (cached) return Number(cached.rate)

  // Frankfurter only has rates for days the ECB actually published (no
  // weekends/holidays) — if the exact date 404s, it 200s with the nearest
  // prior business day's rate instead, which is an acceptable approximation
  // for expense-splitting (not currency trading).
  const res = await fetch(`${FRANKFURTER_BASE}/${dateStr}?base=${fromCcy}&symbols=${toCcy}`)
  if (!res.ok) {
    throw new Error(`ไม่พบอัตราแลกเปลี่ยน ${fromCcy}→${toCcy} สำหรับวันที่ ${dateStr} — กรุณาระบุอัตราแลกเปลี่ยนเอง`)
  }
  const json = await res.json() as { rates?: Record<string, number> }
  const rate = json.rates?.[toCcy]
  if (!rate) {
    throw new Error(`ไม่พบอัตราแลกเปลี่ยน ${fromCcy}→${toCcy} — กรุณาระบุอัตราแลกเปลี่ยนเอง`)
  }

  // Best-effort cache write — a failed insert (e.g. race with another
  // concurrent lookup for the same pair) shouldn't fail the whole request.
  await admin.from("exchange_rates").upsert({
    rate_date: dateStr, from_currency: fromCcy, to_currency: toCcy, rate,
  }, { onConflict: "rate_date,from_currency,to_currency" }).then(
    () => {}, () => {}
  )

  return rate
}
