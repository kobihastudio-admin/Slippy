/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * POST /api/auth/login — server-side email/password sign-in proxy.
 *
 * Previously login-form.tsx called supabase.auth.signInWithPassword()
 * directly from the browser against Supabase's Auth API — which has its
 * own platform-level rate limiting, but the app itself had no record of
 * failed attempts and no app-level lockout. Routing through here lets us
 * enforce a tighter, app-specific lockout (per-email AND per-IP) on top of
 * that, and is the only way to durably count failures since the browser
 * can't be trusted to self-report them.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit"
import { withErrorLogging } from "@/lib/log-server-error"
import { verifyTurnstileToken } from "@/lib/turnstile"

const MAX_FAILS_PER_EMAIL = 5
const MAX_FAILS_PER_IP    = 20   // broader net for credential stuffing across many emails
const LOCKOUT_WINDOW_SECONDS = 15 * 60

export const POST = withErrorLogging("auth_login", async (req: NextRequest) => {
  const { email, password, captchaToken } = await req.json().catch(() => ({})) as
    { email?: string; password?: string; captchaToken?: string }
  if (!email || !password) {
    return NextResponse.json({ error: "email และ password จำเป็น" }, { status: 400 })
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const emailKey = email.trim().toLowerCase()

  const captcha = await verifyTurnstileToken(captchaToken, ip)
  if (!captcha.ok) {
    return NextResponse.json({ error: "ยืนยันว่าไม่ใช่บอทไม่สำเร็จ กรุณาลองใหม่" }, { status: 400 })
  }

  const [byEmail, byIp] = await Promise.all([
    checkRateLimit("login_email", emailKey, MAX_FAILS_PER_EMAIL, LOCKOUT_WINDOW_SECONDS),
    checkRateLimit("login_ip", ip, MAX_FAILS_PER_IP, LOCKOUT_WINDOW_SECONDS),
  ])

  // Each check increments its own counter, so this request itself already
  // counts toward the limit — if either bucket is now over its threshold,
  // reject without even calling Supabase.
  if (!byEmail.allowed || !byIp.allowed) {
    const retryAfterSeconds = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds)
    return NextResponse.json(
      { error: `พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ ${Math.ceil(retryAfterSeconds / 60)} นาทีแล้วลองใหม่` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Failure already counted by the checkRateLimit calls above.
    return NextResponse.json(
      { error: error.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : error.message },
      { status: 401 }
    )
  }

  // Success — clear both counters so a legitimate user who mistyped their
  // password a few times isn't penalized on their next visit.
  await Promise.all([
    resetRateLimit("login_email", emailKey),
    resetRateLimit("login_ip", ip),
  ])

  // Password alone only proves aal1. If the user has enrolled a verified
  // TOTP factor, nextLevel comes back "aal2" — the client must complete a
  // challenge before this is treated as a real login (see login-form.tsx).
  // Note: the session cookie is already set at this point regardless — this
  // is a UX gate in the login flow, not an RLS-enforced restriction. Pages
  // that need to hard-require aal2 would need their own policy/check.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const mfaRequired = aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel

  return NextResponse.json({ ok: true, mfaRequired })
})
