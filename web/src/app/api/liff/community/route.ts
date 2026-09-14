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

// GET /api/liff/community?lineUserId=X — list groups user is in (creator or member)
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin = createAdminClient()

  // Find all group_ids this user is a member of
  const { data: memberRows } = await admin
    .from("community_members")
    .select("group_id, role")
    .eq("line_user_id", lineUserId)

  const groupIds = (memberRows ?? []).map((r: any) => r.group_id)
  const roleMap: Record<string, string> = {}
  for (const r of memberRows ?? []) roleMap[r.group_id] = r.role

  // Also find groups created by this user via line_connections
  const conn = await resolveConn(admin, lineUserId)

  let creatorGroupIds: string[] = []
  if (conn) {
    const { data: creatorGroups } = await admin
      .from("community_groups")
      .select("id")
      .eq("creator_id", conn.user_id)
    creatorGroupIds = (creatorGroups ?? []).map((g: any) => g.id)
  }

  const allGroupIds = [...new Set([...groupIds, ...creatorGroupIds])]
  if (allGroupIds.length === 0) return NextResponse.json({ groups: [] })

  const { data: groups } = await admin
    .from("community_groups")
    .select("id, name, description, type, emoji, share_token, created_at, status, creator_id")
    .in("id", allGroupIds)
    .order("created_at", { ascending: false })

  // Get member counts
  const { data: memberCounts } = await admin
    .from("community_members")
    .select("group_id")
    .in("group_id", allGroupIds)

  const countMap: Record<string, number> = {}
  for (const m of memberCounts ?? []) {
    countMap[m.group_id] = (countMap[m.group_id] ?? 0) + 1
  }

  const result = (groups ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    emoji: g.emoji,
    shareToken: g.share_token,
    memberCount: countMap[g.id] ?? 0,
    role: conn && g.creator_id === conn.user_id ? "admin" : (roleMap[g.id] ?? "member"),
    createdAt: g.created_at,
  }))

  return NextResponse.json({ groups: result })
}

// POST /api/liff/community — create new group
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    lineUserId: string
    name: string
    description?: string
    type: string
    emoji?: string
  }
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)
  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")
  const { name, description, type, emoji } = body

  if (!name || !type) {
    return NextResponse.json({ error: "lineUserId, name, type required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const conn = await resolveConn(admin, lineUserId)
  if (!conn) {
    return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน" }, { status: 403 })
  }

  const { data: group, error } = await admin
    .from("community_groups")
    .insert({
      organization_id: conn.organization_id,
      creator_id: conn.user_id,
      name,
      description: description ?? null,
      type,
      emoji: emoji ?? "👥",
      status: "active",
    })
    .select("id, share_token")
    .single()

  if (error || !group) {
    return NextResponse.json({ error: error?.message ?? "สร้างกลุ่มไม่สำเร็จ" }, { status: 500 })
  }

  // Add creator as admin member
  await admin.from("community_members").insert({
    group_id: group.id,
    user_id: conn.user_id,
    line_user_id: lineUserId,
    display_name: conn.display_name ?? "ผู้สร้างกลุ่ม",
    role: "admin",
  })

  return NextResponse.json({ ok: true, id: group.id, shareToken: group.share_token })
}
