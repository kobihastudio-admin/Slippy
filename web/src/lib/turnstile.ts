/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/**
 * verifyTurnstileToken — server-side check of a Cloudflare Turnstile token
 * against the public login/register forms.
 *
 * Fails OPEN (returns ok: true) when TURNSTILE_SECRET_KEY isn't configured —
 * same convention as other optional integrations in this codebase (LINE,
 * Stripe price IDs, etc.): missing config disables the feature rather than
 * breaking local/dev environments that haven't set it up yet. Once the key
 * is set in production, this becomes a real enforcement point.
 */
export async function verifyTurnstileToken(token: string | undefined | null, ip: string): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true }

  if (!token) return { ok: false, reason: "missing_token" }

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    })
    const data = await res.json() as { success: boolean }
    return data.success ? { ok: true } : { ok: false, reason: "verification_failed" }
  } catch (err) {
    console.error("[turnstile] verify request failed:", (err as Error).message)
    // Network failure talking to Cloudflare shouldn't lock everyone out —
    // fail open here too, the rate limiter is the backstop.
    return { ok: true }
  }
}
