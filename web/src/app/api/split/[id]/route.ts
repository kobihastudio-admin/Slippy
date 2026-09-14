import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"

// GET — bill detail with participants, share_token, and linked line items
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: bill, error } = await supabase
    .from("split_bills")
    .select(`
      id, title, total_amount, vat_amount, note, status,
      share_token, document_id, created_at,
      split_participants(id, name, email, amount, paid_at, line_user_id, is_non_line)
    `)
    .eq("id", id)
    .single()

  if (error || !bill) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Fetch linked document line items if any
  let lineItems: object[] = []
  if (bill.document_id) {
    const { data: items } = await supabase
      .from("document_line_items")
      .select("id, description, quantity, unit_price, amount, sort_order")
      .eq("document_id", bill.document_id)
      .order("sort_order")

    // Fetch claims for each item
    const { data: claims } = await supabase
      .from("split_item_claims")
      .select("line_item_id, participant_id, claimer_name")
      .eq("split_bill_id", id)

    lineItems = (items ?? []).map(item => ({
      ...item,
      claimed_by: claims?.find(c => c.line_item_id === item.id) ?? null,
    }))
  }

  return NextResponse.json({ bill, lineItems })
}

// PATCH — update participant (mark paid/unpaid)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    action: "mark_paid" | "mark_unpaid" | "assign_item" | "finalize" | "remove_participant" | "reject_proof"
    participantId?: string
    lineItemId?:    string
  }

  if (body.action === "mark_paid" || body.action === "mark_unpaid") {
    const admin = createAdminClient()
    await admin.from("split_participants").update({
      paid_at: body.action === "mark_paid" ? new Date().toISOString() : null,
    }).eq("id", body.participantId!).eq("split_bill_id", id)

    // Push LINE notification to participant's LINE account if available
    if (body.action === "mark_paid") {
      try {
        const { data: p } = await admin.from("split_participants")
          .select("name, line_user_id, amount")
          .eq("id", body.participantId!).single()
        const { data: bill } = await admin.from("split_bills")
          .select("title, line_group_id").eq("id", id).single()
        if (p?.line_user_id) {
          const apiBase    = process.env.API_BASE_URL ?? "https://slippy-api.vercel.app"
          const internalKey = process.env.INTERNAL_API_KEY ?? ""
          await fetch(`${apiBase}/split/notify`, {
            method:  "POST",
            headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
            body:    JSON.stringify({
              billId:        id,
              event:         "paid",
              lineUserId:    p.line_user_id,
              participantName: p.name,
              amount:        p.amount,
              billTitle:     bill?.title,
            }),
          }).catch(() => { /* non-critical */ })
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ ok: true })
  }

  // reject_proof — clear a participant's uploaded slip so they can re-upload,
  // without marking them as paid.
  if (body.action === "reject_proof") {
    if (!body.participantId) return NextResponse.json({ error: "Missing participantId" }, { status: 400 })
    const admin = createAdminClient()
    await admin.from("split_participants").update({
      payment_proof_url: null,
      paid_at:           null,
    }).eq("id", body.participantId).eq("split_bill_id", id)
    return NextResponse.json({ ok: true })
  }

  if (body.action === "assign_item") {
    const admin = createAdminClient()
    await admin.from("split_item_claims").upsert({
      split_bill_id:  id,
      line_item_id:   body.lineItemId!,
      participant_id: body.participantId!,
    }, { onConflict: "split_bill_id,line_item_id" })
    return NextResponse.json({ ok: true })
  }

  if (body.action === "finalize") {
    await supabase.from("split_bills").update({ status: "finalized" }).eq("id", id)

    // Was previously silent — closing a bill never told the group at all,
    // unlike the equivalent sport-session finalize action which already
    // pushes a closure card. Same fire-and-forget pattern used elsewhere in
    // this file (see mark_paid above).
    if (process.env.API_BASE_URL && process.env.INTERNAL_API_KEY) {
      fetch(`${process.env.API_BASE_URL}/split/notify`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
        body:    JSON.stringify({ billId: id, event: "finalize" }),
      }).catch(() => { /* non-critical */ })
    }

    return NextResponse.json({ ok: true })
  }

  if (body.action === "remove_participant") {
    if (!body.participantId) return NextResponse.json({ error: "Missing participantId" }, { status: 400 })
    const admin = createAdminClient()

    // Remove participant
    const { error: delErr } = await admin
      .from("split_participants")
      .delete()
      .eq("id", body.participantId)
      .eq("split_bill_id", id)

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    // Recalculate even split among remaining participants
    const { data: remaining } = await admin
      .from("split_participants")
      .select("id")
      .eq("split_bill_id", id)

    const { data: bill } = await admin
      .from("split_bills")
      .select("total_amount")
      .eq("id", id)
      .single()

    if (remaining?.length && bill?.total_amount) {
      const evenAmt = +(Number(bill.total_amount) / remaining.length).toFixed(2)
      await admin
        .from("split_participants")
        .update({ amount: evenAmt })
        .eq("split_bill_id", id)
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

// DELETE — delete bill
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await supabase.from("split_bills").delete().eq("id", id)
  return NextResponse.json({ ok: true })
}
