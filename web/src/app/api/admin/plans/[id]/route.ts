/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }         from "@/lib/supabase/admin"
import { stripe }                    from "@/lib/stripe/server"
import { withErrorLogging }          from "@/lib/log-server-error"
import { logAdminAction }            from "@/lib/admin-audit-log"
import { assertSuperadmin }          from "@/lib/admin-guard"

// ── PUT /api/admin/plans/[id] ─────────────────────────────────────────────────
// Body fields (all optional):
//   name_th, name_en, price_thb, doc_quota, features (string[]),
//   highlighted, is_active, sort_order,
//   stripe_price_id_m, stripe_price_id_y
export const PUT = withErrorLogging("admin_plan_update", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await assertSuperadmin()
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const body = await req.json() as Record<string, unknown>

  // Build safe update payload — only allow known columns
  const allowed = [
    "name_th", "name_en", "price_thb", "doc_quota",
    "features", "highlighted", "is_active", "sort_order",
    "stripe_price_id_m", "stripe_price_id_y",
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  // ── Optional: create Stripe Product+Price if price changed and no ID set ──
  // If admin supplies stripe_price_id_m / _y explicitly, use those.
  // If admin changes price_thb but no stripe ID is supplied, skip Stripe (manual step).

  const admin = createAdminClient()

  const { data: before } = await admin
    .from("pricing_plans")
    .select(allowed.join(","))
    .eq("id", id)
    .single()

  const { data, error } = await admin
    .from("pricing_plans")
    .update(patch)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: user.id,
    action: "pricing_plan_update",
    targetType: "pricing_plans",
    targetId: id,
    before,
    after: patch,
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true, plan: data })
})

// ── POST /api/admin/plans/[id]/stripe-sync ───────────────────────────────────
// Creates Stripe Products & Prices for monthly + yearly billing, then saves
// the resulting price IDs back to pricing_plans.
// Expects body: { currency?: "thb", yearlyDiscountPct?: number }
export const POST = withErrorLogging("admin_plan_stripe_sync", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await assertSuperadmin()
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const { yearlyDiscountPct = 17 } = (await req.json().catch(() => ({}))) as {
    yearlyDiscountPct?: number
  }

  const admin = createAdminClient()
  const { data: plan, error: planErr } = await admin
    .from("pricing_plans")
    .select("*")
    .eq("id", id)
    .single()

  if (planErr || !plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  if (plan.price_thb <= 0) {
    return NextResponse.json(
      { error: "Cannot create Stripe prices for free/enterprise plans" },
      { status: 400 }
    )
  }

  // Create or retrieve Stripe Product
  const productName = `Slippy ${plan.name_en} (${plan.id})`
  const product = await stripe.products.create({
    name:        productName,
    description: `${plan.doc_quota} เอกสาร/เดือน`,
    metadata:    { plan_id: plan.id },
  })

  // Monthly price (THB, smallest unit = satang × 100)
  const monthlyAmount = plan.price_thb * 100
  const priceM = await stripe.prices.create({
    product:     product.id,
    unit_amount: monthlyAmount,
    currency:    "thb",
    recurring:   { interval: "month" },
    metadata:    { plan_id: plan.id, billing: "monthly" },
  })

  // Yearly price (with discount)
  const yearlyAmount = Math.round(plan.price_thb * 12 * (1 - yearlyDiscountPct / 100)) * 100
  const priceY = await stripe.prices.create({
    product:     product.id,
    unit_amount: yearlyAmount,
    currency:    "thb",
    recurring:   { interval: "year" },
    metadata:    { plan_id: plan.id, billing: "yearly", discount_pct: String(yearlyDiscountPct) },
  })

  // Save back to DB
  const { data: updated, error: updateErr } = await admin
    .from("pricing_plans")
    .update({
      stripe_price_id_m: priceM.id,
      stripe_price_id_y: priceY.id,
    })
    .eq("id", id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  await logAdminAction({
    actorId: user.id,
    action: "pricing_plan_stripe_sync",
    targetType: "pricing_plans",
    targetId: id,
    before: { stripe_price_id_m: plan.stripe_price_id_m, stripe_price_id_y: plan.stripe_price_id_y },
    after: { stripe_price_id_m: priceM.id, stripe_price_id_y: priceY.id, stripe_product_id: product.id },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({
    ok: true,
    stripe_product_id:  product.id,
    stripe_price_id_m:  priceM.id,
    stripe_price_id_y:  priceY.id,
    plan:               updated,
  })
})
