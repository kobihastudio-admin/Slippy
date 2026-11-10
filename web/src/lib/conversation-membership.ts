/**
 * "Is this user a member of this conversation?", for routes that write with the ADMIN client (which bypasses RLS).
 *
 * Pass the CALLER's own client, not the admin one: RLS on `conversation_members` then only shows rows of rooms the
 * caller belongs to, which is a second layer on top of the explicit filters below. The answer never fails open: a
 * database error is "error", not "member", and a malformed id is "not-member" without asking the database.
 *
 * Pure with respect to Next and Supabase (the client is passed in), so it is unit-tested with a fake in
 * `src/lib/payment-request-access.test.mjs`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Membership = "member" | "not-member" | "error"

export async function checkConversationMembership(
  db: { from: (table: string) => any },
  conversationId: string,
  userId: string,
): Promise<Membership> {
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(userId)) return "not-member"
  try {
    const { data, error } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) return "error"
    return data ? "member" : "not-member"
  } catch {
    return "error"
  }
}
