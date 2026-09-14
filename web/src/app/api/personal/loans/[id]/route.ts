/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET — loan detail + full payment history (RLS scopes both to the owner)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: loan, error: loanErr } = await supabase
    .from("personal_loans")
    .select("id, name, lender, principal, annual_rate_pct, term_months, start_date, is_archived")
    .eq("id", id)
    .single()

  if (loanErr || !loan) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: payments, error: payErr } = await supabase
    .from("personal_loan_payments")
    .select("id, payment_date, amount, note")
    .eq("loan_id", id)
    .order("payment_date", { ascending: true })

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

  return NextResponse.json({ loan, payments: payments ?? [] })
}

// PATCH — update loan fields (e.g. archive it)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as { isArchived?: boolean; name?: string }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.isArchived === "boolean") patch.is_archived = body.isArchived
  if (body.name) patch.name = body.name

  const { error } = await supabase.from("personal_loans").update(patch).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove a loan (payments cascade via FK)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { error } = await supabase.from("personal_loans").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
