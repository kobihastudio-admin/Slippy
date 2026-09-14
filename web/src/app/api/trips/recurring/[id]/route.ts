import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isOrgMember }       from "@/lib/require-org-member"

type Params = { params: Promise<{ id: string }> }

async function assertOwnerOrgMember(templateId: string, userId: string) {
  const admin = createAdminClient()
  const { data: template } = await admin
    .from("recurring_expense_templates")
    .select("id, journey_id, life_journeys(organization_id)")
    .eq("id", templateId)
    .single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgId = (template as any)?.life_journeys?.organization_id
  if (!template || !orgId || !(await isOrgMember(userId, orgId))) return null
  return admin
}

// PATCH — pause/resume ("is_active"), or edit amount/title/schedule
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = await assertOwnerOrgMember(id, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json() as Partial<{
    title: string; amount: number; category: string
    isActive: boolean; endDate: string | null; nextRunDate: string
  }>

  const update: Record<string, unknown> = {}
  if (body.title       !== undefined) update.title         = body.title
  if (body.amount      !== undefined) update.amount        = body.amount
  if (body.category    !== undefined) update.category      = body.category
  if (body.isActive    !== undefined) update.is_active     = body.isActive
  if (body.endDate      !== undefined) update.end_date      = body.endDate
  if (body.nextRunDate !== undefined) update.next_run_date = body.nextRunDate

  const { error } = await admin.from("recurring_expense_templates").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove the template (past-generated expenses stay untouched —
// they're real trip_expenses rows, not tied to the template's lifecycle)
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = await assertOwnerOrgMember(id, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { error } = await admin.from("recurring_expense_templates").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
