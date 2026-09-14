/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * POST /api/admin/orgs/[id]/reset-quota — manually zero out doc_used for one
 * org, for support cases that can't wait for the next scheduled
 * reset_due_org_quotas() run (migration 061).
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

export const POST = withErrorLogging("admin_org_reset_quota", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: before } = await admin.from("organizations").select("doc_used").eq("id", id).single()

  const { error } = await admin.from("organizations").update({ doc_used: 0 }).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "org_manual_quota_reset",
    targetType: "organizations",
    targetId: id,
    before: { doc_used: before?.doc_used },
    after: { doc_used: 0 },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
