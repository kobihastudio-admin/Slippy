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

// GET — list split bills for an org (with participants)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  const { data: bills, error } = await supabase
    .from("split_bills")
    .select(`
      id, title, total_amount, vat_amount, note, status, share_token,
      created_at, document_id, line_group_id,
      split_participants(id, name, email, amount, paid_at, line_user_id, is_non_line)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bills: bills ?? [] })
}

// POST — create a new split bill with participants
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    orgId:        string
    title:        string
    totalAmount:  number
    note?:        string
    documentId?:  string
    participants: { name: string; email?: string; amount: number }[]
  }

  const { orgId, title, totalAmount, note, documentId, participants } = body
  if (!orgId || !title || !participants?.length) {
    return NextResponse.json({ error: "orgId, title, participants required" }, { status: 400 })
  }

  const lineGroupId = (body as any).lineGroupId as string | undefined

  // Create bill
  const { data: bill, error: billErr } = await supabase
    .from("split_bills")
    .insert({
      organization_id: orgId,
      creator_id:      user.id,
      document_id:     documentId ?? null,
      title,
      total_amount:    totalAmount,
      note:            note ?? null,
      line_group_id:   lineGroupId ?? null,
    })
    .select("id, share_token")
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: billErr?.message ?? "Failed to create bill" }, { status: 500 })
  }

  // Insert participants
  const { error: partsErr } = await supabase
    .from("split_participants")
    .insert(
      participants.map(p => ({
        split_bill_id: bill.id,
        name:          p.name,
        email:         p.email ?? null,
        amount:        p.amount,
      }))
    )

  if (partsErr) return NextResponse.json({ error: partsErr.message }, { status: 500 })

  // Push LINE notification if created from LINE group
  if (lineGroupId) {
    try {
      const internalKey = process.env.INTERNAL_API_KEY ?? ""
      const apiBase     = process.env.API_BASE_URL ?? "https://slippy-api.vercel.app"
      await fetch(`${apiBase}/split/notify`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
        body:    JSON.stringify({ billId: bill.id, event: "created" }),
      }).catch(() => { /* non-critical */ })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ billId: bill.id, shareToken: bill.share_token }, { status: 201 })
}

// PATCH — mark a participant as paid (or unpaid)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { participantId, paid } = await req.json() as { participantId: string; paid: boolean }
  if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })

  const { error } = await supabase
    .from("split_participants")
    .update({ paid_at: paid ? new Date().toISOString() : null })
    .eq("id", participantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — delete an entire split bill
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { billId } = await req.json() as { billId: string }
  if (!billId) return NextResponse.json({ error: "billId required" }, { status: 400 })

  const { error } = await supabase
    .from("split_bills")
    .delete()
    .eq("id", billId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
