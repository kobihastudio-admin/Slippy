/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { NextRequest, NextResponse }                from "next/server"
import { createServerClient, type CookieOptions }  from "@supabase/ssr"
import { cookies }                                  from "next/headers"
import { getPublicOrigin }                          from "@/lib/public-origin"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // Not `new URL(req.url).origin`: inside the Docker image that is the
  // container id (https://<id>:3000), which sent users to an unreachable host
  // after login. See lib/public-origin.ts.
  const origin = getPublicOrigin(req.headers)
  const code  = searchParams.get("code")
  const next  = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cs: { name: string; value: string; options: CookieOptions }[]) =>
            cs.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            ),
        },
      }
    )
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Check if this user already has an org — if not, send to onboarding
      if (data.user && next === "/dashboard") {
        const { data: membership } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", data.user.id)
          .limit(1)
          .single()

        if (!membership) return NextResponse.redirect(`${origin}/onboarding`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
