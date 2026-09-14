import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getTripAccess } from "@/lib/trips/trip-access"
import { ensureTripConversation } from "@/lib/trips/trip-conversation"

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/trips/[id]/conversation — the trip's chat, if it has one.
 *
 * Read-only, so it never creates: opening a trip must not be what brings a
 * conversation into existence, or every glance at somebody else's trip would
 * leave a trace.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await getTripAccess(tripId, user.id)
  // 404, not 403: a stranger should not learn whether a trip id is real.
  if (!access.allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { createAdminClient } = await import("@/lib/supabase/admin")
  const { data: conv } = await createAdminClient()
    .from("conversations")
    .select("id, name, updated_at")
    .eq("journey_id", tripId)
    .maybeSingle()

  return NextResponse.json({ conversation: conv ?? null })
}

/**
 * POST /api/trips/[id]/conversation — ensure the chat exists, idempotently.
 *
 * Exists because trips created before migration 085 have no conversation, and
 * because trip creation treats chat setup as best-effort. Calling this twice is
 * indistinguishable from calling it once — the response says which happened via
 * `existed`, and the UNIQUE index makes that true even under concurrent calls.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const result = await ensureTripConversation(tripId, user.id)
    return NextResponse.json({
      conversationId: result.conversationId,
      existed:        result.existed,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
