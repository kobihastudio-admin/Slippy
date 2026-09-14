import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { isOrgMember }        from "@/lib/require-org-member"

// Budgets stored in organizations.metadata->budgets as JSON
// Format: { "2026-06": { total: 50000, categories: { "consumer_receipt": 15000, ... } } }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get("orgId")
  const month = req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7)
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  // Get budget settings
  const { data: org } = await supabase
    .from("organizations")
    .select("metadata")
    .eq("id", orgId)
    .single()

  const meta    = (org?.metadata as any) ?? {}
  const budgets = meta?.budgets ?? {}
  const monthBudget = budgets[month] ?? { total: 0, categories: {} }

  // Get actual spending this month
  const start = `${month}-01`
  const end   = `${month}-31`
  const { data: spending } = await supabase
    .from("documents")
    .select("doc_category, total_amount, vat_amount")
    .eq("organization_id", orgId)
    .in("status", ["approved", "pushed"])
    .gte("doc_date", start)
    .lte("doc_date", end)

  // Aggregate by category
  const byCategory: Record<string, number> = {}
  let totalSpent = 0
  for (const doc of spending ?? []) {
    const cat = doc.doc_category ?? "other"
    byCategory[cat] = (byCategory[cat] ?? 0) + Number(doc.total_amount ?? 0)
    totalSpent      += Number(doc.total_amount ?? 0)
  }

  return NextResponse.json({ budget: monthBudget, spent: { total: totalSpent, byCategory }, month })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId, month, total, categories } = await req.json() as {
    orgId:      string
    month:      string   // "YYYY-MM"
    total:      number
    categories: Record<string, number>
  }
  if (!(await isOrgMember(user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminClient()

  // Read current metadata
  const { data: org } = await admin.from("organizations").select("metadata").eq("id", orgId).single()
  const meta    = (org?.metadata as any) ?? {}
  const budgets = meta?.budgets ?? {}

  budgets[month] = { total, categories }

  const { error } = await admin.from("organizations")
    .update({ metadata: { ...meta, budgets } })
    .eq("id", orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
