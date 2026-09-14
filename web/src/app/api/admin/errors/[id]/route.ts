/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// PATCH /api/admin/errors/[id] — toggle resolved + optional note
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const { resolved, resolvedNote } = await req.json().catch(() => ({})) as
    { resolved?: boolean; resolvedNote?: string }

  const admin = createAdminClient()
  const { error } = await admin
    .from("client_error_logs")
    .update({ resolved: resolved ?? true, resolved_note: resolvedNote ?? null })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
