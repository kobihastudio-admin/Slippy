import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isOrgMember }       from "@/lib/require-org-member"
import type { SplitMode } from "@/lib/trip-settlement"

// GET /api/trips/recurring?journeyId=xxx — list templates for a trip
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const journeyId = req.nextUrl.searchParams.get("journeyId")
  if (!journeyId) return NextResponse.json({ error: "journeyId required" }, { status: 400 })

  const { data: templates } = await supabase
    .from("recurring_expense_templates")
    .select(`
      id, title, amount, category, split_mode, split_values,
      interval_unit, next_run_date, end_date, is_active,
      last_generated_at, created_at,
      trip_participants!recurring_expense_templates_paid_by_id_fkey(id, display_name)
    `)
    .eq("journey_id", journeyId)
    .order("created_at", { ascending: false })

  return NextResponse.json({ templates: templates ?? [] })
}

// POST — create a recurring expense template
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    journeyId:     string
    paidById:      string
    title:         string
    amount:        number
    category?:     string
    splitMode?:    SplitMode
    splitValues?:  Record<string, number>
    intervalUnit:  "weekly" | "monthly" | "yearly"
    startDate?:    string   // first occurrence — defaults to today
    endDate?:      string | null
  }

  if (!body.journeyId || !body.paidById || !body.title || !body.amount || !body.intervalUnit) {
    return NextResponse.json({ error: "journeyId, paidById, title, amount, intervalUnit required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: journey } = await admin.from("life_journeys").select("organization_id").eq("id", body.journeyId).single()
  if (!journey || !(await isOrgMember(user.id, journey.organization_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: template, error } = await admin.from("recurring_expense_templates").insert({
    journey_id:    body.journeyId,
    paid_by_id:    body.paidById,
    title:         body.title,
    amount:        body.amount,
    category:      body.category ?? "other",
    split_mode:    body.splitMode ?? "equal",
    split_values:  body.splitValues ?? {},
    interval_unit: body.intervalUnit,
    next_run_date: body.startDate ?? new Date().toISOString().slice(0, 10),
    end_date:      body.endDate ?? null,
    created_by:    user.id,
  }).select("id").single()

  if (error || !template) return NextResponse.json({ error: error?.message ?? "สร้างรายจ่ายประจำไม่สำเร็จ" }, { status: 500 })
  return NextResponse.json({ templateId: template.id })
}
