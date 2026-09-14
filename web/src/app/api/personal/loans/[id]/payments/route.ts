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

// POST — log a payment against a loan. Interest/principal split is NOT
// stored here — it's derived at read time by web/src/lib/loan-ledger.ts.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as { paymentDate?: string; amount?: number; note?: string }
  if (!body.paymentDate || !body.amount || body.amount <= 0) {
    return NextResponse.json({ error: "Missing paymentDate/amount" }, { status: 400 })
  }

  // Ownership check — RLS also enforces this, but a friendlier 404 beats a
  // silent insert failure if the loan id doesn't belong to the caller.
  const { data: loan } = await supabase.from("personal_loans").select("id").eq("id", id).maybeSingle()
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 })

  const { data, error } = await supabase
    .from("personal_loan_payments")
    .insert({
      loan_id:      id,
      user_id:      user.id,
      payment_date: body.paymentDate,
      amount:       body.amount,
      note:         body.note ?? null,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
