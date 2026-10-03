import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"

type Params = { params: Promise<{ id: string }> }

// GET — claim detail with audit trail
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [claimRes, eventsRes] = await Promise.all([
    supabase.from("expense_claims")
      .select(`*, documents(vendor_name, total_amount, doc_date, doc_category), business_projects(name)`)
      .eq("id", id).single(),
    supabase.from("approval_events")
      .select("id, action, comment, created_at, users(full_name)")
      .eq("claim_id", id).order("created_at"),
  ])

  if (!claimRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ claim: claimRes.data, events: eventsRes.data ?? [] })
}

// Roles allowed to approve/reject/mark-paid a claim. "viewer" (read-only) and
// a submitter with no other role are deliberately excluded — this is a money
// decision, not a membership check.
const APPROVER_ROLES = new Set(["owner", "admin", "accountant"])

// PATCH — approve / reject / mark paid
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()

  // This route updates via the admin client, which bypasses expense_claims'
  // RLS entirely — without the checks below, any signed-in user could
  // approve, reject, or mark paid any claim in any organization by id. Load
  // the claim's own org first, then require the caller to hold an approver
  // role in THAT org; a request for an id that doesn't exist, or where the
  // caller isn't an approver there, is rejected before any write happens.
  const { data: claim } = await admin
    .from("expense_claims")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle()
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", claim.organization_id)
    .maybeSingle()
  if (!membership || !APPROVER_ROLES.has(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { action, comment } = await req.json() as {
    action:   "approve" | "reject" | "mark_paid" | "under_review"
    comment?: string
  }

  const STATUS_MAP: Record<string, string> = {
    approve:      "approved",
    reject:       "rejected",
    mark_paid:    "paid",
    under_review: "under_review",
  }

  const updates: Record<string, any> = {
    status:      STATUS_MAP[action] ?? action,
    reviewer_id: user.id,
    updated_at:  new Date().toISOString(),
  }
  if (action === "approve" || action === "reject") updates.reviewed_at = new Date().toISOString()
  if (action === "reject" && comment)               updates.rejection_reason = comment
  if (action === "mark_paid")                       updates.paid_at = new Date().toISOString()

  await admin.from("expense_claims").update(updates).eq("id", id)
  await admin.from("approval_events").insert({
    claim_id: id, actor_id: user.id, action,
    comment: comment ?? null,
  })

  return NextResponse.json({ ok: true })
}
