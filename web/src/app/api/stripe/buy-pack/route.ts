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
import { stripe } from "@/lib/stripe/server"
import { withErrorLogging } from "@/lib/log-server-error"
import { isOrgMember } from "@/lib/require-org-member"
import { getAppUrl } from "@/lib/app-url"

const DOC_PACKS = {
  pack_100: { priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PACK_100!, docs: 100,  label: "100 เอกสาร" },
  pack_300: { priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PACK_300!, docs: 300,  label: "300 เอกสาร" },
  pack_500: { priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PACK_500!, docs: 500,  label: "500 เอกสาร" },
} as const

export const POST = withErrorLogging("stripe_buy_pack", async (req: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { packId, orgId } = await req.json() as { packId: string; orgId: string }

  const pack = DOC_PACKS[packId as keyof typeof DOC_PACKS]
  if (!pack) return NextResponse.json({ error: "Invalid pack" }, { status: 400 })
  if (!orgId || !(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single()

  const session = await stripe.checkout.sessions.create({
    mode:                 "payment",           // one-time, not subscription
    payment_method_types: ["card"],
    customer:             org?.stripe_customer_id ?? undefined,
    line_items:           [{ price: pack.priceId, quantity: 1 }],
    success_url:          `${getAppUrl()}/billing?pack_success=true`,
    cancel_url:           `${getAppUrl()}/billing`,
    metadata: {
      type:     "doc_pack",
      org_id:   orgId,
      user_id:  user.id,
      pack_id:  packId,
      docs_add: String(pack.docs),
    },
    locale: "th",
  })

  return NextResponse.json({ url: session.url })
})
