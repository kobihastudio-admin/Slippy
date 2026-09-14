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
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { TurnstileWidget } from "@/components/auth/turnstile-widget"

export function RegisterForm() {
  const t        = useTranslations("auth")
  const supabase = createClient()
  // Plan picked on the pricing table (/register?plan=pro&yearly=1) — read
  // here and sent to Stripe checkout right after signup completes, so the
  // choice isn't silently dropped in favor of the Free plan.
  const searchParams = useSearchParams()
  const planId        = searchParams.get("plan")
  const yearly         = searchParams.get("yearly") === "1"

  const [form, setForm] = useState({
    fullName: "",
    email:    "",
    password: "",
    confirm:  "",
    orgName:  "",
  })
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (form.password !== form.confirm) {
      toast.error("รหัสผ่านไม่ตรงกัน")
      return
    }
    if (form.password.length < 8) {
      toast.error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
      return
    }

    setLoading(true)

    // Goes through /api/auth/register (not supabase.auth.signUp directly)
    // so the server can actually enforce the CAPTCHA check and a per-IP
    // signup rate limit — both meaningless if the browser can skip them by
    // calling Supabase directly.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName,
        email:    form.email,
        password: form.password,
        orgName:  form.orgName,
        captchaToken,
      }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      toast.error(json.error ?? "สมัครสมาชิกไม่สำเร็จ")
      setLoading(false)
      return
    }

    toast.success("สมัครสมาชิกสำเร็จ! กำลังเข้าสู่ระบบ...")

    // If they picked a paid plan on the pricing table, send them straight to
    // Stripe checkout for it instead of dropping them on the Free dashboard.
    if (planId && planId !== "free" && json.orgId) {
      try {
        const checkoutRes = await fetch("/api/stripe/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, orgId: json.orgId, yearly }),
        })
        const checkoutJson = await checkoutRes.json().catch(() => ({}))
        if (checkoutRes.ok && checkoutJson.url) {
          window.location.href = checkoutJson.url
          return
        }
      } catch {
        // Fall through to dashboard — account was created successfully
        // either way, checkout can still be started from /billing later.
      }
    }

    // Full reload so the browser Supabase client re-initializes its session
    // from the cookies the server route just set (same reasoning as login).
    window.location.href = "/dashboard"
  }

  const signInWith = async (provider: "google" | "facebook") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
  }

  // LINE uses a custom OAuth flow via /api/auth/line (not Supabase built-in)
  const signInWithLine = () => { window.location.href = "/api/auth/line" }

  const InputField = ({
    label, field, type = "text", placeholder, required = true
  }: {
    label: string; field: keyof typeof form
    type?: string; placeholder?: string; required?: boolean
  }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={form[field]}
        onChange={set(field)}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 rounded-lg border bg-background text-foreground
          text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2
          focus:ring-ring focus:border-transparent transition-shadow"
      />
    </div>
  )

  return (
    <form onSubmit={handleRegister} className="space-y-3">

      {/* Google — full width */}
      <button
        type="button"
        onClick={() => signInWith("google")}
        className="w-full flex items-center justify-center gap-3 h-11
          border rounded-[10px] text-sm font-medium bg-background hover:bg-muted transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {t("loginWithGoogle")}
      </button>

      {/* Secondary: Facebook · LINE */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Facebook", onClick: () => signInWith("facebook"), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12a12 12 0 1 0-13.875 11.855V15.47H7.078V12h3.047v-2.64c0-3.006 1.791-4.669 4.533-4.669 1.312 0 2.686.234 2.686.234v2.953h-1.514c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.47h-2.796v8.385A12.003 12.003 0 0 0 24 12z"/></svg> },
          { label: "LINE",     onClick: signInWithLine,               icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="#06C755"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .631.285.631.63v4.141h1.755c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg> },
        ].map(({ label, onClick, icon }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            title={label}
            className="h-10 rounded-[10px] border text-sm font-medium bg-background hover:bg-muted
              transition-colors flex items-center justify-center gap-1.5 text-foreground"
          >
            {icon}
            <span className="text-[12px]">{label}</span>
          </button>
        ))}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs text-muted-foreground bg-background px-2 w-fit mx-auto">
          หรือใช้อีเมล
        </div>
      </div>

      <InputField label={t("fullName")} field="fullName" placeholder="ชื่อ-นามสกุล" />
      <InputField label="ชื่อบริษัท / องค์กร" field="orgName"
        placeholder="บริษัท ABC จำกัด" required={false} />
      <InputField label={t("email")}    field="email"    type="email"    placeholder="you@company.com" />
      <InputField label={t("password")} field="password" type="password" placeholder="อย่างน้อย 8 ตัวอักษร" />
      <InputField label={t("confirmPassword")} field="confirm" type="password" placeholder="ยืนยันรหัสผ่าน" />

      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("termsAgreement")}{" "}
        <Link href="/terms" className="text-brand-500 hover:underline whitespace-nowrap">{t("terms")}</Link>
        {" และ "}
        <Link href="/privacy-policy" className="text-brand-500 hover:underline whitespace-nowrap">{t("privacy")}</Link>
      </p>

      <TurnstileWidget onVerify={setCaptchaToken} />

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5
          bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg text-sm
          transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("register")}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link href="/login" className="text-brand-500 hover:underline font-medium">
          {t("login")}
        </Link>
      </p>
    </form>
  )
}
