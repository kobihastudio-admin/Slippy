/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * POST /api/admin/users/[id]/reset-password — sends the user a password
 * reset link. This is the most reliable "force out + let them back in
 * safely" action available without the target user's own JWT — changing
 * the password server-side revokes their existing refresh tokens.
 */
import { NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { getAppUrl } from "@/lib/app-url"
import { withErrorLogging }  from "@/lib/log-server-error"

export const POST = withErrorLogging("admin_user_reset_password", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(id)
  if (getErr || !authUser.user?.email) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 })

  // generateLink() only creates the link without emailing it — use the
  // regular resetPasswordForEmail() instead, same call the user's own
  // self-service "เปลี่ยนรหัสผ่าน" button uses, since that's the one wired
  // to actually send the email via Supabase's configured SMTP.
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(authUser.user.email, {
    redirectTo: `${getAppUrl()}/auth/update-password`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "user_reset_password",
    targetType: "users",
    targetId: id,
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
