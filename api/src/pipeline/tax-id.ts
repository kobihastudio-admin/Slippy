/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Thai 13-digit tax / national ID validation.
 *
 * A tax ID is not just a field on a receipt — it is the merchant's identity.
 * The vendor registry keys on it, the training corpus splits on it, and
 * merchant memory will look up by it. So a wrong one is not a wrong string in
 * one row: it silently merges two unrelated shops, or splits one shop in two,
 * and every conclusion drawn downstream inherits the error.
 *
 * The number carries a mod-11 check digit, which means a misread is detectable
 * on the spot with no lookup and no network. Production had two receipts both
 * claiming to be CP All with different IDs; the checksum identifies which one
 * is real. It also rejects "0000000000000", which a length check cannot.
 */

/**
 * Validates the mod-11 check digit.
 *
 * Weights run 13 down to 2 across the first twelve digits; the thirteenth is
 * the check digit, defined as (11 − (sum mod 11)) mod 10.
 *
 * Separators are stripped before checking — receipts print the number in
 * several styles ("0-1075-42000-01-1") and the format is not the content.
 * A repeated-digit string is rejected outright: a few of them satisfy the
 * checksum by coincidence, but none of them is a real registration.
 */
export function isValidThaiTaxId(value: string | null | undefined): boolean {
  if (!value) return false
  const digits = String(value).replace(/\D/g, "")
  if (digits.length !== 13) return false

  // Placeholders. "0000000000000" passes mod-11 (sum 0), so the checksum alone
  // would wave through the exact value production stored on doc 3e3e4d8e.
  if (/^(\d)\1{12}$/.test(digits)) return false

  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i)
  const check = (11 - (sum % 11)) % 10
  return check === Number(digits[12])
}

/** Returns the ID when it is real, otherwise null — for use at assignment sites. */
export function normaliseTaxId(value: string | null | undefined): string | null {
  if (!isValidThaiTaxId(value)) return null
  return String(value).replace(/\D/g, "")
}
