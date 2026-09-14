/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { getMembership } from "@/lib/get-membership"
import { createClient }  from "@/lib/supabase/server"
import { IncomeClient }  from "@/components/split/income-client"

export default async function SplitIncomePage() {
  const { organization_id: orgId } = await getMembership()
  const supabase = await createClient()

  const { data: bills } = await supabase
    .from("split_bills")
    .select(`
      id, title, total_amount, category, status, created_at,
      sport_type, venue, trip_type, destination, sport_group_id,
      split_participants(id, name, amount, paid_at, payment_proof_url, line_picture_url, line_display)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200)

  const sportGroupIds = Array.from(new Set(
    (bills ?? []).map(b => (b as any).sport_group_id).filter(Boolean)
  )) as string[]

  let sportGroupNames: Record<string, string> = {}
  if (sportGroupIds.length > 0) {
    const { data: groups } = await supabase
      .from("sport_groups")
      .select("id, title")
      .in("id", sportGroupIds)
    sportGroupNames = Object.fromEntries((groups ?? []).map(g => [g.id, g.title as string]))
  }

  return (
    <IncomeClient
      orgId={orgId}
      bills={(bills ?? []) as any}
      sportGroupNames={sportGroupNames}
    />
  )
}
