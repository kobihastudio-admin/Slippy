/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * safeRedirectPath — validates a user-supplied "next" redirect target by
 * resolving it against a fixed dummy origin and checking the resolved
 * origin didn't change, instead of pattern-matching the raw string.
 *
 * The 4 call sites that previously did `next.startsWith("/") &&
 * !next.startsWith("//")` only caught the literal protocol-relative `//`
 * case. That misses other ways a string can resolve to a different origin
 * once a URL parser gets hold of it — e.g. backslashes (`/\evil.com`),
 * which WHATWG URL parsing normalizes to forward slashes for http(s)
 * schemes, turning what looks like a relative path into `//evil.com`.
 * Letting the actual URL parser decide (and comparing origins) closes that
 * whole class of variants at once rather than enumerating each one.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback
  const dummyOrigin = "http://internal.invalid"
  try {
    const resolved = new URL(next, dummyOrigin)
    if (resolved.origin !== dummyOrigin) return fallback
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallback
  }
}
