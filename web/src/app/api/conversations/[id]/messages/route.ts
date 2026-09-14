import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/conversations/[id]/messages?before=ISO&limit=30
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id }  = await params
  const before  = req.nextUrl.searchParams.get("before")
  const limit   = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30), 100)
  const admin   = createAdminClient()

  let q = admin.from("messages")
    .select("id, body, attachment_url, msg_type, meta, created_at, sender:sender_id(id,full_name,avatar_url)")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (before) q = q.lt("created_at", before)
  const { data } = await q
  return NextResponse.json({ messages: (data ?? []).reverse() })
}

// POST /api/conversations/[id]/messages — send message
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { body, msgType = "text", attachmentUrl, meta }: {
    body?: string; msgType?: string; attachmentUrl?: string; meta?: object
  } = await req.json()

  if (!body && !attachmentUrl)
    return NextResponse.json({ error: "body or attachmentUrl required" }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: msg }] = await Promise.all([
    admin.from("messages").insert({
      conversation_id: id,
      sender_id:       user.id,
      body:            body ?? null,
      msg_type:        msgType,
      attachment_url:  attachmentUrl ?? null,
      meta:            meta ?? {},
    }).select("id, created_at").single(),
    admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id),
  ])

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
    const preview = body
      ? (body.length > 80 ? `${body.slice(0, 80)}…` : body)
      : msgType === "image" ? "ส่งรูปภาพ" : "ส่งไฟล์แนบ"

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
