/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// POST /api/admin/documents/[id]/mark-failed — give up on a stuck document
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

export const POST = withErrorLogging("admin_document_mark_failed", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: before } = await admin.from("documents").select("status").eq("id", id).single()
  if (!before) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })

  const { error } = await admin
    .from("documents")
    .update({ status: "failed", notes: "Marked failed manually by admin (stuck in processing)" })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "document_mark_failed",
    targetType: "documents",
    targetId: id,
    before: { status: before.status },
    after: { status: "failed" },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
