import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const admin  = createAdminClient()
  const { data } = await admin.from("payment_requests")
    .select("*, requester:requester_id(id,full_name,avatar_url), payer:payer_id(id,full_name,avatar_url)")
    .eq("id", id).maybeSingle()

  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ request: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id }  = await params
  const { action, slipDocId }: { action: string; slipDocId?: string } = await req.json()
  const admin = createAdminClient()

  if (action === "mark_paid") {
    await admin.from("payment_requests").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      ...(slipDocId ? { slip_doc_id: slipDocId } : {}),
    }).eq("id", id)
  } else if (action === "cancel") {
    await admin.from("payment_requests").update({ status: "cancelled" })
      .eq("id", id).eq("requester_id", user.id)
  }

  return NextResponse.json({ ok: true })
}
