"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient }        from "@/lib/supabase/client"
import { LogoMark }            from "@/components/ui/logo"
import { safeRedirectPath }    from "@/lib/safe-redirect"

export default function LineCallbackPage() {
  const router   = useRouter()
  const params   = useSearchParams()
  const supabase = createClient()
  const [status, setStatus] = useState("กำลังเข้าสู่ระบบ...")

  // `next` — optional deep-link destination (e.g. from a LIFF Rich-Menu tap,
  // such as "/personal/health"). Falls back to the usual dashboard/onboarding
  // routing when absent. Only same-origin relative paths are honoured.
  const rawNext = params.get("next")
  const safeNext = rawNext ? safeRedirectPath(rawNext, "") || null : null

  useEffect(() => {
    async function handleSession() {
      try {
        // ── Parse hash fragment manually ─────────────────────────
        // Supabase implicit flow returns: #access_token=...&refresh_token=...
        const hash   = window.location.hash.substring(1)  // strip leading #
        const params = new URLSearchParams(hash)
        const accessToken  = params.get("access_token")
        const refreshToken = params.get("refresh_token")
        const errorCode    = params.get("error")
        const errorDesc    = params.get("error_description")

        if (errorCode) {
          console.error("[line-callback] hash error:", errorCode, errorDesc)
          setStatus("เกิดข้อผิดพลาดจาก Supabase")
          setTimeout(() => router.replace(`/login?error=${errorCode}`), 1500)
          return
        }

        if (!accessToken || !refreshToken) {
          // No tokens in hash — try getSession (might already be set)
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            await redirectAfterLogin(session.user.id)
            return
          }
          console.error("[line-callback] no tokens in hash, hash was:", hash)
          setStatus("ไม่พบ token กรุณาลองใหม่")
          setTimeout(() => router.replace("/login?error=line_no_token"), 1500)
          return
        }

        // ── Set session explicitly ───────────────────────────────
        setStatus("กำลังตั้งค่า session...")
        const { data: { session }, error } = await supabase.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        })

        if (error || !session) {
          console.error("[line-callback] setSession error:", error?.message)
          setStatus("สร้าง session ไม่สำเร็จ")
          setTimeout(() => router.replace("/login?error=line_session"), 1500)
          return
        }

        // ── Redirect based on org membership ────────────────────
        await redirectAfterLogin(session.user.id)

      } catch (err: any) {
        console.error("[line-callback] unexpected:", err.message)
        setStatus("เกิดข้อผิดพลาด กรุณาลองใหม่")
        setTimeout(() => router.replace("/login?error=line_unexpected"), 1500)
      }
    }

    async function redirectAfterLogin(userId: string) {
      setStatus("เข้าสู่ระบบสำเร็จ กำลังโหลด...")

      // A `next` deep-link (e.g. opened from the LINE Rich Menu) always wins —
      // it skips the onboarding gate since the user is just browsing a pillar.
      if (safeNext) { router.replace(safeNext); return }

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle()

      router.replace(membership ? "/dashboard" : "/onboarding")
    }

    handleSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#070a18] gap-6">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(139,92,246,0.18), transparent 65%)" }} />

      <div className="relative flex flex-col items-center gap-4">
        <div style={{ animation: "sp-float 3s ease-in-out infinite" }}>
          <LogoMark size={56} glow />
        </div>
        <span className="text-white font-bold text-xl tracking-tight">Slippy</span>
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-violet-400"
          style={{ animation: "spin 0.8s linear infinite" }} />
        <p className="text-white/60 text-sm">{status}</p>
      </div>

      <style>{`
        @keyframes sp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}
