/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { Suspense } from "react"
import Link from "next/link"
import { RegisterForm } from "@/components/auth/register-form"
import { getTranslations } from "next-intl/server"
import { LogoMark } from "@/components/ui/logo"
import { LangThemeToggle } from "@/components/ui/lang-theme-toggle"
import { Icons } from "@/components/ui/icons"

export default async function RegisterPage() {
  const t = await getTranslations("auth")

  return (
    <div className="h-screen flex overflow-hidden relative">

      {/* Lang + Theme toggle — fixed top-right */}
      <div className="fixed top-4 right-4 z-50">
        <LangThemeToggle />
      </div>

      {/* Left — brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#070a18] flex-col
        justify-between p-12 relative overflow-hidden">

        <div className="absolute inset-0 glow-radial opacity-80" />
        <div className="absolute inset-0 glow-dotgrid opacity-30" />

        {/* Logo + back link */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={40} glow />
            <span className="text-white font-bold text-xl">Slippy</span>
          </div>
          <Link href="/" className="text-slate-400 hover:text-slate-200 text-xs transition-colors flex items-center gap-1">
            ← หน้าหลัก
          </Link>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 bg-white/8 border border-white/12
              text-emerald-400 text-[11px] font-semibold px-3 py-1 rounded-full tracking-wide uppercase">
              ✦ ไม่ต้องใส่บัตรเครดิต
            </div>
            <h2 className="text-[38px] font-bold text-white leading-[1.1] tracking-tight">
              เริ่มต้นฟรี<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                ไม่มีหมดอายุ
              </span>
            </h2>
            <p className="text-slate-400 text-sm">อัปเกรดได้ทุกเมื่อ · ยกเลิกได้ตลอด</p>
          </div>

          <div className="space-y-2.5">
            {([
              {
                icon: <Icons.Zap size={15} />,
                gradient: "from-amber-500/20 to-orange-500/10",
                border: "border-amber-500/25",
                iconColor: "text-amber-400",
                title: "ใช้งานได้ทันที",
                desc: "ฟรี 15 เอกสาร/เดือน ไม่มีวันหมดอายุ",
              },
              {
                icon: <Icons.Brain size={15} />,
                gradient: "from-violet-500/20 to-indigo-500/10",
                border: "border-violet-500/25",
                iconColor: "text-violet-400",
                title: "AI อ่านเอกสารอัตโนมัติ",
                desc: "95% accuracy — ไม่ต้องพิมพ์เอง",
              },
              {
                icon: <Icons.Plug size={15} />,
                gradient: "from-sky-500/20 to-cyan-500/10",
                border: "border-sky-500/25",
                iconColor: "text-sky-400",
                title: "Export เข้าระบบบัญชี",
                desc: "ส่งเข้า Google Sheets อัตโนมัติ ระบบอื่นๆ เร็วๆ นี้",
              },
              {
                icon: <Icons.Smartphone size={15} />,
                gradient: "from-emerald-500/20 to-teal-500/10",
                border: "border-emerald-500/25",
                iconColor: "text-emerald-400",
                title: "รองรับ Mobile",
                desc: "ถ่ายรูปสลิปส่งผ่าน LINE ได้เลย",
              },
            ] as const).map(({ icon, gradient, border, iconColor, title, desc }) => (
              <div key={title} className={`flex items-center gap-3 rounded-xl
                bg-gradient-to-r ${gradient} border ${border} px-3.5 py-2.5`}>
                <div className={`shrink-0 w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center ${iconColor}`}>
                  {icon}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold leading-none mb-0.5">{title}</p>
                  <p className="text-slate-400 text-xs leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-slate-600 text-xs">
          © 2026 Slippy. All rights reserved.
        </p>
      </div>

      {/* Right — register form (scrollable on small heights) */}
      <div className="flex-1 h-screen overflow-y-auto flex items-start justify-center bg-background">
        <div className="w-full max-w-sm px-8 py-10">

          {/* Mobile: logo + back link */}
          <div className="lg:hidden flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <LogoMark size={28} />
              <span className="font-bold">Slippy</span>
            </div>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← หน้าหลัก
            </Link>
          </div>

          <div className="mb-5">
            <div className="inline-flex items-center gap-1.5 bg-brand-50 dark:bg-brand-500/10
              text-brand-600 dark:text-brand-400 text-xs font-medium px-2.5 py-1 rounded-full
              border border-brand-200 dark:border-brand-500/30 mb-2.5">
              🎉 ฟรีตลอด · ไม่มีหมดอายุ
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t("createAccount")}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              ฟรี 15 เอกสาร/เดือน · อัปเกรดได้เมื่อพร้อม
            </p>
          </div>

          <Suspense fallback={null}>
            <RegisterForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
