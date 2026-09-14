/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * POST /api/auth/register — server-side sign-up proxy.
 *
 * Previously register-form.tsx called supabase.auth.signUp() (plus org
 * creation) directly from the browser. Moved server-side for the same
 * reason as /api/auth/login: a CAPTCHA/rate-limit check only means
 * something if it happens where the browser can't skip past it.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { withErrorLogging } from "@/lib/log-server-error"
import { verifyTurnstileToken } from "@/lib/turnstile"
import { slugify } from "@/lib/utils"
import { getDocQuota } from "@/lib/plans"

const MAX_SIGNUPS_PER_IP = 10
const WINDOW_SECONDS = 60 * 60

export const POST = withErrorLogging("auth_register", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({})) as {
    fullName?: string; email?: string; password?: string; orgName?: string; captchaToken?: string
  }
  const { fullName, email, password, orgName, captchaToken } = body

  if (!email || !password) {
    return NextResponse.json({ error: "email และ password จำเป็น" }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" }, { status: 400 })
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"

  const captcha = await verifyTurnstileToken(captchaToken, ip)
  if (!captcha.ok) {
    return NextResponse.json({ error: "ยืนยันว่าไม่ใช่บอทไม่สำเร็จ กรุณาลองใหม่" }, { status: 400 })
  }

  // Mass-signup abuse guard — separate from /api/auth/login's lockout since
  // this is about throttling NEW account creation, not protecting existing
  // accounts from brute force.
  const { allowed, retryAfterSeconds } = await checkRateLimit("register_ip", ip, MAX_SIGNUPS_PER_IP, WINDOW_SECONDS)
  if (!allowed) {
    return NextResponse.json(
      { error: "สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่ในภายหลัง" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    )
  }

  const supabase = await createClient()

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName ?? "" } },
  })

  if (signUpError || !authData.user) {
    return NextResponse.json({ error: signUpError?.message ?? "สมัครสมาชิกไม่สำเร็จ" }, { status: 400 })
  }

  const slug = `${slugify(orgName || fullName || "org")}-${Date.now().toString(36)}`

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: orgName || `${fullName ?? "New"}'s Company`,
      slug,
      plan: "free",
      subscription_status: "active",
      doc_quota: getDocQuota("free"),
    })
    .select("id")
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: "สร้างองค์กรไม่สำเร็จ" }, { status: 500 })
  }

  await supabase.from("organization_members").insert({
    organization_id: org.id,
    user_id: authData.user.id,
    role: "owner",
  })

  return NextResponse.json({ ok: true, orgId: org.id })
})
