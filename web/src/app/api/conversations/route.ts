import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

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

  const { type = "direct", memberIds, name }: { type: string; memberIds: string[]; name?: string } = await req.json()
  if (!memberIds?.length) return NextResponse.json({ error: "memberIds required" }, { status: 400 })

  const admin = createAdminClient()

  if (type === "direct" && memberIds.length === 1) {
    const otherId = memberIds[0]
    const { data: myConvs } = await admin.from("conversation_members")
      .select("conversation_id").eq("user_id", user.id)
    const myIds = (myConvs ?? []).map((r: any) => r.conversation_id)
    if (myIds.length > 0) {
      const { data: shared } = await admin.from("conversation_members")
        .select("conversation_id").eq("user_id", otherId).in("conversation_id", myIds).limit(1).maybeSingle()
      if (shared) {
        const { data: conv } = await admin.from("conversations").select("*").eq("id", (shared as any).conversation_id).single()
        return NextResponse.json({ conversation: conv, existed: true })
      }
    }
  }

  const { data: conv } = await admin.from("conversations")
    .insert({ type, name: name ?? null, created_by: user.id }).select("id").single()

  const allIds = [user.id, ...memberIds.filter((id: string) => id !== user.id)]
  await admin.from("conversation_members").insert(
    allIds.map((uid: string) => ({
      conversation_id: conv!.id,
      user_id: uid,
      role: uid === user.id ? "admin" : "member",
    }))
  )

  return NextResponse.json({ conversation: { id: conv!.id, type, name }, existed: false })
}
