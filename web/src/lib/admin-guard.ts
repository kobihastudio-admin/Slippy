/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createClient } from "@/lib/supabase/server"
import type { User } from "@supabase/supabase-js"

/**
 * assertSuperadmin — was duplicated identically in admin/plans/route.ts and
 * admin/plans/[id]/route.ts; extracted here since every new /api/admin/*
 * route needs the same check.
 */
export async function assertSuperadmin(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("is_superadmin")
    .eq("id", user.id)
    .single()

  return profile?.is_superadmin === true ? user : null
}
