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

// GET — list the current user's loans (RLS scopes rows to auth.uid() = user_id)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("personal_loans")
    .select("id, name, lender, principal, annual_rate_pct, term_months, start_date, is_archived, created_at")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ loans: data ?? [] })
}

// POST — create a loan record
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    name?: string
    lender?: string
    principal?: number
    annualRatePct?: number
    termMonths?: number
    startDate?: string
  }

  if (!body.name || !body.principal || !body.annualRatePct || !body.termMonths || !body.startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("personal_loans")
    .insert({
      user_id:         user.id,
      name:            body.name,
      lender:          body.lender ?? null,
      principal:       body.principal,
      annual_rate_pct: body.annualRatePct,
      term_months:     body.termMonths,
      start_date:      body.startDate,
    })
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
