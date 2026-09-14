"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Icons } from "@/components/ui/icons"
import { TurnstileWidget } from "@/components/auth/turnstile-widget"

// ─── Social icon SVGs ────────────────────────────────────────────────────────
function SvgGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.26 1.05-3.72 1.05-2.86 0-5.29-1.94-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.32 9.14 5.38 12 5.38z"/>
    </svg>
  )
}
function SvgFacebook() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12a12 12 0 1 0-13.875 11.855V15.47H7.078V12h3.047v-2.64c0-3.006 1.791-4.669 4.533-4.669 1.312 0 2.686.234 2.686.234v2.953h-1.514c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.47h-2.796v8.385A12.003 12.003 0 0 0 24 12z"/>
    </svg>
  )
}
function SvgLine() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#06C755">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .631.285.631.63v4.141h1.755c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
    </svg>
  )
}

function SocialBtn({ onClick, label, icon }: { onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="h-11 rounded-[10px] border border-border bg-card hover:bg-muted
        transition-colors flex items-center justify-center gap-1.5
        text-[12.5px] font-medium text-foreground"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export function LoginForm() {
  const supabase = createClient()

  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [showPw,   setShowPw]   = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading,  setLoading]  = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")

  // ── MFA challenge step (only entered if the account has TOTP enrolled) ──
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaCode,      setMfaCode]    = useState("")
  const [mfaError,     setMfaError]   = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // Goes through /api/auth/login (not supabase.auth.signInWithPassword
    // directly) so the server can enforce an app-level lockout on top of
    // Supabase's own platform-level auth rate limiting — see that route for
    // why a server-side proxy is the only way to durably count failures.
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, captchaToken }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      toast.error(json.error ?? "เข้าสู่ระบบไม่สำเร็จ")
      setLoading(false)
      return
    }

    if (json.mfaRequired) {
      // Password was correct and the session cookie is already set (at
      // aal1) — find the verified TOTP factor and switch to the code-entry
      // step. The actual challenge/verify call goes straight to Supabase
      // via the browser client; that's fine even server-proxied logins use
      // the client SDK for this step since aal1 is already enough to call it.
      const { data, error } = await supabase.auth.mfa.listFactors()
      const factor = data?.totp.find(f => f.status === "verified")
      if (error || !factor) {
        toast.error("ไม่พบการตั้งค่า 2FA กรุณาติดต่อฝ่ายสนับสนุน")
        setLoading(false)
        return
      }
      setMfaFactorId(factor.id)
      setLoading(false)
      return
    }

    // Full reload (not router.push) so the browser Supabase client
    // re-initializes its in-memory session from the cookies the server
    // route just set, instead of staying stale.
    window.location.href = "/dashboard"
  }

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaFactorId || mfaCode.length !== 6) return
    setLoading(true)
    setMfaError(null)

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code: mfaCode })
    if (error) {
      setMfaError("รหัสไม่ถูกต้อง กรุณาลองใหม่")
      setLoading(false)
      return
    }

    window.location.href = "/dashboard"
  }

  const signInWith = async (provider: "google" | "facebook") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
  }

  // LINE uses a custom OAuth flow via /api/auth/line (not Supabase built-in)
  // because LINE is not a native Supabase provider.
  const signInWithLine = () => {
    window.location.href = "/api/auth/line"
  }

  if (mfaFactorId) {
    return (
      <div className="animate-fade-in">
        <h2 className="text-[28px] font-bold tracking-tight text-foreground">ยืนยันตัวตน</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ
        </p>
        <form onSubmit={handleVerifyMfa} className="mt-7 space-y-4">
          <input
            type="text"
            value={mfaCode}
            onChange={e => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoFocus
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            className="w-full h-14 rounded-[10px] border border-border bg-card text-center text-2xl
              tracking-[0.4em] font-mono outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          {mfaError && <p className="text-sm text-rose-500">{mfaError}</p>}
          <button
            type="submit"
            disabled={loading || mfaCode.length !== 6}
            className="w-full h-11 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white font-medium
              text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Icons.Loader size={16} />}
            ยืนยัน
          </button>
          <button
            type="button"
            onClick={() => { setMfaFactorId(null); setMfaCode(""); setMfaError(null) }}
            className="w-full text-center text-sm text-muted-foreground hover:underline"
          >
            กลับไปเข้าสู่ระบบ
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-[28px] font-bold tracking-tight text-foreground">ยินดีต้อนรับกลับ</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">เข้าสู่บัญชี Slippy ของคุณ</p>

      {/* Social login */}
      <div className="mt-7 space-y-2.5">
        {/* Google — full width, most common */}
        <button
          type="button"
          onClick={() => signInWith("google")}
          className="w-full h-11 rounded-[10px] border border-border bg-card hover:bg-muted
            transition-colors flex items-center justify-center gap-3 text-sm font-medium text-foreground"
        >
          <SvgGoogle />
          เข้าสู่ระบบด้วย Google
        </button>

        {/* Secondary row: Facebook · LINE */}
        <div className="grid grid-cols-2 gap-2">
          <SocialBtn onClick={() => signInWith("facebook")} label="Facebook" icon={<SvgFacebook />} />
          <SocialBtn onClick={signInWithLine}               label="LINE"     icon={<SvgLine />} />
        </div>
      </div>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex-1 h-px bg-border" />
        หรือใช้อีเมล
        <span className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        {/* Email */}
        <div>
          <label className="block text-[13px] font-medium text-foreground mb-1.5">อีเมล</label>
          <div className="relative">
            <Icons.Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="w-full h-11 pl-9 pr-3 rounded-[10px] border border-border bg-card text-sm
                text-foreground placeholder:text-muted-foreground outline-none
                focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] font-medium text-foreground">รหัสผ่าน</label>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              ลืมรหัสผ่าน?
            </button>
          </div>
          <div className="relative">
            <Icons.ShieldCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full h-11 pl-9 pr-10 rounded-[10px] border border-border bg-card text-sm
                text-foreground placeholder:text-muted-foreground outline-none
                focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Remember me */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-border text-brand-500 focus:ring-brand-500/30"
          />
          จดจำการเข้าสู่ระบบบนเครื่องนี้
        </label>

        <TurnstileWidget onVerify={setCaptchaToken} />

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white font-medium
            text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <Icons.Loader size={16} />}
          เข้าสู่ระบบ
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
          สมัครสมาชิก
        </Link>
      </p>

      {/* Demo info */}
      <div className="mt-7 p-3.5 bg-muted rounded-[10px] text-[12px] text-muted-foreground space-y-2.5">
        <div className="flex gap-2.5">
          <Icons.Info size={14} className="text-brand-500 shrink-0 mt-0.5" />
          <span>
            <b className="text-foreground">Demo Account</b>{" "}
            — สำหรับทดลองใช้งานระบบโดยไม่ต้องสมัคร
          </span>
        </div>
        <button
          type="button"
          onClick={() => { setEmail("demo@slippy.app"); setPassword("password") }}
          className="w-full h-8 rounded-[8px] border border-brand-200 dark:border-brand-700
            text-brand-600 dark:text-brand-400 text-[12px] font-medium
            hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors"
        >
          เข้าสู่ระบบด้วย Demo Account
        </button>
      </div>
    </div>
  )
}
