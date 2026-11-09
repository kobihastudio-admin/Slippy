import { createAdminClient } from "@/lib/supabase/admin"
import { createClient }      from "@/lib/supabase/server"
import { redirect }          from "next/navigation"
import { inviteDeepLink, isLineInviteSource } from "@/lib/friend-invite"

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ src?: string | string[] }>
}) {
  const { token } = await params
  const { src } = await searchParams

  // Links shared from LINE open this static landing first. It must stay free of
  // any database or session access: it is reachable without login (middleware)
  // and must not reveal whether a token exists.
  if (isLineInviteSource(src)) return <InviteLanding token={token} />

  const admin = createAdminClient()
  const sb    = await createClient()
  const { data: { user } } = await sb.auth.getUser()

  // Check the session BEFORE any token lookup: an anonymous caller must never be able to tell a
  // valid token from an invalid one through this page (belt and braces next to the middleware rule).
  if (!user) redirect(`/login?next=/friends/join/${token}`)

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

function InviteLanding({ token }: { token: string }) {
  const deepLink = inviteDeepLink(token)

  if (!deepLink) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-2xl">😕</p>
          <p className="text-red-500 font-medium">ลิงก์หมดอายุหรือไม่ถูกต้อง</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center space-y-5 shadow-sm">
        <p className="text-3xl">👋</p>
        <h1 className="text-xl font-semibold">เป็นเพื่อนกันใน Slippy</h1>
        <p className="text-sm text-muted-foreground">คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy</p>
        {/* A plain link the user taps: LINE's in-app browser blocks custom-scheme redirects that are not a tap. */}
        <a
          href={deepLink}
          className="block w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          เปิดใน Slippy
        </a>
        <a
          href={`/friends/join/${token}`}
          className="block w-full rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
        >
          ดำเนินการต่อบนเว็บ
        </a>
        <p className="text-xs text-muted-foreground">
          ถ้ากด “เปิดใน Slippy” แล้วไม่มีอะไรเกิดขึ้น แสดงว่ายังไม่ได้ติดตั้งแอป ติดตั้งแล้วกดลิงก์นี้อีกครั้ง หรือเข้าสู่ระบบบนเว็บก่อนแล้วกดลิงก์ในแชทอีกครั้ง
        </p>
      </div>
    </div>
  )
}
