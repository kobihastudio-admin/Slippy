import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"

// GET — list claims (submitter sees own; admin/manager sees all org)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId  = req.nextUrl.searchParams.get("orgId")
  const status = req.nextUrl.searchParams.get("status")  // filter
  const role   = req.nextUrl.searchParams.get("role") ?? "submitter"
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  let q = supabase.from("expense_claims")
    .select(`
      id, title, description, amount, currency, category, status,
      submitted_at, reviewed_at, paid_at, rejection_reason,
      submitter_id, reviewer_id, project_id, document_id, created_at,
      documents(vendor_name, total_amount, doc_date),
      business_projects(name)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })

  if (role === "submitter") q = q.eq("submitter_id", user.id)
  if (status) q = q.eq("status", status)

  const { data: claims, error } = await q.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claims: claims ?? [] })
}

// POST — submit a new claim
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    orgId:       string
    title:       string
    description?: string
    amount:      number
    category?:   string
    projectId?:  string
    documentId?: string
  }

  const { orgId, title, description, amount, category, projectId, documentId } = body
  if (!orgId || !title || !amount) return NextResponse.json({ error: "orgId, title, amount required" }, { status: 400 })
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: claim, error } = await admin.from("expense_claims").insert({
    organization_id: orgId,
    submitter_id:    user.id,
    title,
    description:     description ?? null,
    amount,
    category:        category ?? null,
    project_id:      projectId ?? null,
    document_id:     documentId ?? null,
    status:          "submitted",
    submitted_at:    new Date().toISOString(),
  }).select("id").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit event
  await admin.from("approval_events").insert({
    claim_id: claim!.id, actor_id: user.id, action: "submitted",
    comment: `ยื่นเบิก "${title}" จำนวน ฿${amount.toLocaleString()}`,
  })

  return NextResponse.json({ claimId: claim!.id })
}
