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
 * Types the web client sends. This is defense in depth for THIS route only: `system`, `payment_request` and `slip`
 * are meant to be written by server code, but it is NOT a security boundary. The RLS insert policy on `messages`
 * (055) only checks `sender_id = auth.uid()` and membership, so a member can still insert those types directly
 * through PostgREST with their own JWT (iOS writes messages that way). Closing that needs the RLS `WITH CHECK` to
 * list the allowed types, which is a schema/RLS change that has not been approved.
 *
 * Also NOTE: the production CHECK on `messages.msg_type` is text/image/payment_request/slip/system. `video` and
 * `file` are what the web client sends but the database rejects them, so those sends fail (now with a 500 and the
 * client's "send failed" toast; before, the route answered 200 although nothing was stored).
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
