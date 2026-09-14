/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

// GET /api/admin/orgs/[id] — full detail for the admin org page
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const [{ data: org, error: orgErr }, { data: members }, { data: invoices }, { data: plans }] = await Promise.all([
    admin.from("organizations").select("*").eq("id", id).single(),
    admin.from("organization_members")
      .select("role, joined_at, users(id, email, full_name)")
      .eq("organization_id", id),
    admin.from("billing_invoices")
      .select("id, amount_paid, currency, status, period_start, period_end, created_at")
      .eq("organization_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("pricing_plans").select("id, name_th, doc_quota").order("sort_order"),
  ])

  if (orgErr || !org) return NextResponse.json({ error: "ไม่พบองค์กร" }, { status: 404 })

  return NextResponse.json({
    org,
    members: members ?? [],
    invoices: invoices ?? [],
    plans: plans ?? [],
  })
}

// PUT /api/admin/orgs/[id] — change plan (syncs doc_quota to the plan's default)
export const PUT = withErrorLogging("admin_org_update_plan", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const { plan } = await req.json().catch(() => ({})) as { plan?: string }
  if (!plan) return NextResponse.json({ error: "plan required" }, { status: 400 })

  const admin = createAdminClient()

  const { data: planRow } = await admin.from("pricing_plans").select("doc_quota").eq("id", plan).single()
  if (!planRow) return NextResponse.json({ error: "ไม่พบ plan นี้" }, { status: 400 })

  const { data: before } = await admin.from("organizations").select("plan, doc_quota").eq("id", id).single()

  const { error } = await admin
    .from("organizations")
    .update({ plan, doc_quota: planRow.doc_quota, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "org_plan_change",
    targetType: "organizations",
    targetId: id,
    before,
    after: { plan, doc_quota: planRow.doc_quota },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
