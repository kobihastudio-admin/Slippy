/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

// GET /api/admin/users/[id] — full detail for the admin user page
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const [{ data: profile, error: profileErr }, { data: memberships }, { data: sessions }, { data: activity }, authUser] =
    await Promise.all([
      admin.from("users").select("id, email, full_name, is_superadmin, created_at").eq("id", id).single(),
      admin.from("organization_members")
        .select("role, joined_at, organizations(id, name, slug, plan, doc_used, doc_quota)")
        .eq("user_id", id),
      admin.from("user_sessions")
        .select("id, device_name, device_type, os, browser, ip_address, last_active, created_at")
        .eq("user_id", id)
        .order("last_active", { ascending: false }),
      admin.from("user_activity_logs")
        .select("id, action, detail, ip_address, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      admin.auth.admin.getUserById(id),
    ])

  if (profileErr || !profile) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 })

  const verifiedFactors = (authUser.data.user?.factors ?? []).filter(f => f.status === "verified")

  return NextResponse.json({
    profile,
    memberships: memberships ?? [],
    sessions: sessions ?? [],
    activity: activity ?? [],
    mfaEnabled: verifiedFactors.length > 0,
  })
}
