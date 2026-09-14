/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

/**
 * POST /api/admin/users/[id]/sign-out
 *
 * Clears this user's tracked session records (user_sessions). Note: this is
 * NOT a cryptographic kill-switch for live access tokens — Supabase has no
 * supabase-js admin API to revoke an arbitrary user's refresh tokens without
 * their own JWT (only `auth.signOut()` called BY that session works, which
 * an admin doesn't have). Their existing access token still works until it
 * naturally expires (~1hr). For an actual lockout, send a password reset
 * (separate action below) — changing the password does revoke refresh
 * tokens server-side.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertSuperadmin }  from "@/lib/admin-guard"
import { logAdminAction }    from "@/lib/admin-audit-log"
import { withErrorLogging }  from "@/lib/log-server-error"

export const POST = withErrorLogging("admin_user_clear_sessions", async (
  req: Request, { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await assertSuperadmin()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const { error } = await admin.from("user_sessions").delete().eq("user_id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction({
    actorId: actor.id,
    action: "user_clear_sessions",
    targetType: "users",
    targetId: id,
    ipAddress: req.headers.get("x-forwarded-for"),
  })

  return NextResponse.json({ ok: true })
})
