/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// GET /api/admin/users?q=keyword — search by email or full_name
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function GET(req: NextRequest) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Strip characters that are syntax in PostgREST's .or() filter string
  // (`,()`) — passing the raw query straight through would let someone
  // inject extra filter clauses, not just search text.
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[,()]/g, "")
  if (q.length < 2) return NextResponse.json({ users: [] })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("id, email, full_name, is_superadmin, created_at")
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data })
}
