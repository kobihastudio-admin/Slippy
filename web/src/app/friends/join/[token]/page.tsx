import { createAdminClient } from "@/lib/supabase/admin"
import { createClient }      from "@/lib/supabase/server"
import { redirect }          from "next/navigation"

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const sb    = await createClient()
  const { data: { user } } = await sb.auth.getUser()

  const { data: link } = await admin
    .from("friend_invite_links")
    .select("user_id, expires_at, used_count")
    .eq("token", token)
    .maybeSingle()

  if (!link || new Date(link.expires_at) < new Date()) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-2xl">😕</p>
          <p className="text-red-500 font-medium">ลิงก์หมดอายุหรือไม่ถูกต้อง</p>
        </div>
      </div>
    )
  }

  if (!user) redirect(`/login?next=/friends/join/${token}`)

  if (user.id !== link.user_id) {
    await admin.from("friendships").upsert(
      { requester_id: user.id, addressee_id: link.user_id, status: "accepted", source: "qr_scan" },
      { onConflict: "requester_id,addressee_id" }
    )
    await admin
      .from("friend_invite_links")
      .update({ used_count: (link.used_count ?? 0) + 1 })
      .eq("token", token)
  }

  redirect("/social/friends?joined=1")
}
