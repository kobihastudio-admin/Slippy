import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOrCreateDirectConversation, validateCreateConversation } from "@/lib/chat-access"

// GET /api/conversations — list my conversations with last message
export async function GET() {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()
  const { data: memberships } = await admin.from("conversation_members")
    .select("conversation_id, last_read_at, conversations(id,type,name,avatar_url,updated_at)")
    .eq("user_id", user.id)
    .limit(50)

  const convIds = (memberships ?? []).map((m: any) => m.conversation_id)
  if (convIds.length === 0) return NextResponse.json({ conversations: [] })

  const { data: lastMsgs } = await admin.from("messages")
    .select("conversation_id, body, msg_type, created_at, sender:sender_id(full_name)")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false })

  const lastMap: Record<string, any> = {}
  for (const m of lastMsgs ?? []) {
    if (!lastMap[(m as any).conversation_id]) lastMap[(m as any).conversation_id] = m
  }

  const { data: allMembers } = await admin.from("conversation_members")
    .select("conversation_id, user_id, users(id,full_name,avatar_url)")
    .in("conversation_id", convIds)
    .neq("user_id", user.id)

  const memberMap: Record<string, any[]> = {}
  for (const m of allMembers ?? []) {
    if (!memberMap[(m as any).conversation_id]) memberMap[(m as any).conversation_id] = []
    memberMap[(m as any).conversation_id].push((m as any).users)
  }

  const conversations = (memberships ?? []).map((m: any) => {
    const conv    = m.conversations
    const lastMsg = lastMap[m.conversation_id]
    const others  = memberMap[m.conversation_id] ?? []
    return {
      id:        conv?.id,
      type:      conv?.type,
      name:      conv?.type === "direct" ? (others[0]?.full_name ?? "Unknown") : conv?.name,
      avatarUrl: conv?.type === "direct" ? others[0]?.avatar_url : conv?.avatar_url,
      updatedAt: conv?.updated_at,
      lastMessage: lastMsg
        ? { body: lastMsg.body, msgType: lastMsg.msg_type, senderName: (lastMsg.sender as any)?.full_name, createdAt: lastMsg.created_at }
        : null,
    }
  }).sort((a: any, b: any) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))

  return NextResponse.json({ conversations })
}

// POST /api/conversations — create direct or group conversation
export async function POST(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const parsed = validateCreateConversation(payload, user.id)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { type, memberIds, name } = parsed

  const admin = createAdminClient()

  if (type === "direct") {
    // The direct room of exactly these two people, or a new one. A shared GROUP (or a trip room) is never reused as a
    // "direct" chat, a failed lookup creates nothing, and the database refuses a second direct room for the same pair
    // (conversations.direct_pair_key), so two simultaneous requests end up in the same room. See chat-access.ts.
    const room = await getOrCreateDirectConversation(admin, user.id, memberIds[0], { name })
    if (!room.ok) {
      console.error("[conversations] could not get or create the direct room")
      return NextResponse.json({ error: "Could not create conversation" }, { status: 500 })
    }
    if (room.created) return NextResponse.json({ conversation: { id: room.id, type, name }, existed: false })
    const { data: existing } = await admin.from("conversations").select("*").eq("id", room.id).maybeSingle()
    return NextResponse.json({ conversation: existing ?? { id: room.id, type, name: null }, existed: true })
  }

  const { data: conv, error: convError } = await admin.from("conversations")
    .insert({ type, name, created_by: user.id }).select("id").single()
  if (convError || !conv) {
    console.error("[conversations] create failed:", convError?.message)
    return NextResponse.json({ error: "Could not create conversation" }, { status: 500 })
  }

  const allIds = [user.id, ...memberIds]
  const { error: membersError } = await admin.from("conversation_members").insert(
    allIds.map((uid: string) => ({
      conversation_id: conv.id,
      user_id: uid,
      role: uid === user.id ? "admin" : "member",
    }))
  )
  if (membersError) {
    // Do not leave an empty room behind.
    console.error("[conversations] adding members failed:", membersError.message)
    await admin.from("conversations").delete().eq("id", conv.id)
    return NextResponse.json({ error: "Could not create conversation" }, { status: 500 })
  }

  return NextResponse.json({ conversation: { id: conv.id, type, name }, existed: false })
}
