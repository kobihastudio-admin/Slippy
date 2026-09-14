import { NextResponse }   from "next/server"
import { createClient }  from "@/lib/supabase/server"

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await sb.from("users")
    .select("id, full_name, avatar_url, email")
    .eq("id", user.id)
    .single()

  return NextResponse.json(profile ?? { id: user.id, email: user.email })
}
