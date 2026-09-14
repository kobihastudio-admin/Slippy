/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// GET /api/admin/orgs?q=keyword — search by name or slug
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function GET(req: NextRequest) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Strip PostgREST .or() filter syntax characters — see admin/users/route.ts
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[,()]/g, "")
  if (q.length < 2) return NextResponse.json({ orgs: [] })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, slug, plan, doc_used, doc_quota, subscription_status, created_at")
    .or(`name.ilike.%${q}%,slug.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orgs: data })
}
