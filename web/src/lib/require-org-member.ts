/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Routes that use the cookie-scoped Supabase client (`@/lib/supabase/server`)
 * for org-filtered reads are already protected by RLS (see
 * supabase/migrations/002_rls_policies.sql — `org_select` etc. key every
 * policy off `auth.uid()`), so a client-supplied `orgId` that doesn't belong
 * to the caller just returns empty results there.
 *
 * Routes that use `createAdminClient()` (service-role, bypasses RLS
 * entirely) have no such safety net — if they trust a client-supplied
 * `orgId` without re-checking it, any logged-in user can read or act on
 * *any* organization's data by passing its id. This helper is the explicit
 * check those routes were missing.
 */
import { createAdminClient } from "@/lib/supabase/admin"

export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle()
  return !!data
}
