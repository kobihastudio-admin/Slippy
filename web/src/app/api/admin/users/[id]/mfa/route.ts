/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * DELETE /api/admin/users/[id]/mfa — remove a user's TOTP factor(s).
 * For support cases where a user lost their authenticator device and can no
 * longer pass the MFA challenge to sign in at all.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

export const DELETE = withErrorLogging("admin_user_reset_mfa", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(id)
  if (getErr || !authUser.user) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 })

  const factors = authUser.user.factors ?? []
  for (const factor of factors) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: id })
  }

  await logAdminAction({
    actorId: actor.id,
    action: "user_reset_mfa",
    targetType: "users",
    targetId: id,
    after: { factorsRemoved: factors.length },
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true, factorsRemoved: factors.length })
})
