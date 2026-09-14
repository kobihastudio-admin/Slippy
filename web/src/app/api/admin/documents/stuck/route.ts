/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * GET /api/admin/documents/stuck?minutes=15
 *
 * Documents whose status is still 'pending' or 'processing' after the given
 * age threshold — i.e. the extraction pipeline never finished. Root cause:
 * api/src/routes/documents.ts runs the pipeline as an in-process
 * fire-and-forget promise (no queue/worker), so a process crash/restart
 * mid-run, or (before this same session's fix) a hung external API call
 * with no timeout, leaves the row stuck with nothing left tracking it.
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function GET(req: NextRequest) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const minutes = Math.max(1, Number(req.nextUrl.searchParams.get("minutes") ?? "15"))
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("documents")
    .select("id, organization_id, vendor_name, status, source, created_at, updated_at, organizations(name)")
    .in("status", ["pending", "processing"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data, thresholdMinutes: minutes })
}
