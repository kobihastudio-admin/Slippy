/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createCheckoutSession, STRIPE_PRICES } from "@/lib/stripe/server"
import { PLAN_MAP } from "@/lib/plans"
import { getAppUrl } from "@/lib/app-url"
import { withErrorLogging } from "@/lib/log-server-error"
import { isOrgMember } from "@/lib/require-org-member"

export const POST = withErrorLogging("stripe_create_checkout", async (req: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { planId, orgId, yearly = false } = await req.json()

  // Validate plan exists in lib/plans.ts
  const plan = PLAN_MAP[planId as keyof typeof PLAN_MAP]
  if (!plan) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 })
  }
  // A hijacked orgId here doesn't just leak data — it creates a real Stripe
  // Checkout session that would upgrade billing for an org the caller
  // doesn't belong to (or let them attribute their own payment to someone
  // else's org), so this check matters even though the reads below are
  // otherwise RLS-safe.
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // ── Resolve Stripe Price ID ───────────────────────────────────────────────
  // Priority: DB (pricing_plans) > env vars (STRIPE_PRICES)
  // This allows admin panel to manage price IDs without env var changes.
  const admin = createAdminClient()
  const { data: dbPlan } = await admin
    .from("pricing_plans")
    .select("stripe_price_id_m, stripe_price_id_y")
    .eq("id", planId)
    .single()

  const dbPriceId    = yearly ? dbPlan?.stripe_price_id_y : dbPlan?.stripe_price_id_m
  const envPrices    = STRIPE_PRICES[planId]
  const envPriceId   = yearly ? envPrices?.priceIdY : envPrices?.priceId
  const priceId      = dbPriceId || envPriceId || ""

  if (!priceId) {
    return NextResponse.json(
      {
        error: `Stripe price not configured for plan "${planId}" (${yearly ? "yearly" : "monthly"}). ` +
               `Set it via Admin → Plans or add STRIPE_PRICE_${planId.toUpperCase()}_${yearly ? "Y" : "M"} env var.`,
      },
      { status: 500 }
    )
  }

  // Look up existing Stripe customer for the org
  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single()

  const session = await createCheckoutSession({
    orgId,
    userId:             user.id,
    priceId,
    successUrl:         `${getAppUrl()}/billing?success=true&plan=${planId}`,
    cancelUrl:          `${getAppUrl()}/billing`,
    existingCustomerId: org?.stripe_customer_id ?? undefined,
  })

  return NextResponse.json({ url: session.url })
})
