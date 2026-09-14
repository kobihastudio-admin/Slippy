import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTripAccess, canManageTrip } from "@/lib/trips/trip-access"
import { ensureTripConversation, syncTripConversationMembers, postTripSystemMessage }
  from "@/lib/trips/trip-conversation"

type Params = { params: Promise<{ id: string }> }

/** Postgres unique violation — the invite was replayed. */
const UNIQUE_VIOLATION = "23505"

/**
 * GET /api/trips/[id]/members — the trip's participants.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data } = await createAdminClient()
    .from("trip_participants")
    .select("id, user_id, display_name, line_user_id, is_host, is_non_line, joined_at")
    .eq("journey_id", tripId)
    .is("left_at", null)
    .order("joined_at", { ascending: true })

  return NextResponse.json({ members: data ?? [], myRole: access.role })
}

/**
 * POST /api/trips/[id]/members — add existing Slippy friends to the trip.
 *
 * Phase 1, "Add existing Slippy friends to a trip" (handoff §9). Three rules,
 * each of them load-bearing:
 *
 *  • Only the owner may invite. Otherwise any participant could pull strangers
 *    into a trip's private chat and reshape everybody's expense split.
 *  • The invitee must already be an accepted friend. Without that, this endpoint
 *    becomes a way to attach any user id in the system to a trip — and the trip
 *    chat is where medical, hotel and location details will live in later
 *    phases. It is not a directory lookup.
 *  • Adding somebody twice is a no-op, not an error. Invites get replayed by
 *    double-taps and retried requests, and the partial unique index from
 *    migration 085 makes the second attempt fail loudly at the database — which
 *    this route translates into "already a member" rather than a 500.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!(await canManageTrip(tripId, user.id))) {
    return NextResponse.json({ error: "Only the trip owner can invite" }, { status: 403 })
  }

  const { userIds } = await req.json() as { userIds?: string[] }
  if (!userIds?.length) {
    return NextResponse.json({ error: "userIds required" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Accepted friendships in either direction.
  const { data: friendships } = await admin
    .from("friendships")
    .select("requester_id, addressee_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

  const friendIds = new Set(
    (friendships ?? []).map(f => f.requester_id === user.id ? f.addressee_id : f.requester_id),
  )

  const invited: string[] = []
  const alreadyMembers: string[] = []
  const notFriends: string[] = []

  for (const uid of Array.from(new Set(userIds))) {
    if (uid === user.id) { alreadyMembers.push(uid); continue }
    if (!friendIds.has(uid)) { notFriends.push(uid); continue }

    const { data: profile } = await admin
      .from("users").select("full_name").eq("id", uid).maybeSingle()

    const { error } = await admin.from("trip_participants").insert({
      journey_id:   tripId,
      user_id:      uid,
      display_name: profile?.full_name ?? "เพื่อน",
      is_non_line:  false,
      is_host:      false,
      amount_owed:  0,
      amount_paid:  0,
    })

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const { data: existing } = await admin
          .from("trip_participants")
          .select("id, left_at")
          .eq("journey_id", tripId)
          .eq("user_id", uid)
          .maybeSingle()
        if (existing?.left_at) {
          const { error: restoreError } = await admin
            .from("trip_participants")
            .update({ left_at: null, joined_at: new Date().toISOString() })
            .eq("id", existing.id)
          if (restoreError) return NextResponse.json({ error: restoreError.message }, { status: 500 })
          invited.push(uid)
        } else {
          alreadyMembers.push(uid)
        }
        continue
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    invited.push(uid)
  }

  // Only touch the chat when somebody actually joined, so a replayed invite
  // does not spam the conversation with duplicate system messages.
  let conversationId: string | null = null
  if (invited.length > 0) {
    try {
      const conv = await ensureTripConversation(tripId, access.role === "owner" ? user.id : user.id)
      conversationId = conv.conversationId
      await syncTripConversationMembers(tripId, conv.conversationId)

      const { data: names } = await admin
        .from("users").select("full_name").in("id", invited)
      const label = (names ?? []).map(n => n.full_name).filter(Boolean).join(", ")
      await postTripSystemMessage({
        journeyId: tripId,
        event:     "member_joined",
        body:      label ? `${label} เข้าร่วมทริปแล้ว` : "มีสมาชิกใหม่เข้าร่วมทริป",
        detail:    { user_ids: invited },
        actorId:   user.id,
      })
    } catch (err) {
      console.error("[trip-members] chat update failed:", (err as Error).message)
    }
  }

  return NextResponse.json({
    invited,
    alreadyMembers,
    notFriends,
    conversationId,
  })
}

/**
 * DELETE /api/trips/[id]/members?userId=... — revoke trip and chat access.
 *
 * The participant row is retained so finalized expenses and settlement history
 * remain stable. Access is revoked by `left_at`, and chat membership is removed
 * explicitly. Only the trip owner can perform this action.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await canManageTrip(tripId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const targetUserId = req.nextUrl.searchParams.get("userId")
  if (!targetUserId) return NextResponse.json({ error: "userId required" }, { status: 400 })
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "The trip owner cannot be removed" }, { status: 409 })
  }

  const admin = createAdminClient()
  const { data: participant } = await admin
    .from("trip_participants")
    .select("id, display_name, left_at")
    .eq("journey_id", tripId)
    .eq("user_id", targetUserId)
    .maybeSingle()
  if (!participant || participant.left_at) {
    return NextResponse.json({ removed: false, alreadyRemoved: true })
  }

  const { error: revokeError } = await admin
    .from("trip_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("id", participant.id)
  if (revokeError) return NextResponse.json({ error: revokeError.message }, { status: 500 })

  const { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("journey_id", tripId)
    .maybeSingle()
  if (conversation) {
    await admin.from("conversation_members")
      .delete()
      .eq("conversation_id", conversation.id)
      .eq("user_id", targetUserId)
  }

  await postTripSystemMessage({
    journeyId: tripId,
    event: "member_left",
    body: `${participant.display_name} ออกจากทริปแล้ว`,
    detail: { user_id: targetUserId },
    actorId: user.id,
  })

  return NextResponse.json({ removed: true, retainedExpenseHistory: true })
}
