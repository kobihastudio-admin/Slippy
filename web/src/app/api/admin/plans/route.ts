/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { NextResponse }      from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

// ── GET /api/admin/plans ─────────────────────────────────────────────────────
export async function GET() {
  const user = await assertSuperadmin()
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("pricing_plans")
    .select("*")
    .order("sort_order")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data })
}
