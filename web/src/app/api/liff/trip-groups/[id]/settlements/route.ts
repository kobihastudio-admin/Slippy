import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveConnection(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

interface RawParticipant {
  id: string
  name: string
  amount: number
  paid_at: string | null
  line_user_id: string | null
}

function computeSettlements(participants: RawParticipant[], creatorLineUserId: string | null) {
  // Find creator participant
  const creator = participants.find(p => p.line_user_id === creatorLineUserId)
    ?? participants[0]

  if (!creator) return []

  const settlements = participants
    .filter(p => p.id !== creator.id && !p.paid_at)
    .map(p => ({
      fromId: p.id,
      fromName: p.name,
      toId: creator.id,
      toName: creator.name,
      amount: p.amount,
    }))

  return settlements
}

// GET /api/liff/trip-groups/[id]/settlements?lineUserId=X
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const admin = createAdminClient()

  const { data: bill } = await admin.from("split_bills")
    .select("id, creator_id").eq("id", id).eq("category", "trip").maybeSingle()
  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const { data: participants } = await admin.from("split_participants")
    .select("id, name, amount, paid_at, line_user_id")
    .eq("split_bill_id", id)

  const parts: RawParticipant[] = (participants ?? []).map(p => ({
    id: p.id,
    name: p.name,
    amount: Number(p.amount),
    paid_at: p.paid_at,
    line_user_id: p.line_user_id,
  }))

  // Check for existing settlements
  const { data: existing } = await admin.from("trip_settlements")
    .select("id, from_participant_id, to_participant_id, amount, settled, settled_at")
    .eq("split_bill_id", id)

  if (existing && existing.length > 0) {
    const settlements = existing.map(s => {
      const from = parts.find(p => p.id === s.from_participant_id)
      const to = parts.find(p => p.id === s.to_participant_id)
      return {
        id: s.id,
        fromId: s.from_participant_id,
        fromName: from?.name ?? "?",
        toId: s.to_participant_id,
        toName: to?.name ?? "?",
        amount: Number(s.amount),
        settled: s.settled,
        settledAt: s.settled_at,
      }
    })
    return NextResponse.json({ settlements, participants: parts })
  }

  // Compute on-the-fly without saving
  // Find creator's line_user_id from bill.creator_id
  const { data: creatorConn } = await admin.from("line_connections")
    .select("line_user_id").eq("user_id", bill.creator_id).maybeSingle()
  const creatorLineUserId = creatorConn?.line_user_id ?? null

  const computed = computeSettlements(parts, creatorLineUserId).map(s => ({
    id: null,
    ...s,
    settled: false,
    settledAt: null,
  }))

  return NextResponse.json({ settlements: computed, participants: parts })
}

// POST /api/liff/trip-groups/[id]/settlements
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { action } = body as { action: string; lineUserId: string }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 })

  const admin = createAdminClient()

  const { data: bill } = await admin.from("split_bills")
    .select("id, creator_id").eq("id", id).eq("category", "trip").maybeSingle()
  if (!bill) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  if (action === "compute") {
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่คำนวณยอดสุทธิได้" }, { status: 403 })
    }

    const { data: participants } = await admin.from("split_participants")
      .select("id, name, amount, paid_at, line_user_id")
      .eq("split_bill_id", id)

    const parts: RawParticipant[] = (participants ?? []).map(p => ({
      id: p.id,
      name: p.name,
      amount: Number(p.amount),
      paid_at: p.paid_at,
      line_user_id: p.line_user_id,
    }))

    // Find creator's line_user_id
    const { data: creatorConn } = await admin.from("line_connections")
      .select("line_user_id").eq("user_id", bill.creator_id).maybeSingle()
    const creatorLineUserId = creatorConn?.line_user_id ?? null

    const computed = computeSettlements(parts, creatorLineUserId)

    // Clear old settlements
    await admin.from("trip_settlements").delete().eq("split_bill_id", id)

    // Insert new
    if (computed.length > 0) {
      await admin.from("trip_settlements").insert(
        computed.map(s => ({
          split_bill_id: id,
          from_participant_id: s.fromId,
          to_participant_id: s.toId,
          amount: s.amount,
          settled: false,
        }))
      )
    }

    const { data: newSettlements } = await admin.from("trip_settlements")
      .select("id, from_participant_id, to_participant_id, amount, settled, settled_at")
      .eq("split_bill_id", id)

    const result = (newSettlements ?? []).map(s => {
      const from = parts.find(p => p.id === s.from_participant_id)
      const to = parts.find(p => p.id === s.to_participant_id)
      return {
        id: s.id,
        fromId: s.from_participant_id,
        fromName: from?.name ?? "?",
        toId: s.to_participant_id,
        toName: to?.name ?? "?",
        amount: Number(s.amount),
        settled: s.settled,
        settledAt: s.settled_at,
      }
    })

    return NextResponse.json({ ok: true, settlements: result })
  }

  if (action === "mark_settled") {
    const { settlementId } = body as { settlementId: string }
    if (!settlementId) return NextResponse.json({ error: "settlementId required" }, { status: 400 })
    const conn = await resolveConnection(admin, lineUserId)
    if (!conn || conn.user_id !== bill.creator_id) {
      return NextResponse.json({ error: "เฉพาะผู้สร้างกลุ่มเท่านั้นที่ยืนยันการชำระได้" }, { status: 403 })
    }
    await admin.from("trip_settlements")
      .update({ settled: true, settled_at: new Date().toISOString() })
      .eq("id", settlementId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
