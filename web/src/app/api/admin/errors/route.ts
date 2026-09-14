/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// GET /api/admin/errors?source=&type=&resolved=&limit=
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function GET(req: NextRequest) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = req.nextUrl
  const source   = searchParams.get("source")    // 'browser' | 'server'
  const type     = searchParams.get("type")      // error_type substring
  const resolved = searchParams.get("resolved")   // 'true' | 'false'
  const limit    = Math.min(Number(searchParams.get("limit") ?? "100"), 500)

  const admin = createAdminClient()
  let query = admin
    .from("client_error_logs")
    .select("id, source, error_type, error_name, error_message, organization_id, user_id, resolved, resolved_note, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (source) query = query.eq("source", source)
  if (type)   query = query.ilike("error_type", `%${type.replace(/[%_]/g, "")}%`)
  if (resolved === "true")  query = query.eq("resolved", true)
  if (resolved === "false") query = query.eq("resolved", false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ errors: data })
}
