import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVerifiedLineUserId, liffUnauthorized } from "@/lib/liff-auth"

async function resolveConn(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin
    .from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data
}

// GET /api/liff/community/[id]?lineUserId=X — group detail + members list
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()

  const { data: group, error } = await admin
    .from("community_groups")
    .select("id, name, description, type, emoji, share_token, created_at, status, creator_id")
    .eq("id", id)
    .single()

  if (error || !group) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })

  const { data: members } = await admin
    .from("community_members")
    .select("id, display_name, line_user_id, role, joined_at")
    .eq("group_id", id)
    .order("joined_at", { ascending: true })

  const conn = await resolveConn(admin, lineUserId)

  const isAdmin =
    (conn && group.creator_id === conn.user_id) ||
    (members ?? []).some((m: any) => m.line_user_id === lineUserId && m.role === "admin")

  const isMember = (members ?? []).some((m: any) => m.line_user_id === lineUserId)

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      type: group.type,
      emoji: group.emoji,
      shareToken: group.share_token,
      createdAt: group.created_at,
    },
    members: (members ?? []).map((m: any) => ({
      id: m.id,
      displayName: m.display_name,
      lineUserId: m.line_user_id,
      role: m.role,
      joinedAt: m.joined_at,
    })),
    isAdmin,
    isMember,
  })
}

// POST /api/liff/community/[id] — actions: join | leave | update
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    action: "join" | "leave" | "update"
    lineUserId: string
    displayName?: string
    shareToken?: string
    name?: string
    description?: string
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { action } = body

  if (!action) {
    return NextResponse.json({ error: "action and lineUserId required" }, { status: 400 })
  }

  const admin = createAdminClient()

  if (action === "join") {
    const { shareToken, displayName } = body

    const { data: group } = await admin
      .from("community_groups")
      .select("id, share_token")
      .eq("id", id)
      .single()

    if (!group) return NextResponse.json({ error: "ไม่พบกลุ่ม" }, { status: 404 })
    if (group.share_token !== shareToken) {
      return NextResponse.json({ error: "ลิงก์เชิญไม่ถูกต้อง" }, { status: 403 })
    }

    // Check if already a member
    const { data: existing } = await admin
      .from("community_members")
      .select("id")
      .eq("group_id", id)
      .eq("line_user_id", lineUserId)
      .maybeSingle()

    if (existing) return NextResponse.json({ ok: true, alreadyMember: true })

    const conn = await resolveConn(admin, lineUserId)

    await admin.from("community_members").insert({
      group_id: id,
      user_id: conn?.user_id ?? null,
      line_user_id: lineUserId,
      display_name: displayName ?? conn?.display_name ?? "สมาชิก",
      role: "member",
    })

    return NextResponse.json({ ok: true })
  }

  if (action === "leave") {
    // Prevent last admin from leaving
    const { data: admins } = await admin
      .from("community_members")
      .select("id, line_user_id")
      .eq("group_id", id)
      .eq("role", "admin")

    const isLastAdmin =
      (admins ?? []).length === 1 &&
      (admins ?? []).some((a: any) => a.line_user_id === lineUserId)

    if (isLastAdmin) {
      return NextResponse.json({ error: "ไม่สามารถออกได้ เนื่องจากคุณเป็น admin คนเดียว" }, { status: 400 })
    }

    await admin
      .from("community_members")
      .delete()
      .eq("group_id", id)
      .eq("line_user_id", lineUserId)

    return NextResponse.json({ ok: true })
  }

  if (action === "update") {
    const { name, description } = body

    // Verify admin
    const conn = await resolveConn(admin, lineUserId)
    const { data: group } = await admin
      .from("community_groups")
      .select("creator_id")
      .eq("id", id)
      .single()

    const { data: member } = await admin
      .from("community_members")
      .select("role")
      .eq("group_id", id)
      .eq("line_user_id", lineUserId)
      .maybeSingle()

    const isAdmin =
      (conn && group?.creator_id === conn.user_id) || member?.role === "admin"
    if (!isAdmin) return NextResponse.json({ error: "เฉพาะ admin เท่านั้น" }, { status: 403 })

    const updates: Record<string, string> = {}
    if (name) updates.name = name
    if (description !== undefined) updates.description = description

    await admin.from("community_groups").update(updates).eq("id", id)

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
