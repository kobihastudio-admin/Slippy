import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isUuid, parseMessagesQuery, resolvePostMsgType } from "@/lib/chat-access"

/**
 * This route reads and writes with the ADMIN client (it needs the sender profile join and the notification
 * insert), which bypasses RLS. So membership is checked here, explicitly, with the CALLER's own client: RLS on
 * `conversation_members` only lets a user see rows of rooms they belong to.
 * A non-member gets 404, the same answer as a room that does not exist.
 * Returns a response to send back when access is refused, otherwise `null`.
 */
async function refuseUnlessMember(
  sb: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  userId: string,
): Promise<NextResponse | null> {
  const { data, error } = await sb
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) {
    console.error("[messages] membership check failed:", error.message)
    return NextResponse.json({ error: "Could not check access" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return null
}

// GET /api/conversations/[id]/messages?before=ISO&limit=30
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const query = parseMessagesQuery(req.nextUrl.searchParams)
  if (!query.ok) return NextResponse.json({ error: query.error }, { status: 400 })

  const denied = await refuseUnlessMember(sb, id, user.id)
  if (denied) return denied

  const admin = createAdminClient()
  let q = admin.from("messages")
    .select("id, body, attachment_url, msg_type, meta, created_at, sender:sender_id(id,full_name,avatar_url)")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(query.limit)

  if (query.before) q = q.lt("created_at", query.before)
  const { data, error } = await q
  if (error) {
    console.error("[messages] load failed:", error.message)
    return NextResponse.json({ error: "Could not load messages" }, { status: 500 })
  }
  return NextResponse.json({ messages: (data ?? []).reverse() })
}

// POST /api/conversations/[id]/messages — send message
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Membership first, so a stranger learns nothing about what this endpoint accepts.
  const denied = await refuseUnlessMember(sb, id, user.id)
  if (denied) return denied

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 })
  }
  const { body, msgType, attachmentUrl, meta } = payload as Record<string, unknown>

  // `system`, `payment_request` and `slip` messages are written by server code only, never by a client.
  const type = resolvePostMsgType(msgType)
  if (type === null) return NextResponse.json({ error: "msgType not allowed" }, { status: 400 })
  if ((body != null && typeof body !== "string") || (attachmentUrl != null && typeof attachmentUrl !== "string")) {
    return NextResponse.json({ error: "body and attachmentUrl must be strings" }, { status: 400 })
  }
  if (!body && !attachmentUrl)
    return NextResponse.json({ error: "body or attachmentUrl required" }, { status: 400 })
  const safeMeta = typeof meta === "object" && meta !== null && !Array.isArray(meta) ? meta : {}

  const admin = createAdminClient()
  const { data: msg, error: insertError } = await admin.from("messages").insert({
    conversation_id: id,
    sender_id:       user.id,
    body:            (body as string | null | undefined) ?? null,
    msg_type:        type,
    attachment_url:  (attachmentUrl as string | null | undefined) ?? null,
    meta:            safeMeta,
  }).select("id, created_at").single()
  if (insertError || !msg) {
    console.error("[messages] insert failed:", insertError?.message)
    return NextResponse.json({ error: "Could not send message" }, { status: 500 })
  }

  // Only a message that was really stored moves the room to the top of the list. Never lets a failure here break
  // the send itself.
  const touched = await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id)
  if (touched.error) console.error("[messages] touching the conversation failed:", touched.error.message)

  // Notify every other member of the conversation — the `notifications`
  // table (bell icon + /notifications page) has existed since migration 006
  // but nothing in chat ever called insert on it, so recipients never knew
  // a message arrived unless they happened to have the chat open. Never
  // lets a notification failure break the actual message send.
  try {
    const [{ data: sender }, { data: recipients }] = await Promise.all([
      admin.from("users").select("full_name").eq("id", user.id).single(),
      admin.from("conversation_members").select("user_id").eq("conversation_id", id).neq("user_id", user.id),
    ])
    const text = typeof body === "string" ? body : ""
    const preview = text
      ? (text.length > 80 ? `${text.slice(0, 80)}…` : text)
      : type === "image" ? "ส่งรูปภาพ" : "ส่งไฟล์แนบ"

    if (recipients?.length) {
      await admin.from("notifications").insert(
        recipients.map(r => ({
          user_id: r.user_id,
          type:    "new_message",
          title:   `ข้อความใหม่จาก ${sender?.full_name ?? "เพื่อน"}`,
          body:    preview,
          metadata: { conversationId: id, messageId: msg?.id },
        }))
      )
    }
  } catch (err) {
    console.error("[messages] notification insert failed:", err)
  }

  return NextResponse.json({ ok: true, message: msg })
}
