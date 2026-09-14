/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import Link          from "next/link"
import { LoginForm } from "@/components/auth/login-form"
import { LogoMark }  from "@/components/ui/logo"
import { Icons }     from "@/components/ui/icons"
import { OAuthErrorBanner } from "@/components/auth/oauth-error-banner"
import { LangThemeToggle } from "@/components/ui/lang-theme-toggle"

const features = [
  { Icon: Icons.Sparkles, text: "AI อ่านเอกสารอัตโนมัติ 95% accuracy" },
  { Icon: Icons.Plug,     text: "Export เข้า Google Sheets อัตโนมัติ" },
  { Icon: Icons.BarChart, text: "รายงาน VAT & WHT พร้อม Export" },
  { Icon: Icons.Smartphone, text: "ถ่ายรูปผ่าน Mobile App ได้เลย" },
]

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>
}) {
  return (
    <div className="min-h-screen flex relative">

      {/* Lang + Theme toggle — fixed top-right */}
      <div className="fixed top-4 right-4 z-50">
        <LangThemeToggle />
      </div>

      {/* Left — brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#070a18] flex-col
        justify-between p-12 relative overflow-hidden">

        {/* Background glow */}
        <div className="absolute inset-0 glow-radial opacity-80" />
        <div className="absolute inset-0 glow-dotgrid opacity-30" />

        {/* Logo */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={40} glow />
            <span className="text-white font-bold text-xl tracking-tight">Slippy</span>
          </div>
          <Link href="/" className="text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center gap-1">
            ← หน้าหลัก
          </Link>
        </div>

        {/* Middle content */}
        <div className="relative z-10 space-y-8">
          <h2 className="text-[38px] font-bold text-white leading-tight tracking-tight">
            จัดการเอกสาร<br />
            บัญชีอัจฉริยะ
          </h2>

          {/* Feature highlights */}
          <div className="space-y-4">
            {features.map(({ Icon, text }) => (
              <div key={text} className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-[10px] bg-white/8 border border-white/10
                  flex items-center justify-center shrink-0">
                  <Icon size={17} className="text-brand-300" />
                </div>
                <span className="text-slate-300 text-sm leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* Trust strip */}
          <div className="flex items-center gap-5 pt-1">
            {["ISO 27001", "PDPA Compliant", "SSL Encrypted"].map(label => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                <span className="text-slate-400 text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-slate-600 text-xs">
          © 2026 Slippy. All rights reserved.
        </p>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <LogoMark size={32} />
              <span className="font-bold text-lg">Slippy</span>
            </div>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← หน้าหลัก
            </Link>
          </div>

          <OAuthErrorBanner searchParams={searchParams} />
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
