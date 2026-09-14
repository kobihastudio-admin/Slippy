/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createClient }  from "@/lib/supabase/server"
import { redirect }       from "next/navigation"
import { LandingPage }    from "@/components/landing/landing-page"
import { safeRedirectPath } from "@/lib/safe-redirect"

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ "liff.state"?: string }>
}) {
  // ── LIFF endpoint redirect ──────────────────────────────────────
  // The LIFF app's "Endpoint URL" is registered as the bare app origin
  // (e.g. https://www.slippy.ai or a dev ngrok tunnel). When opened from
  // the LINE Rich Menu via https://liff.line.me/{liffId}/liff/home?next=...,
  // LINE redirects here with `?liff.state=%2Fliff%2Fhome%3Fnext%3D...` —
  // without this redirect, unauthenticated users land on the marketing
  // landing page instead of the LIFF login gate at /liff/home.
  const { "liff.state": liffState } = await searchParams
  if (liffState) {
    const safeLiffState = safeRedirectPath(liffState, "")
    if (safeLiffState) redirect(safeLiffState)
  }

  const supabase          = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Authenticated users go straight to the app
  if (user) redirect("/dashboard")

  // Everyone else sees the marketing landing page
  return <LandingPage />
}
