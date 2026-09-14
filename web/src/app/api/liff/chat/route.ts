import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveUser(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin
    .from("line_connections")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data?.user_id ?? null
}

// GET /api/liff/chat?lineUserId=X
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const conversationId = req.nextUrl.searchParams.get("conversationId")
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 40), 100)
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId) return NextResponse.json({ needsConnect: true, conversations: [] })

  if (conversationId) {
    const { data: membership } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle()

    if (!membership) return NextResponse.json({ error: "Conversation access denied" }, { status: 403 })

    const { data: messages, error } = await admin
      .from("messages")
      .select("id, body, sender_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ messages: (messages ?? []).reverse() })
  }

  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id, conversations(id,type,name,updated_at)")
    .eq("user_id", userId)
    .limit(30)

  const convIds = (memberships ?? []).map((m: any) => m.conversation_id)
  let lastMap: Record<string, string> = {}

  if (convIds.length > 0) {
    const { data: msgs } = await admin
      .from("messages")
      .select("conversation_id, body")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false })
    for (const m of msgs ?? []) {
      if (!lastMap[(m as any).conversation_id]) lastMap[(m as any).conversation_id] = (m as any).body ?? ""
    }
  }

  const conversations = (memberships ?? []).map((m: any) => ({
    id: m.conversation_id,
    name: (m.conversations as any)?.name ?? "การสนทนา",
    lastMessage: lastMap[m.conversation_id] ?? "",
    updatedAt: (m.conversations as any)?.updated_at ?? "",
  }))

  return NextResponse.json({ conversations, userId })
}

// POST /api/liff/chat — { lineUserId, conversationId, body }
export async function POST(req: NextRequest) {
  const payload = await req.json()
  const lineUserId = getVerifiedLineUserId(req, payload.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { conversationId, body } = payload
  if (!conversationId || !body)
    return NextResponse.json({ error: "lineUserId, conversationId, body required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId) return NextResponse.json({ needsConnect: true }, { status: 403 })

  const { data: membership } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: "Conversation access denied" }, { status: 403 })

  await Promise.all([
    admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: userId,
      body,
      msg_type: "text",
    }),
    admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId),
  ])

  return NextResponse.json({ ok: true })
}
