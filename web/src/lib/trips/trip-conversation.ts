/**
 * Trip ↔ group-conversation glue for Phase 1 of the Trip Full Loop.
 *
 * Two rules shape everything here:
 *
 *  1. **Exactly one conversation per trip.** Enforced by the UNIQUE index from
 *     migration 085, not by checking-then-inserting. A check-then-insert loses
 *     the race whenever two members open a trip at the same moment or a POST is
 *     retried, and the symptom — a conversation quietly split in two, each half
 *     showing a different subset of messages — is close to unrecoverable once
 *     people have talked in both. So the insert is allowed to fail and the loser
 *     reads the winner's row.
 *
 *  2. **Chat access is conversation membership, never trip participation.**
 *     `trip_participants` is readable by any member of the owning org, so
 *     deriving chat rights from it would seat every colleague in every trip's
 *     private chat. Members are explicit rows in `conversation_members`, which
 *     is what `is_conversation_member()` — the only RLS gate on
 *     conversations/messages — actually tests.
 */

import type { TripDb } from "./trip-access"

async function defaultDb(): Promise<TripDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient() as unknown as TripDb
}

/** Postgres unique-violation. The signal that another request won the race. */
const UNIQUE_VIOLATION = "23505"

export interface TripConversationResult {
  conversationId: string
  /** False when this call created it — useful for tests and for logging. */
  existed: boolean
}

/**
 * Returns the trip's conversation, creating it on first call.
 *
 * Safe to call from anywhere, any number of times, concurrently. Only users
 * with a `trip_participants` row that carries a real `user_id` become members:
 * LINE-only and non-LINE participants have no Slippy account to add, and they
 * keep using the existing share-token/LIFF surfaces.
 */
export async function ensureTripConversation(
  journeyId: string,
  createdBy: string,
  db?: TripDb,
): Promise<TripConversationResult> {
  const admin = db ?? await defaultDb()

  const existing = await admin
    .from("conversations")
    .select("id")
    .eq("journey_id", journeyId)
    .maybeSingle()
  if (existing.data) {
    await syncTripConversationMembers(journeyId, existing.data.id, undefined, admin)
    return { conversationId: existing.data.id, existed: true }
  }

  const { data: journey } = await admin
    .from("life_journeys")
    .select("id, title, cover_emoji")
    .eq("id", journeyId)
    .maybeSingle()
  if (!journey) throw new Error(`Trip ${journeyId} not found`)

  const inserted = await admin
    .from("conversations")
    .insert({
      type:       "group",
      name:       [journey.cover_emoji, journey.title].filter(Boolean).join(" ").trim(),
      journey_id: journeyId,
      created_by: createdBy,
    })
    .select("id")
    .single()

  if (inserted.error) {
    // Lost the race: somebody inserted between our SELECT and our INSERT. The
    // unique index did its job — read theirs rather than reporting a failure.
    if (inserted.error.code === UNIQUE_VIOLATION) {
      const winner = await admin
        .from("conversations")
        .select("id")
        .eq("journey_id", journeyId)
        .single()
      await syncTripConversationMembers(journeyId, winner.data!.id, undefined, admin)
      return { conversationId: winner.data!.id, existed: true }
    }
    throw new Error(`Could not create trip conversation: ${inserted.error.message}`)
  }

  await syncTripConversationMembers(journeyId, inserted.data.id, createdBy, admin)
  return { conversationId: inserted.data.id, existed: false }
}

/**
 * Adds every Slippy-account trip participant as a conversation member.
 *
 * Additive on purpose: it never removes anybody. Removal is a separate,
 * deliberate action — silently dropping someone from the chat because a
 * participant row changed would delete their access to a conversation they took
 * part in, and Phase 1's acceptance criteria only require that *adding or
 * removing a trip member does not silently rewrite finalized* records.
 */
export async function syncTripConversationMembers(
  journeyId: string,
  conversationId: string,
  adminUserId?: string,
  db?: TripDb,
): Promise<number> {
  const admin = db ?? await defaultDb()

  const { data: participants } = await admin
    .from("trip_participants")
    .select("user_id")
    .eq("journey_id", journeyId)
    .not("user_id", "is", null)
    .is("left_at", null)

  const { data: owner } = await admin
    .from("life_journeys")
    .select("user_id")
    .eq("id", journeyId)
    .maybeSingle()

  // The trip owner belongs in the chat even without a participant row — they
  // may have created the trip purely to split someone else's bill.
  const userIds = Array.from(new Set(
    [owner?.user_id, ...(participants ?? []).map((p: { user_id: string }) => p.user_id)].filter(Boolean) as string[],
  ))
  if (userIds.length === 0) return 0

  const { data: already } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
  const present = new Set((already ?? []).map((m: { user_id: string }) => m.user_id))

  const toAdd = userIds.filter(id => !present.has(id))
  if (toAdd.length === 0) return 0

  const { error } = await admin.from("conversation_members").insert(
    toAdd.map(uid => ({
      conversation_id: conversationId,
      user_id:         uid,
      role:            uid === (adminUserId ?? owner?.user_id) ? "admin" : "member",
    })),
  )
  // A concurrent sync may have inserted the same rows first; that is success,
  // not failure.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Could not add trip conversation members: ${error.message}`)
  }
  return toAdd.length
}

// ── Structured system messages ──────────────────────────────────────────────

/**
 * The trip events worth announcing in the chat. Kept as a closed union so the
 * clients can switch on `meta.event` and render an icon/localised string, rather
 * than parsing a human sentence that will change the moment someone edits copy.
 */
export type TripSystemEvent =
  | "trip_created"
  | "member_joined"
  | "member_left"
  | "itinerary_added"
  | "itinerary_updated"
  | "itinerary_removed"
  | "expense_added"
  | "expense_updated"
  | "expense_removed"
  | "settlement_recorded"

export interface TripSystemMessageInput {
  journeyId: string
  event:     TripSystemEvent
  /** Human-readable fallback for clients that don't know this event yet. */
  body:      string
  /** Structured detail — amounts, titles, ids. Never sensitive data. */
  detail?:   Record<string, unknown>
  /** Who caused it, when a person did. Omitted for automated changes. */
  actorId?:  string
}

/**
 * Posts a system message into a trip's conversation.
 *
 * Never throws: a trip change must not be rolled back because its announcement
 * failed, and callers are ordinary API routes whose job is the change itself.
 * Returns false when nothing was posted, so a caller can log it.
 */
export async function postTripSystemMessage(
  input: TripSystemMessageInput,
  db?: TripDb,
): Promise<boolean> {
  try {
    const admin = db ?? await defaultDb()
    const { data: conv } = await admin
      .from("conversations")
      .select("id")
      .eq("journey_id", input.journeyId)
      .maybeSingle()
    // No chat for this trip (created before Phase 1, or a solo split) — nothing
    // to announce, and creating one as a side effect of an edit would surprise
    // everyone involved.
    if (!conv) return false

    const { error } = await admin.from("messages").insert({
      conversation_id: conv.id,
      sender_id:       input.actorId ?? null,
      msg_type:        "system",
      body:            input.body,
      meta:            { event: input.event, journey_id: input.journeyId, ...(input.detail ?? {}) },
    })
    if (error) {
      console.error("[trip-conversation] system message failed:", error.message)
      return false
    }

    // Surface the trip in conversation lists, which sort on updated_at.
    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conv.id)
    return true

  } catch (err) {
    console.error("[trip-conversation] system message threw:", (err as Error).message)
    return false
  }
}
