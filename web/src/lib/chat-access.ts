/**
 * Pure rules for the chat API routes (no network, no Next, no Supabase), so they can be unit-tested with
 * `node --experimental-strip-types --test src/lib/chat-access.test.mjs`.
 *
 * What these protect (docs/superpowers/specs/2026-10-18-friends-chat-design.md §2):
 *  - the messages route reads and writes with the admin client, so it must validate everything it forwards;
 *  - a "direct" room is a room of type `direct` with exactly two members, never a shared group;
 *  - a client must not be able to forge `system` / `payment_request` / `slip` messages through the send endpoint.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

// ── GET /api/conversations/[id]/messages?limit=&before= ─────────────────────

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
// date-time with an explicit offset. Fractions are kept as given: Postgres timestamps have microseconds and the
// cursor must not be rounded (a rounded cursor would skip messages that share the same millisecond).
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
// `…12.5+00:00` sent without percent-encoding arrives as `…12.5 00:00` (a "+" in a query string means a space).
const SPACE_FOR_PLUS_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+) (\d{2}:\d{2})$/

export type MessagesQuery =
  | { ok: true; limit: number; before: string | null }
  | { ok: false; error: string }

export function parseMessagesQuery(params: URLSearchParams): MessagesQuery {
  if (params.getAll("limit").length > 1 || params.getAll("before").length > 1) {
    return { ok: false, error: "repeated parameter" }
  }

  let limit = DEFAULT_LIMIT
  if (params.has("limit")) {
    const raw = params.get("limit") ?? ""
    if (!/^\d+$/.test(raw)) return { ok: false, error: "limit must be a positive integer" }
    const n = Number(raw)
    if (n < 1) return { ok: false, error: "limit must be a positive integer" }
    limit = Math.min(n, MAX_LIMIT)
  }

  let before: string | null = null
  if (params.has("before")) {
    const repaired = (params.get("before") ?? "").replace(SPACE_FOR_PLUS_RE, "$1+$2")
    if (!CURSOR_RE.test(repaired) || Number.isNaN(Date.parse(repaired))) {
      return { ok: false, error: "before must be an ISO date-time" }
    }
    before = repaired
  }
  return { ok: true, limit, before }
}

// ── POST /api/conversations/[id]/messages ───────────────────────────────────

/**
 * Types the web client sends. `system`, `payment_request` and `slip` are written by server code (service role),
 * never by a client. This allowlist is the first line for THIS route; the database enforces the same set for members:
 * migration 20261110130000_messages_types_and_insert_policy (applied 2026-11-11) makes the RLS insert policy
 * `messages_member_insert` accept only text/image/video/file with the member's own JWT, so a member can no longer
 * insert the server-only types directly through PostgREST (iOS writes messages that way, with `text` only).
 * Keep this list and that policy in step.
 *
 * The same migration added `video` and `file` to the `messages.msg_type` CHECK, so those sends are stored now. Before
 * it the CHECK rejected them and the route failed with a 500 (earlier still it answered 200 with nothing stored).
 */
const POSTABLE_MSG_TYPES = ["text", "image", "video", "file"] as const

/** `undefined` means "not given" → `text`. Anything outside the allowlist → `null`. */
export function resolvePostMsgType(value: unknown): string | null {
  if (value === undefined) return "text"
  if (typeof value === "string" && (POSTABLE_MSG_TYPES as readonly string[]).includes(value)) return value
  return null
}

// ── direct rooms ────────────────────────────────────────────────────────────

export type DirectCandidate = { id: string; type: string; memberIds: string[] }

/**
 * The room that is the direct chat of exactly `me` and `other`: type `direct` and no other member.
 * A shared group (or a direct-typed room with a third member) is never returned. First suitable room in the
 * given order wins, so callers should pass candidates oldest first.
 */
