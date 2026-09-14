import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// PATCH /api/friends/[id] — { action: 'accept' | 'decline' | 'block' }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { action } = await req.json()
  const admin = createAdminClient()

  if (action === "decline") {
    await admin.from("friendships").delete().eq("id", id).eq("addressee_id", user.id)
  } else if (action === "accept") {
    await admin.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", id).eq("addressee_id", user.id)
  } else if (action === "block") {
    await admin.from("friendships").update({ status: "blocked", updated_at: new Date().toISOString() })
      .eq("id", id)
  } else {
    return NextResponse.json({ error: "invalid action" }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE /api/friends/[id] — unfriend
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()
  await admin.from("friendships").delete().eq("id", id)
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
  return NextResponse.json({ ok: true })
}
