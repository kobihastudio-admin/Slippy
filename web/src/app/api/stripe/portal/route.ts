/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createPortalSession } from "@/lib/stripe/server"
import { withErrorLogging } from "@/lib/log-server-error"
import { getAppUrl } from "@/lib/app-url"

export const POST = withErrorLogging("stripe_portal", async (req: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId } = await req.json()

  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single()

  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 })
  }

  const session = await createPortalSession({
    customerId: org.stripe_customer_id,
    returnUrl:  `${getAppUrl()}/billing`,
  })

  return NextResponse.json({ url: session.url })
})
