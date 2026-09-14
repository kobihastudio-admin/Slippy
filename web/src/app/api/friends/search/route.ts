import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/friends/search?q=name_or_phone_or_email
export async function GET(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim()
  if (!q || q.length < 2) return NextResponse.json({ users: [] })

  const admin = createAdminClient()
  const { data } = await admin.from("users")
    .select("id, full_name, avatar_url, phone, email")
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
    .neq("id", user.id)
    .limit(20)

  const masked = (data ?? []).map((u: any) => ({
    id: u.id,
    full_name: u.full_name,
    avatar_url: u.avatar_url,
    hint: u.phone
      ? `📱 ${String(u.phone).slice(0, 3)}***${String(u.phone).slice(-2)}`
      : u.email
      ? `✉️ ${u.email.split("@")[0].slice(0, 2)}***@${u.email.split("@")[1]}`
      : "",
  }))

  return NextResponse.json({ users: masked })
}
