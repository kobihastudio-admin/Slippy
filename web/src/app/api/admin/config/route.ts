/**
 * POST /api/admin/config
 * Superadmin-only: update a system_config value
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }         from "@/lib/supabase/admin"
import { withErrorLogging }          from "@/lib/log-server-error"
import { logAdminAction }            from "@/lib/admin-audit-log"
import { assertSuperadmin }          from "@/lib/admin-guard"

export const POST = withErrorLogging("admin_config_update", async (req: NextRequest) => {
  const user = await assertSuperadmin()
  if (!user) return NextResponse.json({ error: "Forbidden — superadmin only" }, { status: 403 })

  const { key, value } = await req.json() as { key: string; value: unknown }
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 })

  const admin = createAdminClient()

  const { data: before } = await admin
    .from("system_config")
    .select("value")
    .eq("key", key)
    .single()

  const { error } = await admin
    .from("system_config")
    .update({ value, updated_by: user.id })
    .eq("key", key)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: user.id,
    action: "system_config_update",
    targetType: "system_config",
    targetId: key,
    before: before?.value ?? null,
    after: value,
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  // Also sync org_quota columns in pricing_plans for the plan-quota keys
  const planQuotaMap: Record<string, string> = {
    free_plan_org_quota:     "free",
    starter_plan_org_quota:  "starter",
    personal_plan_org_quota: "personal",
  }
  if (planQuotaMap[key]) {
    await admin
      .from("pricing_plans")
      .update({ org_quota: Number(value) })
      .eq("id", planQuotaMap[key])
  }

  return NextResponse.json({ ok: true })
})
