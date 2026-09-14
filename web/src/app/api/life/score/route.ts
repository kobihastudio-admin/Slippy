import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"

// GET — get or compute life score
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Try to get today's snapshot first
  const { data: snapshot } = await supabase
    .from("life_score_snapshots")
    .select("*")
    .eq("organization_id", orgId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single()

  if (snapshot) return NextResponse.json({ score: snapshot })

  // No snapshot — compute now
  const admin = createAdminClient()
  const { data: computed } = await admin.rpc("compute_life_score", { p_org_id: orgId })

  return NextResponse.json({
    score: {
      overall_score:   computed?.overall   ?? 0,
      wealth_score:    computed?.wealth    ?? 0,
      lifestyle_score: computed?.lifestyle ?? 0,
      journey_score:   computed?.journey   ?? 0,
      social_score:    computed?.social    ?? 0,
      components:      {},
    }
  })
}

// POST — force recompute score
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId } = await req.json()
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data } = await admin.rpc("compute_life_score", { p_org_id: orgId })
  return NextResponse.json({ score: data })
}
