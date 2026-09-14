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

// GET /api/liff/friends?lineUserId=X
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  const query = req.nextUrl.searchParams.get("q")?.trim()
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId) return NextResponse.json({ needsConnect: true, friends: [] })

  if (query) {
    if (query.length < 2) return NextResponse.json({ users: [] })

    const { data } = await admin.from("users")
      .select("id, full_name, avatar_url, phone, email")
      .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
      .neq("id", userId)
      .limit(20)

    const users = (data ?? []).map((user: any) => ({
      id: user.id,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      hint: user.phone
        ? `📱 ${String(user.phone).slice(0, 3)}***${String(user.phone).slice(-2)}`
        : user.email
          ? `✉️ ${user.email.split("@")[0].slice(0, 2)}***@${user.email.split("@")[1]}`
          : "",
    }))

    return NextResponse.json({ users })
  }

  const [{ data: accepted }, { data: pending }] = await Promise.all([
    admin
      .from("friendships")
      .select("id, requester_id, addressee_id, source, requester:requester_id(id,full_name,avatar_url), addressee:addressee_id(id,full_name,avatar_url)")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    admin
      .from("friendships")
      .select("id, requester:requester_id(id,full_name,avatar_url)")
      .eq("status", "pending")
      .eq("addressee_id", userId),
  ])

  const rawFriends = (accepted ?? []).map((f: any) => ({
    friendshipId: f.id,
    friend: f.requester_id === userId ? f.addressee : f.requester,
  }))

  // `users.full_name` is only ever set from signup metadata and is commonly
  // null for LINE-first accounts — fall back to their LINE display_name
  // (set when they ran /connect, always current) so the picker doesn't show
  // a blank/placeholder name for friends who only ever signed in via LINE.
  const friendIds = rawFriends.map(f => f.friend?.id).filter(Boolean)
  let displayNameByUserId: Record<string, string> = {}
  if (friendIds.length > 0) {
    const { data: conns } = await admin.from("line_connections")
      .select("user_id, display_name").in("user_id", friendIds)
    displayNameByUserId = Object.fromEntries(
      (conns ?? []).filter((c: any) => c.display_name).map((c: any) => [c.user_id, c.display_name])
    )
  }

  const friends = rawFriends.map(f => ({
    ...f,
    friend: f.friend ? {
      ...f.friend,
      full_name: displayNameByUserId[f.friend.id] ?? f.friend.full_name,
    } : f.friend,
  }))

  return NextResponse.json({ friends, pending: pending ?? [] })
}

// POST /api/liff/friends — { lineUserId, addresseeId, action: 'add'|'accept'|'decline', friendshipId? }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { addresseeId, action, friendshipId } = body
  const lineUserId = getVerifiedLineUserId(req, body.lineUserId)

  if (!lineUserId) return liffUnauthorized("LINE identity mismatch")

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId) return NextResponse.json({ needsConnect: true }, { status: 403 })

  if (action === "add" && addresseeId) {
    const { error } = await admin.from("friendships").insert({
      requester_id: userId,
      addressee_id: addresseeId,
      source: "search",
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else if (action === "accept" && friendshipId) {
    await admin
      .from("friendships")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", friendshipId)
      .eq("addressee_id", userId)
  } else if (action === "decline" && friendshipId) {
    await admin.from("friendships").delete().eq("id", friendshipId).eq("addressee_id", userId)
  }

  return NextResponse.json({ ok: true })
}
