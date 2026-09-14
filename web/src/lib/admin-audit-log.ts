/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * logAdminAction — records a superadmin write into admin_audit_logs
 * (system_config / pricing_plans changes bypass RLS via createAdminClient,
 * so without this there'd be no record of who changed what). Never throws —
 * a logging failure must not block the admin action that already succeeded.
 */
export async function logAdminAction(params: {
  actorId: string
  action: string
  targetType: string
  targetId?: string | null
  before?: unknown
  after?: unknown
  ipAddress?: string | null
}): Promise<void> {
  const { actorId, action, targetType, targetId, before, after, ipAddress } = params
  try {
    const admin = createAdminClient()
    await admin.from("admin_audit_logs").insert({
      actor_id:    actorId,
      action,
      target_type: targetType,
      target_id:   targetId ?? null,
      before:      before ?? null,
      after:       after ?? null,
      ip_address:  ipAddress ?? null,
    })
  } catch (err) {
    console.error("[logAdminAction] failed to persist audit log:", err)
  }
}
