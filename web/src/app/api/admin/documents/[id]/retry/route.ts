/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * POST /api/admin/documents/[id]/retry — re-trigger the extraction pipeline
 * for a stuck document. Re-uses the existing /api/documents/[id]/process
 * proxy (which forwards to api/ with the internal key) rather than
 * duplicating that auth — documents.ts's own retry logic already skips
 * re-incrementing quota when status is 'pending' or 'failed', but NOT for
 * 'processing' — so we flip to 'pending' first to make sure a stuck
 * "processing" row doesn't get double-counted against quota on retry.
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

export const POST = withErrorLogging("admin_document_retry", async (
  req: NextRequest, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: before } = await admin.from("documents").select("status").eq("id", id).single()
  if (!before) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })

  await admin.from("documents").update({ status: "pending" }).eq("id", id)

  const res = await fetch(`${req.nextUrl.origin}/api/documents/${id}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  const json = await res.json().catch(() => ({}))

  if (!res.ok) return NextResponse.json({ error: json.error ?? "retry ไม่สำเร็จ" }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "document_retry",
    targetType: "documents",
    targetId: id,
    before: { status: before.status },
    after: { status: "pending→processing" },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
