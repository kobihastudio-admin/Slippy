/**
 * Classifies why an extraction failed, because the three causes need opposite
 * handling and the pipeline used to treat them all the same:
 *
 *   provider  — our Anthropic account is out of credit, or the key is bad.
 *               Nothing is wrong with the document and nothing the user does
 *               will help. Re-shooting the receipt is wasted effort; the job
 *               must simply be replayed once billing is fixed.
 *   transient — rate limited / overloaded / timed out. Retrying works.
 *   document  — unreadable image, not a financial document. Only the user can
 *               fix this, by taking a better photo.
 *
 * What triggered this: five documents failed with
 * `400 … "Your credit balance is too low to access the Anthropic API"` and the
 * app showed all five as a flat red "ผิดพลาด" next to the raw English error.
 * The user reasonably read that as "the app cannot read my files" and re-scanned
 * — every retry hitting the same wall, because the real problem was a billing
 * page nobody was told about.
 */
export type FailureKind = "provider" | "transient" | "document" | "unknown"

export function classifyFailure(message: string): FailureKind {
  const m = message.toLowerCase()

  // Billing and credentials. These come back as 400/401/403 and never resolve
  // on their own, so they must never be retried and must never be blamed on
  // the document.
  if (
    m.includes("credit balance") ||
    m.includes("billing") ||
    (m.includes("quota exceeded") && m.includes("api")) ||
    m.includes("insufficient_quota") ||
    m.includes("authentication_error") ||
    m.includes("invalid x-api-key") ||
    m.includes("invalid api key") ||
    m.includes("permission_error")
  ) return "provider"

  if (
    m.includes("rate_limit") || m.includes("rate limit") ||
    m.includes("overloaded") || m.includes("529") ||
    m.includes("timeout")    || m.includes("timed out") ||
    m.includes("econnreset") || m.includes("socket hang up") ||
    m.includes("503")        || m.includes("502")
  ) return "transient"

  if (
    m.includes("json")   || m.includes("parse") ||
    m.includes("unexpected token") || m.includes("syntax") ||
    m.includes("image")  || m.includes("base64") || m.includes("media_type") ||
    m.includes("download failed") || m.includes("storage")
  ) return "document"

  return "unknown"
}

/**
 * Marker written into `documents.notes` so the recovery sweep can find the
 * documents that failed through no fault of their own and replay them.
 * Matching on this constant (rather than a schema change) keeps both sides
 * honest: the writer and the reader import the same string.
 */
export const PROVIDER_OUTAGE_NOTE =
  "ระบบอ่านเอกสารด้วย AI ใช้งานไม่ได้ชั่วคราว (ปัญหาฝั่งผู้ให้บริการ ไม่ใช่ที่เอกสารของคุณ) — " +
  "ไฟล์ถูกเก็บไว้เรียบร้อยแล้ว ระบบจะอ่านให้อัตโนมัติเมื่อกลับมาใช้งานได้ ไม่ต้องถ่ายใหม่"

/** True when the failure will clear by itself and the document deserves a replay. */
export function shouldAutoReplay(kind: FailureKind): boolean {
  return kind === "provider" || kind === "transient"
}
