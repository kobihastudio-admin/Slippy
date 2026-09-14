import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isOrgMember }       from "@/lib/require-org-member"
import { createTripExpense } from "@/lib/trip-settlement"

type Params = { params: Promise<{ sessionId: string }> }

// Fire-and-forget push to the trip's LINE group — a failed notification
// shouldn't fail the add/remove/close action itself, so errors are logged
// and swallowed here rather than surfaced to the caller.
async function notifyPreorder(body: {
  sessionId: string; event: "item_added" | "item_removed" | "closed"
  participantName?: string; itemName?: string; price?: number; totalAmount?: number
}) {
  if (!process.env.API_BASE_URL || !process.env.INTERNAL_API_KEY) return
  try {
    await fetch(`${process.env.API_BASE_URL}/trips/preorder/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error("[preorder:notify] failed:", err)
  }
}

async function requireMember(sessionId: string, userId: string) {
  const admin = createAdminClient()
  const { data: session } = await admin.from("preorder_sessions")
    .select("id, journey_id, status, kind, life_journeys(organization_id)")
    .eq("id", sessionId).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgId = (session as any)?.life_journeys?.organization_id
  if (!session || !orgId || !(await isOrgMember(userId, orgId))) return { admin: null, session: null }
  return { admin, session }
}

// GET — session detail with items grouped by participant
export async function GET(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { admin, session } = await requireMember(sessionId, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: items } = await admin.from("preorder_items")
    .select("id, participant_id, name, price, qty, note, created_at, trip_participants(id, display_name)")
    .eq("session_id", sessionId)
    .order("created_at")

  const { data: participants } = await admin.from("trip_participants")
    .select("id, display_name, user_id").eq("journey_id", session!.journey_id)

  return NextResponse.json({
    session: { id: session!.id, journeyId: session!.journey_id, status: session!.status, kind: session!.kind },
    items: items ?? [],
    participants: participants ?? [],
  })
}

// POST — add_item | remove_item (self-service — any org member can act on
// behalf of any participant, same trust level as the rest of the trip tool)
export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { admin, session } = await requireMember(sessionId, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (session!.status !== "open") return NextResponse.json({ error: "รอบนี้ปิดรับออเดอร์แล้ว" }, { status: 400 })

  const body = await req.json() as {
    action: "add_item" | "remove_item"
    participantId?: string; name?: string; price?: number; qty?: number; note?: string
    itemId?: string
  }

  if (body.action === "add_item") {
    if (!body.participantId || !body.name?.trim() || !body.price) {
      return NextResponse.json({ error: "participantId, name, price required" }, { status: 400 })
    }
    const { data: item, error } = await admin.from("preorder_items").insert({
      session_id: sessionId, participant_id: body.participantId,
      name: body.name, price: body.price, qty: body.qty ?? 1, note: body.note ?? null,
    }).select("id, name, price, qty").single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: p } = await admin.from("trip_participants").select("display_name").eq("id", body.participantId).single()
    notifyPreorder({ sessionId, event: "item_added", participantName: p?.display_name, itemName: body.name, price: body.price })

    return NextResponse.json({ item })
  }

  if (body.action === "remove_item") {
    if (!body.itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })
    const { data: removed } = await admin.from("preorder_items")
      .select("name, trip_participants(display_name)").eq("id", body.itemId).single()
    await admin.from("preorder_items").delete().eq("id", body.itemId).eq("session_id", sessionId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participantName = (removed as any)?.trip_participants?.display_name
    if (removed) notifyPreorder({ sessionId, event: "item_removed", participantName, itemName: removed.name })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}

// PATCH — close (finalize into a real trip_expense) | cancel | reopen
export async function PATCH(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { admin, session } = await requireMember(sessionId, user.id)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json() as { action: "close" | "cancel"; paidById?: string; title?: string; currency?: string }

  if (body.action === "cancel") {
    await admin.from("preorder_sessions").update({ status: "cancelled" }).eq("id", sessionId)
    return NextResponse.json({ ok: true })
  }

  if (body.action === "close") {
    if (session!.status !== "open") return NextResponse.json({ error: "รอบนี้ปิดไปแล้ว" }, { status: 400 })
    if (!body.paidById) return NextResponse.json({ error: "ระบุคนที่จ่ายเงินไปก่อน" }, { status: 400 })

    const { data: items } = await admin.from("preorder_items")
      .select("participant_id, price, qty").eq("session_id", sessionId)

    if (!items?.length) return NextResponse.json({ error: "ยังไม่มีใครสั่งเลย" }, { status: 400 })

    // Sum each participant's own items — this becomes their share, no
    // manual assignment needed since everyone already tagged themselves.
    const totals: Record<string, number> = {}
    for (const it of items) {
      totals[it.participant_id] = (totals[it.participant_id] ?? 0) + Number(it.price) * it.qty
    }
    const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0)
    const { data: sessRow } = await admin.from("preorder_sessions").select("title, kind").eq("id", sessionId).single()

    try {
      const expenseId = await createTripExpense({
        tripId:       session!.journey_id,
        paidById:     body.paidById,
        title:        body.title ?? sessRow?.title ?? "สั่งของกลุ่ม",
        amount:       Math.round(grandTotal * 100) / 100,
        category:     sessRow?.kind === "shopping" ? "other" : "food",
        splitMode:    "individual",
        splitWith:    Object.keys(totals),
        splitValues:  totals,
        currency:     body.currency,
        note:         "รวมจากรายการที่แต่ละคนสั่งเอง",
      }, admin)

      await admin.from("preorder_sessions").update({
        status: "closed", paid_by_id: body.paidById, expense_id: expenseId, closed_at: new Date().toISOString(),
      }).eq("id", sessionId)

      notifyPreorder({ sessionId, event: "closed", totalAmount: Math.round(grandTotal * 100) / 100 })

      return NextResponse.json({ ok: true, expenseId })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "ปิดรับออเดอร์ไม่สำเร็จ" }, { status: 400 })
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
