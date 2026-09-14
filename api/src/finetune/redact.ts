/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Redaction of personal data in the free-text fields of a training target.
 *
 * A training corpus is a durable, copied, exported artifact — the opposite of a
 * database row you can delete. Whatever is in it when it leaves the org stays
 * there, in every checkpoint and every backup, and cannot be recalled. So the
 * cleaning happens at export, before the copy exists, not as a later pass.
 *
 * Scope is honest and narrow: this redacts TEXT. The receipt IMAGE is the model
 * input and carries everything the paper carried — card digits, names, phone
 * numbers, addresses. Nothing here touches that. See the note at the bottom of
 * this file; it is a decision to make before any corpus leaves the building,
 * not a gap to discover afterwards.
 */

export interface Redaction {
  kind: "pan" | "national_id" | "phone" | "email"
  field: string
}

/** Luhn check — the discriminator between a card number and any other digit run. */
function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (double) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    double = !double
  }
  return digits.length > 0 && sum % 10 === 0
}

/**
 * Both digit patterns are anchored to the start of a standalone token.
 *
 * Without the lookbehind, `POS#E030372020011` — an ordinary 7-Eleven receipt
 * reference — matches: the embedded run reaches 13 digits once it absorbs the
 * following amount, and the leading `0` reads as a Thai phone prefix. Redacting
 * it would delete real training signal to protect data that was never personal,
 * which is the same kind of damage as leaking, pointed the other way.
 */
const DIGIT_RUN  = /(?<![A-Za-z0-9])\d[\d \-]{11,21}\d/g
/** Thai mobile: 06/08/09 + 8 digits, or +66. Landline prefixes are excluded — they collide with receipt numbers. */
const THAI_PHONE = /(?<![A-Za-z0-9])(?:\+66[\s-]?[689]|0[689])(?:[\s-]?\d){8}(?!\d)/g
const EMAIL      = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/g

/**
 * Redacts one free-text value.
 *
 * Card numbers are the reason this exists — a PAN in a training corpus is a PCI
 * problem that no amount of later deletion fixes. Thai national IDs are 13
 * digits, exactly like the vendor tax id the product legitimately needs, so the
 * two are separated by Luhn: card numbers satisfy it, Thai ID and tax numbers
 * use a different check digit and do not. A tax id that also appears inside a
 * vendor NAME is redacted here and kept in its own structured field, so the
 * task loses nothing.
 */
export function redactFreeText(value: string | null, field: string): {
  value: string | null
  redactions: Redaction[]
} {
  if (!value) return { value, redactions: [] }
  const redactions: Redaction[] = []
  let out = value

  // Longest-first: a PAN can contain a shorter run, so the digit sweep runs
  // before the phone sweep or a 16-digit card gets partly eaten as a phone.
  out = out.replace(DIGIT_RUN, match => {
    const digits = match.replace(/\D/g, "")
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
      redactions.push({ kind: "pan", field })
      return "[REDACTED_PAN]"
    }
    if (digits.length === 13) {
      redactions.push({ kind: "national_id", field })
      return "[REDACTED_ID]"
    }
    return match
  })

  out = out.replace(THAI_PHONE, () => {
    redactions.push({ kind: "phone", field })
    return "[REDACTED_PHONE]"
  })

  out = out.replace(EMAIL, () => {
    redactions.push({ kind: "email", field })
    return "[REDACTED_EMAIL]"
  })

  return { value: out, redactions }
}

/**
 * Redacts every free-text field of a target, returning the fields it touched.
 *
 * The caller records those names in the example's metadata: a reviewer reading
 * the corpus later can then tell a redaction from a model error, which is
 * otherwise an impossible distinction to make from the text alone.
 */
export function redactTarget<T extends {
  vendor_name: string | null
  line_items: Array<{ description: string; amount: number }>
}>(fields: T): { fields: T; redactedFields: string[] } {
  const all: Redaction[] = []

  const vendor = redactFreeText(fields.vendor_name, "vendor_name")
  all.push(...vendor.redactions)

  const line_items = fields.line_items.map((item, i) => {
    const r = redactFreeText(item.description, `line_items[${i}].description`)
    all.push(...r.redactions)
    return { ...item, description: r.value ?? "" }
  })

  return {
    fields: { ...fields, vendor_name: vendor.value, line_items },
    redactedFields: [...new Set(all.map(r => r.field))],
  }
}

/**
 * IMAGE REDACTION IS NOT IMPLEMENTED, AND THAT IS A DECISION, NOT AN OVERSIGHT.
 *
 * Every example points at the original receipt photo. For a vision corpus that
 * is unavoidable — the image is the input — but it means the corpus carries
 * every card number, name, and address the text redaction above removes from
 * the target. Before a corpus leaves the organisation, one of these has to be
 * true: the images stay in-house, the recipient is under a DPA that covers
 * them, or someone has built image-level redaction. This constant exists so the
 * question is answered explicitly rather than by nobody asking it.
 */
export const IMAGES_ARE_UNREDACTED = true as const