export function pickDirectConversation(candidates: DirectCandidate[], me: string, other: string): string | null {
  const a = me.toLowerCase()
  const b = other.toLowerCase()
  if (a === b) return null
  for (const room of candidates) {
    if (room.type !== "direct") continue
    const members = new Set(room.memberIds.map((m) => m.toLowerCase()))
    if (members.size === 2 && members.has(a) && members.has(b)) return room.id
  }
  return null
}

export type DirectLookup = { ok: true; id: string | null } | { ok: false }

/**
 * Looks up the direct room of exactly `me` and `other` through `db` (a Supabase-like client; pass the ADMIN client in
 * server code). Rooms both are in are narrowed to type=direct with their member lists, then pickDirectConversation()
 * decides, so a shared group or trip room is never used as the private chat.
 *
 * It FAILS CLOSED: a database error is `{ ok: false }`, never "no room", because a caller that reads "no room" goes
 * on to create one and would leave a duplicate behind. `{ ok: true, id: null }` means "looked, and there is none".
 */
export async function findDirectConversationId(
  db: { from: (table: string) => any },
  me: string,
  other: string,
): Promise<DirectLookup> {
  if (!isUuid(me) || !isUuid(other)) return { ok: false }
  if (me.toLowerCase() === other.toLowerCase()) return { ok: true, id: null }
  try {
    const mine = await db.from("conversation_members").select("conversation_id").eq("user_id", me)
    if (mine.error) return { ok: false }
    const myIds: string[] = (mine.data ?? []).map((r: { conversation_id: string }) => r.conversation_id)
    if (myIds.length === 0) return { ok: true, id: null }

    const theirs = await db.from("conversation_members").select("conversation_id")
      .eq("user_id", other).in("conversation_id", myIds)
    if (theirs.error) return { ok: false }
    const sharedIds: string[] = (theirs.data ?? []).map((r: { conversation_id: string }) => r.conversation_id)
    if (sharedIds.length === 0) return { ok: true, id: null }

    const rooms = await db.from("conversations")
      .select("id, type, conversation_members(user_id)")
      .in("id", sharedIds).eq("type", "direct")
      .order("created_at", { ascending: true })
    if (rooms.error) return { ok: false }
    const candidates: DirectCandidate[] = (rooms.data ?? []).map(
      (r: { id: string; type: string; conversation_members?: { user_id: string }[] }) => ({
        id: r.id,
        type: r.type,
        memberIds: (r.conversation_members ?? []).map((m) => m.user_id),
      }),
    )
    return { ok: true, id: pickDirectConversation(candidates, me, other) }
  } catch {
    return { ok: false }
  }
}

// ── POST /api/conversations ─────────────────────────────────────────────────

const MAX_NAME_LENGTH = 100

export type CreateConversation =
  | { ok: true; type: "direct" | "group"; memberIds: string[]; name: string | null }
  | { ok: false; error: string }

/** `memberIds` in the result are the OTHER people (lower-case, deduplicated, never the caller). */
export function validateCreateConversation(body: unknown, me: string): CreateConversation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" }
  }
  const { type = "direct", memberIds, name } = body as Record<string, unknown>
  if (type !== "direct" && type !== "group") return { ok: false, error: "type must be direct or group" }
  if (!Array.isArray(memberIds) || !memberIds.every(isUuid)) {
    return { ok: false, error: "memberIds must be an array of uuids" }
  }

  const self = me.toLowerCase()
  const others = [...new Set((memberIds as string[]).map((m) => m.toLowerCase()))].filter((m) => m !== self)
  if (type === "direct" && others.length !== 1) return { ok: false, error: "a direct chat needs exactly one other person" }
  if (type === "group" && others.length < 1) return { ok: false, error: "a group needs at least one other person" }

  let cleanName: string | null = null
  if (name !== undefined && name !== null) {
    if (typeof name !== "string") return { ok: false, error: "name must be a string" }
    const trimmed = name.trim()
    if (trimmed.length > MAX_NAME_LENGTH) return { ok: false, error: "name is too long" }
    cleanName = trimmed || null
  }
  return { ok: true, type, memberIds: others, name: cleanName }
}
