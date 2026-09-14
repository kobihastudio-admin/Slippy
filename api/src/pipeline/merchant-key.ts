/**
 * Canonical merchant identity
 * =====================================================================
 * The single source of truth for "is this the same store?", so repeat
 * purchases (vendors.doc_count) are counted correctly. Used at runtime by
 * upsertVendor AND by the one-time backfill (scripts/backfill-vendor-keys.ts),
 * so a vendor's key can never drift between the two.
 *
 * Priority:
 *   1. A full 13-digit Thai tax id → format-independent gold-standard identity
 *      ("0-1055-61207-57-1" and "0105561207571" collapse to the same store).
 *   2. Otherwise an aggressively normalized name: lower-cased, branch and legal
 *      words removed, punctuation/spacing stripped.
 *
 * Pure + unit tested (scripts/verify-vendor.ts).
 */

export interface MerchantIdentity {
  name?:  string | null
  taxId?: string | null
}

// Legal-entity words that add noise but not identity.
const LEGAL_WORDS =
  /(บริษัท|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|หจก\.?|จำกัด|มหาชน|company|co\.?\s*,?\s*ltd\.?|ltd\.?|inc\.?|corporation|corp\.?)/gi

export function canonicalMerchantKey({ name, taxId }: MerchantIdentity): string {
  const digits = String(taxId ?? "").replace(/\D/g, "")
  if (digits.length === 13) return digits

  let s = String(name ?? "").toLowerCase()
  s = s.replace(/\(.*?\)/g, "")            // drop parenthesised text (branch codes, "(DD103)")
  // Drop branch markers and everything after. No \b — Thai has no word spaces,
  // so สาขา is glued to the branch name (สาขาโลตัส); \b would never fire.
  s = s.replace(/(สาขา|branch).*$/gi, "")
  s = s.replace(LEGAL_WORDS, "")           // drop legal words
  s = s.replace(/[\s.,\-_/()#:฿*&'"]/g, "") // strip spacing + punctuation
  return s.trim()
}
