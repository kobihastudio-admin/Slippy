import { NextResponse } from "next/server"
import { getAppUrl } from "@/lib/app-url"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/friends/invite — get or create my invite link
export async function GET() {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()
  let { data: link } = await admin.from("friend_invite_links")
    .select("token, expires_at")
    .eq("user_id", user.id)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle()

  if (!link) {
    const { data: newLink } = await admin.from("friend_invite_links")
      .insert({ user_id: user.id }).select("token, expires_at").single()
    link = newLink
  }

  const base = getAppUrl()
  return NextResponse.json({
    token: link?.token,
    url: `${base}/friends/join/${link?.token}`,
  })
}
