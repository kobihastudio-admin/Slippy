"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 */

import Link                   from "next/link"
import { useState, useEffect, useCallback } from "react"
import { LogoMark }            from "@/components/ui/logo"
import { PLANS, annualMonthlyPrice, ANNUAL_DISCOUNT_PCT, type PlanId } from "@/lib/plans"
import { LangThemeToggle }     from "@/components/ui/lang-theme-toggle"

// ─── Inline SVG icons (matching design spec) ──────────────────────────────────
function IPlay({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
}
function IArrowRight({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
}
function ICheck({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function ICheckCircle({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}
function ISparkles({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.88 5.76L20 10l-6.12 1.24L12 17l-1.88-5.76L4 10l6.12-1.24L12 3z"/><path d="M5 3l.88 2.76L8 7l-2.12.24L5 10l-.88-2.76L2 7l2.12-.24L5 3z"/><path d="M19 14l.88 2.76L22 18l-2.12.24L19 21l-.88-2.76L16 18l2.12-.24L19 14z"/></svg>
}
function ILink({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
}
function IBarChart({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
}
function IBuilding({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="13" rx="1"/><path d="M8 22V12h8v10"/><path d="M9 9V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>
}
function IShieldCheck({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
}
function IUploadCloud({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
}
function ISend({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
}
function IGlobe({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
}
function IMail({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}
function ISmartphone({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
}
function IMessageSquare({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
}
function ICamera({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
}
function ISun({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
}
function IMoon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
}
function IPlus({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}

// ─── Loading Splash ────────────────────────────────────────────────────────────
function LoadingSplash({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0)
  const [leaving,  setLeaving]  = useState(false)
  const duration = 2000

  useEffect(() => {
    const start = Date.now()
    const tick  = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / duration) * 100)
      setProgress(p)
      if (p >= 100) {
        clearInterval(tick)
        setLeaving(true)
        setTimeout(() => onDone(), 380)
      }
    }, 40)
    return () => clearInterval(tick)
  }, [onDone])

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center bg-[#070a18] text-white transition-opacity duration-300 ${leaving ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
      <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(67,56,202,0.18), transparent 50%)" }}/>
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(rgba(99,102,241,0.18) 1px, transparent 1px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(circle at 50% 50%, black, transparent 75%)", WebkitMaskImage: "radial-gradient(circle at 50% 50%, black, transparent 75%)" }}/>

      <div className="relative flex flex-col items-center">
        <div className="relative w-[140px] h-[140px] flex items-center justify-center">
          <span className="absolute inset-0 rounded-[34%] bg-gradient-to-br from-violet-500 via-indigo-500 to-pink-500 blur-3xl" style={{ opacity: 0.4, animation: "ld-pulse 2.4s ease-in-out infinite" }}/>
          <span className="absolute inset-2 rounded-[32%] border border-white/10" style={{ animation: "ld-ring 2s ease-out infinite" }}/>
          <span className="absolute inset-2 rounded-[32%] border border-white/10" style={{ animation: "ld-ring 2s ease-out infinite", animationDelay: "0.8s" }}/>
          <div style={{ animation: "ld-float 3.2s ease-in-out infinite" }}>
            <svg width="100" height="100" viewBox="0 0 48 48" fill="none" style={{ filter: "drop-shadow(0 8px 24px rgba(99,102,241,0.5))" }}>
              <defs>
                <linearGradient id="ld-bg" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#8b5cf6"/><stop offset="0.5" stopColor="#6366f1"/><stop offset="1" stopColor="#ec4899"/>
                </linearGradient>
                <radialGradient id="ld-shine" cx="0.2" cy="0.15" r="0.85">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.5"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
                </radialGradient>
                <linearGradient id="ld-slip" x1="14" y1="13" x2="34" y2="33" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#f1f5f9"/>
                </linearGradient>
              </defs>
              <path d="M24 2C9.5 2 2 9.5 2 24S9.5 46 24 46 46 38.5 46 24 38.5 2 24 2z" fill="url(#ld-bg)"/>
              <path d="M24 2C9.5 2 2 9.5 2 24S9.5 46 24 46 46 38.5 46 24 38.5 2 24 2z" fill="url(#ld-shine)"/>
              <g style={{ transformOrigin: "24px 24px", animation: "ld-tilt 2.4s ease-in-out infinite" }}>
                <path d="M16.5 12.5 L31.5 12.5 Q34 12.5 34 15 L34 30 L31.7 32.6 L29.5 30 L27.2 32.6 L25 30 L22.8 32.6 L20.5 30 L18.3 32.6 L16 30 L14 32.6 L14 15 Q14 12.5 16.5 12.5 Z" fill="#1e1b4b" fillOpacity="0.18" transform="translate(0.6 0.9)"/>
                <path d="M16.5 12.5 L31.5 12.5 Q34 12.5 34 15 L34 30 L31.7 32.6 L29.5 30 L27.2 32.6 L25 30 L22.8 32.6 L20.5 30 L18.3 32.6 L16 30 L14 32.6 L14 15 Q14 12.5 16.5 12.5 Z" fill="url(#ld-slip)"/>
                <g style={{ transformOrigin: "20.2px 20.2px", animation: "ld-blink 2.8s ease-in-out infinite" }}><circle cx="20.2" cy="20.2" r="1.45" fill="#1e1b4b"/></g>
                <g style={{ transformOrigin: "27.8px 20.2px", animation: "ld-blink 2.8s ease-in-out infinite" }}><circle cx="27.8" cy="20.2" r="1.45" fill="#1e1b4b"/></g>
                <circle cx="18.4" cy="24.2" r="1.2" fill="#fb7185" fillOpacity="0.55"/>
                <circle cx="29.6" cy="24.2" r="1.2" fill="#fb7185" fillOpacity="0.55"/>
                <path d="M20 24.5 Q24 28 28 24.5" stroke="#1e1b4b" strokeWidth="1.7" strokeLinecap="round" fill="none"/>
              </g>
            </svg>
          </div>
        </div>
        <div className="mt-7 text-center" style={{ animation: "ld-fade-up 0.6s 0.2s both" }}>
          <div className="text-[32px] font-bold tracking-tight">Slippy</div>
          <div className="mt-1.5 text-[13px] text-white/55">ใบเสร็จเข้ามา · ลงบัญชีออกไป · อัตโนมัติ</div>
        </div>
        <div className="mt-7 w-[180px] h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#a78bfa,#818cf8,#f472b6)" }}/>
        </div>
      </div>

    </div>
  )
}

// ─── Hero Mockup ───────────────────────────────────────────────────────────────
function HeroMockup({ isTH }: { isTH: boolean }) {
  const docs = [
    { f: "receipt-makro.jpg", v: "Makro Online",          a: "฿1,285.00", s: "approved",   c: "emerald" },
    { f: "grab-2025-05.pdf",  v: "Grab Holdings",          a: "฿  450.00", s: "reviewing",  c: "amber"   },
    { f: "aws-may26.pdf",     v: "Amazon Web Services",    a: "฿8,750.00", s: "pushed",     c: "purple"  },
    { f: "mea-elec.pdf",      v: "การไฟฟ้านครหลวง",       a: "฿1,230.00", s: "processing", c: "blue"    },
  ]
  const badge = (c: string) => {
    const map: Record<string, string> = {
      emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      amber:   "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      purple:  "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
      blue:    "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    }
    return map[c] ?? ""
  }
  const dot = (c: string) => {
    const map: Record<string, string> = { emerald:"bg-emerald-500", amber:"bg-amber-500", purple:"bg-purple-500", blue:"bg-blue-500" }
    return map[c] ?? ""
  }

  return (
    <div className="relative w-full max-w-[600px] mx-auto" style={{ aspectRatio: "5/4" }}>
      <div className="absolute inset-10 rounded-full blur-3xl" style={{ background: "linear-gradient(135deg,rgba(139,92,246,0.3),rgba(99,102,241,0.3),rgba(236,72,153,0.3))" }}/>

      <div className="absolute inset-0 rounded-[24px] border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden" style={{ background: "hsl(var(--card,0 0% 100%))" }}>
        <div className="h-9 border-b border-gray-100 dark:border-gray-800 flex items-center px-4 gap-1.5" style={{ background: "hsl(var(--muted,220 14% 96%))" }}>
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400"/>
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400"/>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400"/>
          <span className="ml-3 text-[11px] text-gray-400">slippy.ai/dashboard</span>
        </div>

        <div className="p-4 grid grid-cols-12 gap-3 h-[calc(100%-2.25rem)]">
          <div className="col-span-3 rounded-[10px] p-3 flex flex-col gap-2" style={{ background: "rgba(0,0,0,0.03)" }}>
            <div className="flex items-center gap-1.5 mb-1"><LogoMark size={16}/><span className="text-[10px] font-bold text-gray-800 dark:text-gray-100">Slippy</span></div>
            <div className="h-px bg-gray-200 dark:bg-gray-700 my-1"/>
            {["Dashboard","Documents","Vendors","Tax","Reports"].map((l, i) => (
              <div key={l} className={`text-[10.5px] font-medium px-2 py-1.5 rounded-md ${i === 1 ? "bg-indigo-600 text-white" : "text-gray-400"}`}>{l}</div>
            ))}
          </div>

          <div className="col-span-9 flex flex-col gap-3 min-h-0">
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: isTH ? "เอกสารเดือนนี้" : "Docs this month", v: "47", d: "+12%" },
                { l: isTH ? "รอตรวจสอบ" : "Reviewing", v: "8", d: "" },
                { l: isTH ? "ยอดรวม" : "Total", v: "฿142K", d: "+8%" },
              ].map((s, i) => (
                <div key={i} className="rounded-[8px] border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5">
                  <div className="text-[9px] text-gray-400 uppercase tracking-wider">{s.l}</div>
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{s.v}</div>
                    {s.d && <div className="text-[9px] font-semibold text-emerald-500">{s.d}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex-1 rounded-[8px] border border-gray-100 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="text-[10px] font-semibold text-gray-800 dark:text-gray-100">{isTH ? "เอกสารล่าสุด" : "Recent documents"}</div>
                <div className="text-[9px] text-indigo-600 dark:text-indigo-300">{isTH ? "ดูทั้งหมด" : "View all"} →</div>
              </div>
              {docs.map((r, i) => (
                <div key={i} className="px-3 py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-b-0 flex items-center gap-2 text-[10px]">
                  <span className="h-6 w-6 rounded-[5px] bg-gray-100 dark:bg-gray-700 flex items-center justify-center">📄</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 dark:text-gray-100 font-medium truncate">{r.v}</div>
                    <div className="text-gray-400 truncate">{r.f}</div>
                  </div>
                  <div className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums">{r.a}</div>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8.5px] font-medium ${badge(r.c)}`}>
                    <span className={`h-1 w-1 rounded-full ${dot(r.c)}`}/>
                    {r.s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* floating chip — upload */}
      <div className="absolute -left-3 lg:-left-8 top-12 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-[12px] shadow-xl p-3 w-[220px]" style={{ animation: "hero-float 4s ease-in-out infinite" }}>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-[8px] flex items-center justify-center text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            <ICamera size={16}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-semibold text-gray-900 dark:text-gray-100">slip_makro_0528.jpg</div>
            <div className="text-[10px] text-gray-400">{isTH ? "อัปโหลดผ่าน LINE" : "Uploaded via LINE"}</div>
          </div>
        </div>
        <div className="mt-2.5 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className="h-full w-[78%] rounded-full bg-indigo-500"/>
        </div>
      </div>

      {/* floating chip — AI */}
      <div className="absolute -right-3 lg:-right-8 bottom-14 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-[12px] shadow-xl p-3 w-[230px]" style={{ animation: "hero-float 4s ease-in-out infinite", animationDelay: "-2s" }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
          <ISparkles size={13}/> {isTH ? "AI สกัดข้อมูล · 96%" : "AI extracted · 96%"}
        </div>
        <div className="mt-2 space-y-1 text-[10.5px]">
          {[[isTH?"ผู้ขาย":"Vendor","Makro Online"],[isTH?"ยอดรวม":"Total","฿1,285.00"],["VAT 7%","฿84.07"]].map(([k,v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-gray-400">{k}</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{v}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="max-w-[720px]">
      <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">{eyebrow}</div>
      <h2 className="mt-3 text-[32px] lg:text-[40px] leading-[1.1] font-bold tracking-tight text-gray-900 dark:text-gray-50">{title}</h2>
      {subtitle && <p className="mt-4 text-[15.5px] leading-relaxed text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
  )
}

// ─── Main Landing Page ─────────────────────────────────────────────────────────
export function LandingPage() {
  const [ready,         setReady]         = useState(false)
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [lang,          setLang]          = useState<"th"|"en">("th")
  const [faqOpen,       setFaqOpen]       = useState(0)
  const [pricingYearly, setPricingYearly] = useState(false)
  const isTH = lang === "th"

  const navLinks = [
    { href: "#",          th: "หน้าหลัก",         en: "Home"        },
    { href: "#features",  th: "ฟีเจอร์",           en: "Features"    },
    { href: "#how",       th: "วิธีใช้งาน",        en: "How it works"},
    { href: "#pricing",   th: "ราคา",              en: "Pricing"     },
    { href: "#faq",       th: "คำถามที่พบบ่อย",   en: "FAQ"         },
  ]

  // Stable across re-renders — an inline arrow here would give LoadingSplash's
  // effect a new `onDone` identity every render, restarting its 2s timer from
  // 0 each time and never reaching 100% if anything upstream re-renders
  // during the loading phase (e.g. an auth/theme provider), leaving the
  // splash stuck forever.
  const handleSplashDone = useCallback(() => setReady(true), [])

  if (!ready) return <LoadingSplash onDone={handleSplashDone}/>

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-50 transition-colors">

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 transition-all bg-white/85 dark:bg-gray-950/85 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-[1200px] mx-auto h-16 px-5 lg:px-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={32}/>
            <span className="text-[18px] font-bold tracking-tight">Slippy</span>
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} className="text-[13.5px] font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50 transition">
                {isTH ? l.th : l.en}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* Lang + Theme toggle — shared component, hidden on very small screens */}
            <LangThemeToggle
              locale={lang}
              onLangChange={l => setLang(l as "th" | "en")}
              className="hidden sm:flex"
            />
            <Link href="/login" className="hidden sm:inline-flex h-8 px-3 rounded-lg text-[13px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 items-center transition">
              {isTH ? "เข้าสู่ระบบ" : "Sign in"}
            </Link>
            <Link href="/register" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition">
              {isTH ? "เริ่มใช้งานฟรี" : "Start free"}<IArrowRight size={13}/>
            </Link>
            <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                {menuOpen ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> : <><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></>}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 px-5 py-4 space-y-1">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                {isTH ? l.th : l.en}
              </a>
            ))}
            <div className="pt-3 flex gap-2">
              <Link href="/login" className="flex-1 h-10 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center justify-center">{isTH?"เข้าสู่ระบบ":"Sign in"}</Link>
              <Link href="/register" className="flex-1 h-10 rounded-xl bg-indigo-600 text-sm font-bold text-white flex items-center justify-center">{isTH?"เริ่มใช้งานฟรี":"Start free"}</Link>
            </div>
            {/* Lang + Theme toggle in mobile menu */}
            <div className="pt-2 pb-1">
              <LangThemeToggle
                locale={lang}
                onLangChange={l => setLang(l as "th" | "en")}
              />
            </div>
          </div>
        )}
      </header>

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(67,56,202,0.18), transparent 50%)", opacity: 0.5 }}/>
        <div className="absolute inset-x-0 top-0 h-[600px] opacity-25" style={{ backgroundImage: "radial-gradient(rgba(99,102,241,0.18) 1px, transparent 1px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse at top, black 30%, transparent 70%)", WebkitMaskImage: "radial-gradient(ellipse at top, black 30%, transparent 70%)" }}/>

        <div className="relative max-w-[1200px] mx-auto px-5 lg:px-8 pt-16 lg:pt-24 pb-20 lg:pb-28 grid lg:grid-cols-12 gap-12 lg:gap-10 items-center">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 h-7 pl-1.5 pr-3 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[11.5px] font-medium">
              <span className="h-5 px-2 rounded-full bg-indigo-600 text-white text-[10px] inline-flex items-center">NEW</span>
              {isTH ? "เชื่อมต่อระบบบัญชี, LINE Bot และ Mobile App แล้ว" : "Accounting sync, LINE Bot & Mobile ready"}
            </div>

            <h1 className="mt-5 text-[40px] sm:text-[52px] lg:text-[60px] leading-[1.05] font-bold tracking-tight">
              {isTH ? (
                <>ใบเสร็จเข้ามา{" "}
                  <span className="bg-gradient-to-r from-violet-500 via-indigo-500 to-pink-500 bg-clip-text text-transparent">ลงบัญชีออกไป</span>
                  {" "}อัตโนมัติ</>
              ) : (
                <>Receipts in.{" "}
                  <span className="bg-gradient-to-r from-violet-500 via-indigo-500 to-pink-500 bg-clip-text text-transparent">Books out.</span>
                  {" "}Automatically.</>
              )}
            </h1>

            <p className="mt-5 text-[16.5px] lg:text-[17px] leading-relaxed text-gray-500 dark:text-gray-400 max-w-[540px]">
              {isTH
                ? "Slippy ใช้ AI อ่านสลิปและใบเสร็จของคุณ จากนั้นส่งเข้าระบบบัญชีให้อัตโนมัติ — ลดเวลาทำบัญชี 90% ทำงานได้ทั้งจาก Web, LINE และมือถือ"
                : "Slippy uses AI to read your slips and receipts, then pushes them into your books automatically — cutting bookkeeping time by 90%."}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-[10px] text-[14.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 hover:-translate-y-0.5">
                {isTH ? "เริ่มใช้งานฟรี · ไม่ต้องใช้บัตร" : "Start free · No card needed"}
                <IArrowRight size={15}/>
              </Link>
              <a href="#how" className="inline-flex items-center gap-2 h-12 px-5 rounded-[10px] text-[14px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                <span className="h-7 w-7 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shadow-sm">
                  <IPlay size={12}/>
                </span>
                {isTH ? "ดูวิธีการทำงาน 90 วินาที" : "Watch the 90s demo"}
              </a>
            </div>

            <div className="mt-7 flex items-center gap-5 text-[12.5px] text-gray-400 flex-wrap">
              {[
                isTH ? "50 เอกสาร/เดือน ฟรีตลอดไป" : "50 free docs/month forever",
                isTH ? "ตั้งค่า 2 นาที" : "2-minute setup",
                "PDPA",
              ].map(t => (
                <div key={t} className="inline-flex items-center gap-1.5">
                  <ICheckCircle size={14}/> {t}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 relative">
            <HeroMockup isTH={isTH}/>
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ─────────────────────────────────────────── */}
      <section className="border-y border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-10">
          {[
            { n: "1,200+", l: isTH ? "ธุรกิจที่ใช้งาน"     : "businesses"      },
            { n: "2.4M",   l: isTH ? "เอกสารประมวลผล"     : "docs processed"  },
            { n: "95%",    l: isTH ? "ความแม่นยำ AI"       : "AI accuracy"     },
            { n: "90%",    l: isTH ? "เวลาที่ประหยัด"      : "time saved"      },
          ].map((it, i) => (
            <div key={i} className="text-center lg:text-left">
              <div className="text-[28px] lg:text-[32px] font-bold tracking-tight tabular-nums">{it.n}</div>
              <div className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-0.5">{it.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────── */}
      <section id="features" className="py-20 lg:py-28">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8">
          <SectionHeader
            eyebrow={isTH ? "ความสามารถ" : "Features"}
            title={isTH ? "ทุกอย่างที่ทีมบัญชีของคุณต้องการ" : "Everything your bookkeeping team needs"}
            subtitle={isTH ? "ตั้งแต่รับเอกสาร ตรวจสอบความถูกต้อง ส่งเข้าบัญชี ไปจนถึงรายงานภาษี — Slippy จัดการให้ครบในที่เดียว" : "From intake to verification to push to tax reports — Slippy handles it all in one place."}
          />
          <div className="mt-12 lg:mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {[
              { icon: <ISparkles size={20}/>, th: { t:"AI สกัดข้อมูลแม่นยำ 95%", d:"อ่านผู้ขาย วันที่ ยอดเงิน VAT จากใบเสร็จได้แม่นยำ พร้อม confidence score ที่ตรวจสอบได้" }, en: { t:"95% accurate AI extraction", d:"Reads vendor, date, total, VAT — with a confidence score you can verify." } },
              { icon: <ILink size={20}/>,     th: { t:"ส่งเข้าระบบบัญชีอัตโนมัติ", d:"หลังอนุมัติ เอกสารจะถูกบันทึกเข้าระบบบัญชีให้ทันที พร้อม mapping หมวดและภาษีอัตโนมัติ" }, en: { t:"Auto-push to your books", d:"Approved docs hit your books instantly — category and tax mapped automatically." } },
              { icon: <IMessageSquare size={20}/>, th: { t:"รับสลิปผ่าน LINE Bot", d:"แค่ส่งรูปสลิปให้ Bot — Slippy รับ ตรวจ และแจ้งผลกลับใน LINE ของคุณ" }, en: { t:"Receive slips via LINE Bot", d:"Send a photo to the bot — Slippy ingests, processes, and replies in your LINE chat." } },
              { icon: <IBarChart size={20}/>, th: { t:"รายงาน VAT & WHT ครบจบ", d:"สรุปภาษีซื้อ-ขาย ภาษีหัก ณ ที่จ่าย รายเดือน พร้อม Export Excel / PDF เพื่อยื่นกรมสรรพากร" }, en: { t:"VAT & WHT reports", d:"Monthly VAT and withholding tax summaries — export to Excel/PDF for filing." } },
              { icon: <IBuilding size={20}/>, th: { t:"หลายองค์กรในบัญชีเดียว", d:"จัดการทั้งบริษัทและบัญชีส่วนตัวได้พร้อมกัน เหมาะกับนักบัญชีที่ดูแลหลายลูกค้า" }, en: { t:"Multi-org in one account", d:"Run your business and personal books side by side — perfect for accountants with multiple clients." } },
              { icon: <IShieldCheck size={20}/>, th: { t:"ปลอดภัยระดับธนาคาร · PDPA", d:"เข้ารหัสข้อมูลทุกขั้นตอน เก็บในเซิร์ฟเวอร์ในไทย รองรับ PDPA เต็มรูปแบบ" }, en: { t:"Bank-grade security · PDPA", d:"End-to-end encryption, data hosted in Thailand, fully PDPA compliant." } },
            ].map((f, i) => {
              const t = isTH ? f.th : f.en
              return (
                <div key={i} className="group bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-[14px] p-6 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:-translate-y-0.5 transition-all">
                  <div className="h-11 w-11 rounded-[10px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                    {f.icon}
                  </div>
                  <h3 className="text-[16px] font-semibold leading-snug">{t.t}</h3>
                  <p className="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed">{t.d}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────── */}
      <section id="how" className="py-20 lg:py-28 bg-gray-50/50 dark:bg-gray-900/50 border-y border-gray-100 dark:border-gray-800">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8">
          <SectionHeader
            eyebrow={isTH ? "วิธีการทำงาน" : "How it works"}
            title={isTH ? "3 ขั้นตอน จากใบเสร็จกองโต ถึงบัญชีเรียบร้อย" : "Three steps from a pile of receipts to clean books"}
            subtitle={isTH ? "ออกแบบมาให้เจ้าของกิจการที่ไม่อยากเสียเวลากับเอกสาร" : "Built for owners who refuse to lose another evening to paperwork."}
          />
          <div className="mt-12 lg:mt-16 grid lg:grid-cols-3 gap-5 lg:gap-6 relative">
            <div className="hidden lg:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-indigo-300 dark:via-indigo-500/30 to-transparent"/>
            {[
              { n:"01", icon:<IUploadCloud size={20}/>, th:{t:"รับเอกสารทุกช่องทาง",d:"Web upload, LINE Bot, Email forward หรือถ่ายรูปจาก Mobile App — ส่งใบเสร็จเข้ามาในแบบที่ถนัด"}, en:{t:"Capture from any channel",d:"Web upload, LINE Bot, email forward, or mobile camera — bring receipts in whichever way is easiest."} },
              { n:"02", icon:<ISparkles size={20}/>,   th:{t:"AI อ่านและตรวจสอบ",d:"OCR + AI ดึงข้อมูลผู้ขาย ยอด VAT และหมวดหมู่อัตโนมัติ พร้อมแจ้งจุดที่ต้องตรวจสอบ"}, en:{t:"AI extracts & verifies",d:"OCR + AI pulls vendor, total, VAT, category — and flags anything that needs your review."} },
              { n:"03", icon:<ISend size={20}/>,       th:{t:"ส่งเข้าระบบบัญชี",d:"อนุมัติเพื่อ push เข้าระบบบัญชีและรายงานภาษี ส่งกลับเป็น Activity Feed และ LINE notification"}, en:{t:"Push to your books",d:"Approve to push into your books and tax reports — notifications come back via app and LINE."} },
            ].map((s, i) => {
              const t = isTH ? s.th : s.en
              return (
                <div key={i} className="relative bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-[16px] p-7">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-[12px] flex items-center justify-center text-white shadow-lg shadow-indigo-500/30" style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1,#ec4899)" }}>
                      {s.icon}
                    </div>
                    <span className="text-[42px] font-bold tracking-tight text-indigo-100 dark:text-indigo-500/30 tabular-nums leading-none">{s.n}</span>
                  </div>
                  <h3 className="mt-5 text-[18px] font-semibold">{t.t}</h3>
                  <p className="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed">{t.d}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── CHANNELS ────────────────────────────────────────────── */}
      <section className="py-20 lg:py-28">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <SectionHeader
              eyebrow={isTH ? "ช่องทางการรับเอกสาร" : "Channels"}
              title={isTH ? "รับสลิปจากทุกที่ที่คุณทำงาน" : "Capture receipts wherever you work"}
              subtitle={isTH ? "ไม่ต้องเปลี่ยนพฤติกรรมพนักงาน — ส่งใบเสร็จมาทาง LINE ที่ใช้อยู่ทุกวันก็พอ" : "Don't change how your team works — just have them send slips through the LINE they already use."}
            />
          </div>
          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
            {[
              { icon:<IGlobe size={18}/>,        th:"Web Upload",  en:"Web Upload",   th_d:"ลากไฟล์มาวางในเบราว์เซอร์",         en_d:"Drag files in your browser" },
              { icon:<IMessageSquare size={18}/>, th:"LINE Bot",    en:"LINE Bot",     th_d:"ส่งรูปสลิปเข้าแชท LINE",             en_d:"Send slips to your LINE chat" },
              { icon:<IMail size={18}/>,          th:"Email Inbox", en:"Email Inbox",  th_d:"Forward email เข้า inbox ส่วนตัว",   en_d:"Forward to your private inbox" },
              { icon:<ISmartphone size={18}/>,    th:"Mobile App",  en:"Mobile App",   th_d:"ถ่ายรูปสลิปได้ที่ร้านทันที",        en_d:"Snap a receipt at the counter" },
            ].map((it, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-[14px] p-5 flex items-start gap-4 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition">
                <div className="h-10 w-10 rounded-[10px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">{it.icon}</div>
                <div>
                  <div className="text-[14.5px] font-semibold">{isTH ? it.th : it.en}</div>
                  <div className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{isTH ? it.th_d : it.en_d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 lg:py-28 bg-gray-50/50 dark:bg-gray-900/50 border-y border-gray-100 dark:border-gray-800">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8">

          {/* Header */}
          <div className="text-center max-w-[680px] mx-auto">
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
              {isTH ? "ราคา" : "Pricing"}
            </div>
            <h2 className="mt-3 text-[32px] lg:text-[40px] leading-[1.1] font-bold tracking-tight">
              {isTH ? "ใช้ทุกวันได้ฟรี จ่ายแค่ตอน AI อ่านเอกสารเยอะ" : "Free for everyday use — pay only for AI document volume"}
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-gray-500 dark:text-gray-400">
              {isTH ? "หารบิล นัดกีฬา เพิ่มเพื่อน ไม่จำกัดในทุกแพลน ไม่มีค่าติดตั้ง ยกเลิกได้ทุกเมื่อ" : "Split bills, sport groups and friends are unlimited on every plan. No setup fees, cancel anytime."}
            </p>
          </div>

          {/* Monthly / Yearly toggle */}
          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-1 bg-white/80 dark:bg-gray-800/80
              border border-gray-200 dark:border-gray-700 rounded-xl p-1 backdrop-blur-sm shadow-sm">
              <button onClick={() => setPricingYearly(false)}
                className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all
                  ${!pricingYearly
                    ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
                {isTH ? "รายเดือน" : "Monthly"}
              </button>
              <button onClick={() => setPricingYearly(true)}
                className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-1.5
                  ${pricingYearly
                    ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
                {isTH ? "รายปี" : "Yearly"}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full
                  bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  -{ANNUAL_DISCOUNT_PCT}%
                </span>
              </button>
            </div>
          </div>

          {/* ── Consumer plans: Free · Pro · Premium ─────────────────────── */}
          <div className="mt-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400 mb-4 text-center">
              {isTH ? "👤 สำหรับบุคคลทั่วไป" : "👤 Personal"}
            </p>
            <div className="grid sm:grid-cols-3 gap-4 lg:gap-5">
              {PLANS.filter(p => p.category === "consumer").map(plan => {
                const isHL         = plan.id === "pro"           // Pro = แนะนำสำหรับ consumer
                const isFree       = plan.priceTHB === 0
                const displayPrice = pricingYearly && plan.priceTHB > 0
                  ? annualMonthlyPrice(plan.priceTHB)
                  : plan.priceTHB
                const yearlySave   = plan.priceTHB > 0
                  ? plan.priceTHB * 12 - annualMonthlyPrice(plan.priceTHB) * 12
                  : 0

                return (
                  <div key={plan.id}
                    className={`relative rounded-[16px] p-6 flex flex-col
                      ${isHL
                        ? "text-white shadow-xl shadow-indigo-500/25 lg:scale-[1.02]"
                        : "bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"}`}
                    style={isHL ? { background: "linear-gradient(155deg,#4f46e5,#4338ca)" } : {}}>

                    {/* Badge */}
                    {plan.badge && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pink-500 text-white
                        text-[10.5px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md whitespace-nowrap">
                        {plan.badge}
                      </span>
                    )}

                    <div className={`text-[12px] font-bold uppercase tracking-wider ${isHL ? "text-white/70" : "text-gray-400"}`}>
                      {plan.nameEn}
                    </div>
                    <p className={`mt-0.5 text-[12px] leading-snug ${isHL ? "text-white/70" : "text-gray-400 dark:text-gray-500"}`}>
                      {isTH ? plan.taglineTh : plan.taglineEn}
                    </p>

                    {/* Price */}
                    <div className="mt-4 flex items-baseline gap-1">
                      {isFree ? (
                        <span className={`text-[34px] font-bold ${isHL ? "text-white" : ""}`}>
                          {isTH ? "ฟรี" : "Free"}
                        </span>
                      ) : (
                        <>
                          {pricingYearly && (
                            <span className={`text-[14px] line-through tabular-nums mr-1 ${isHL ? "text-white/40" : "text-gray-300"}`}>
                              ฿{plan.priceTHB.toLocaleString()}
                            </span>
                          )}
                          <span className={`text-[34px] font-bold tabular-nums ${isHL ? "text-white" : ""}`}>
                            ฿{displayPrice.toLocaleString()}
                          </span>
                          <span className={`text-[13px] pb-0.5 ${isHL ? "text-white/60" : "text-gray-400"}`}>
                            {isTH ? "/เดือน" : "/mo"}
                          </span>
                        </>
                      )}
                    </div>
                    {pricingYearly && yearlySave > 0 && (
                      <p className={`text-[11px] font-medium mt-0.5 ${isHL ? "text-emerald-300" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {isTH ? `ประหยัด ฿${yearlySave.toLocaleString()}/ปี` : `Save ฿${yearlySave.toLocaleString()}/yr`}
                      </p>
                    )}

                    {/* Quota pill */}
                    <div className={`mt-3 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full w-fit
                      ${isHL ? "bg-white/15 text-white/80" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
                      {plan.docQuota === 0
                        ? (isTH
                            ? `📄 ไม่จำกัดเอกสาร${plan.fairUseCapDocs ? ` (Fair use ~${plan.fairUseCapDocs.toLocaleString()}/เดือน)` : ""}`
                            : `📄 Unlimited docs${plan.fairUseCapDocs ? ` (fair use ~${plan.fairUseCapDocs.toLocaleString()}/mo)` : ""}`)
                        : `📄 ${plan.docQuota.toLocaleString()} ${isTH ? "ใบ/เดือน" : "docs/mo"}`}
                    </div>

                    {/* Features */}
                    <ul className="mt-5 space-y-2 flex-1">
                      {plan.features.map((f, k) => (
                        <li key={k} className={`flex items-start gap-2 text-[12.5px] ${isHL ? "text-white/85" : "text-gray-700 dark:text-gray-300"}`}>
                          <ICheck size={13} /> {f}
                        </li>
                      ))}
                    </ul>

                    {/* AI tier badge */}
                    <div className={`mt-4 text-[10.5px] font-medium px-2 py-1 rounded-lg w-fit
                      ${plan.modelTier === "priority"
                        ? isHL ? "bg-white/15 text-white/80" : "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
                        : plan.modelTier === "smart"
                        ? isHL ? "bg-white/15 text-white/80" : "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : isHL ? "bg-white/15 text-white/80" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
                      {plan.modelTier === "priority" ? "⚡ AI Priority (Sonnet)"
                       : plan.modelTier === "smart"   ? "🔀 AI Smart routing"
                       : "🤖 AI Standard (Haiku)"}
                    </div>

                    <Link href={isFree ? "/register" : `/register?plan=${plan.id}${pricingYearly ? "&yearly=1" : ""}`}
                      className={`mt-5 h-10 rounded-[10px] font-semibold text-[13.5px] transition flex items-center justify-center
                        ${isHL
                          ? "bg-white text-indigo-700 hover:bg-white/90"
                          : "border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                      {isFree
                        ? (isTH ? "เริ่มใช้ฟรี" : "Start free")
                        : (isTH ? `เลือก ${plan.nameTh}` : `Get ${plan.nameEn}`)}
                    </Link>
                    {!isFree && (
                      <p className={`text-[10px] text-center mt-1.5 ${isHL ? "text-white/50" : "text-gray-400"}`}>
                        {isTH ? "ยกเลิกได้ทุกเมื่อ" : "Cancel anytime"}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Business plans: Team · Business · Enterprise ─────────────── */}
          <div className="mt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400 mb-4 text-center">
              {isTH ? "🏢 สำหรับธุรกิจและองค์กร" : "🏢 Business & Enterprise"}
            </p>
            <div className="grid sm:grid-cols-3 gap-4 lg:gap-5">
              {PLANS.filter(p => p.category === "business").map(plan => {
                const isHL         = plan.id === "business"      // Business = แนะนำสำหรับ B2B
                const isEnterprise = plan.id === "enterprise"
                const displayPrice = pricingYearly && plan.priceTHB > 0
                  ? annualMonthlyPrice(plan.priceTHB)
                  : plan.priceTHB
                const yearlySave   = plan.priceTHB > 0
                  ? plan.priceTHB * 12 - annualMonthlyPrice(plan.priceTHB) * 12
                  : 0

                return (
                  <div key={plan.id}
                    className={`relative rounded-[16px] p-6 flex flex-col
                      ${isHL
                        ? "text-white shadow-xl shadow-emerald-500/20 lg:scale-[1.02]"
                        : "bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"}`}
                    style={isHL ? { background: "linear-gradient(155deg,#059669,#047857)" } : {}}>

                    {plan.badge && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white
                        text-[10.5px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md whitespace-nowrap">
                        {plan.badge}
                      </span>
                    )}

                    <div className={`text-[12px] font-bold uppercase tracking-wider ${isHL ? "text-white/70" : "text-gray-400"}`}>
                      {plan.nameEn}
                    </div>
                    <p className={`mt-0.5 text-[12px] leading-snug ${isHL ? "text-white/70" : "text-gray-400 dark:text-gray-500"}`}>
                      {isTH ? plan.taglineTh : plan.taglineEn}
                    </p>

                    {/* Price */}
                    <div className="mt-4 flex items-baseline gap-1">
                      {isEnterprise ? (
                        <span className={`text-[26px] font-bold ${isHL ? "text-white" : ""}`}>
                          {isTH ? "ติดต่อทีมขาย" : "Talk to us"}
                        </span>
                      ) : (
                        <>
                          {pricingYearly && (
                            <span className={`text-[14px] line-through tabular-nums mr-1 ${isHL ? "text-white/40" : "text-gray-300"}`}>
                              ฿{plan.priceTHB.toLocaleString()}
                            </span>
                          )}
                          <span className={`text-[34px] font-bold tabular-nums ${isHL ? "text-white" : ""}`}>
                            ฿{displayPrice.toLocaleString()}
                          </span>
                          <span className={`text-[13px] pb-0.5 ${isHL ? "text-white/60" : "text-gray-400"}`}>
                            {isTH ? "/เดือน" : "/mo"}
                          </span>
                        </>
                      )}
                    </div>
                    {pricingYearly && yearlySave > 0 && (
                      <p className={`text-[11px] font-medium mt-0.5 ${isHL ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {isTH ? `ประหยัด ฿${yearlySave.toLocaleString()}/ปี` : `Save ฿${yearlySave.toLocaleString()}/yr`}
                      </p>
                    )}

                    {/* Seats + quota */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full
                        ${isHL ? "bg-white/15 text-white/80" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
                        👥 {plan.maxUsers === 0
                          ? (isTH ? "ไม่จำกัดสมาชิก" : "Unlimited seats")
                          : `${plan.maxUsers} ${isTH ? "สมาชิก" : "seats"}`}
                      </span>
                      {plan.extraSeatTHB > 0 && (
                        <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full
                          ${isHL ? "bg-white/15 text-white/80" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
                          +฿{plan.extraSeatTHB}/{isTH ? "คน" : "seat"}
                        </span>
                      )}
                    </div>

                    {/* Features */}
                    <ul className="mt-5 space-y-2 flex-1">
                      {plan.features.map((f, k) => (
                        <li key={k} className={`flex items-start gap-2 text-[12.5px] ${isHL ? "text-white/85" : "text-gray-700 dark:text-gray-300"}`}>
                          <ICheck size={13} /> {f}
                        </li>
                      ))}
                    </ul>

                    {/* AI tier */}
                    <div className={`mt-4 text-[10.5px] font-medium px-2 py-1 rounded-lg w-fit
                      ${plan.modelTier === "priority"
                        ? isHL ? "bg-white/15 text-white/80" : "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
                        : isHL ? "bg-white/15 text-white/80" : "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"}`}>
                      {plan.modelTier === "priority" ? "⚡ AI Priority (Sonnet)" : "🔀 AI Smart routing"}
                    </div>

                    <Link
                      href={isEnterprise ? "mailto:hello@slippy.app?subject=Enterprise Plan" : `/register?plan=${plan.id}${pricingYearly ? "&yearly=1" : ""}`}
                      className={`mt-5 h-10 rounded-[10px] font-semibold text-[13.5px] transition flex items-center justify-center
                        ${isHL
                          ? "bg-white text-emerald-700 hover:bg-white/90"
                          : isEnterprise
                          ? "border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                          : "border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                      {isEnterprise
                        ? (isTH ? "นัดคุยกับทีมขาย" : "Talk to sales")
                        : (isTH ? `เลือก ${plan.nameTh}` : `Get ${plan.nameEn}`)}
                    </Link>
                    {!isEnterprise && (
                      <p className={`text-[10px] text-center mt-1.5 ${isHL ? "text-white/50" : "text-gray-400"}`}>
                        {isTH ? "ยกเลิกได้ทุกเมื่อ" : "Cancel anytime"}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Annual note */}
          {pricingYearly && (
            <p className="mt-5 text-center text-[11.5px] text-gray-400">
              {isTH
                ? `💡 ราคาที่แสดงคือ/เดือน เมื่อชำระล่วงหน้า 12 เดือน · ประหยัด ${ANNUAL_DISCOUNT_PCT}% ทุกแผน`
                : `💡 Prices shown per month when billed annually · ${ANNUAL_DISCOUNT_PCT}% off all plans`}
            </p>
          )}

          {/* Add-on teaser */}
          <div className="mt-8 rounded-[14px] border border-dashed border-gray-200 dark:border-gray-700
            bg-white/60 dark:bg-gray-900/60 px-6 py-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
            <div className="text-3xl">🧩</div>
            <div className="flex-1">
              <p className="text-[14px] font-semibold">
                {isTH ? "Add-ons — จ่ายเฉพาะที่ใช้จริง" : "Add-ons — pay only for what you need"}
              </p>
              <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-0.5">
                {isTH
                  ? "ภ.ง.ด. 3/53 (฿49) · ภ.พ. 30 (฿99) · Storage เพิ่ม (฿49/GB) · เพิ่ม Seat (฿99–149/คน/เดือน)"
                  : "WHT report (฿49) · VAT return (฿99) · Extra storage (฿49/GB) · Extra seat (฿99–149/seat/mo)"}
              </p>
            </div>
            <Link href="/register"
              className="shrink-0 h-9 px-4 rounded-[9px] border border-gray-200 dark:border-gray-700
                text-[13px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              {isTH ? "ดูรายละเอียด" : "Learn more"}
            </Link>
          </div>

        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 lg:py-28">
        <div className="max-w-[820px] mx-auto px-5 lg:px-8">
          <div className="text-center">
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">FAQ</div>
            <h2 className="mt-3 text-[32px] lg:text-[40px] leading-[1.1] font-bold tracking-tight">{isTH ? "คำถามที่พบบ่อย" : "Frequently asked questions"}</h2>
          </div>
          <div className="mt-10 lg:mt-12 space-y-3">
            {[
              { th:{q:"Slippy ทำงานกับซอฟต์แวร์บัญชีตัวไหนบ้าง?",a:"รองรับซอฟต์แวร์บัญชียอดนิยมหลายระบบ พร้อมเพิ่มอีกในปี 2026 หากใช้ระบบที่ยังไม่ได้เชื่อมตรง สามารถ Export เป็น Excel หรือ CSV ได้ทุกแพ็กเกจ"}, en:{q:"Which accounting software does Slippy work with?",a:"We integrate with several popular accounting platforms today, with more arriving in 2026. Any system we don't connect directly can still receive your data via Excel/CSV export."} },
              { th:{q:"AI แม่นยำแค่ไหน? ต้องตรวจสอบเองอีกไหม?",a:"ความแม่นยำเฉลี่ย 95% สำหรับเอกสารภาษาไทยทั่วไป เอกสารที่ confidence ต่ำกว่า 90% จะถูกส่งเข้าหน้า Review ให้คุณตรวจสอบก่อนอัปเดตเข้าบัญชี"}, en:{q:"How accurate is the AI? Do I still need to check?",a:"Average 95% on common Thai documents. Anything below 90% confidence is routed to a review queue before it touches your books."} },
              { th:{q:"ข้อมูลของฉันปลอดภัยไหม?",a:"เซิร์ฟเวอร์อยู่ในประเทศไทย เข้ารหัสข้อมูลทั้ง in-transit (TLS 1.3) และ at-rest (AES-256) ปฏิบัติตาม PDPA เต็มรูปแบบ"}, en:{q:"Is my data safe?",a:"Servers are hosted in Thailand. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We are fully PDPA compliant."} },
              { th:{q:"ใช้กับ LINE Bot อย่างไร?",a:"หลังสมัคร ระบบจะให้รหัสเชื่อมต่อ — เปิด LINE เพิ่ม @slippy เป็นเพื่อน ส่ง /connect ตามด้วยรหัส แค่นั้นเรียบร้อย จากนั้นส่งรูปสลิปได้เลย"}, en:{q:"How does the LINE Bot work?",a:"After signup we'll give you a connect code — add @slippy on LINE, send /connect CODE, and you're set. Send slips as photos from then on."} },
              { th:{q:"มีค่าเริ่มต้น หรือต้องผูกบัตรไหม?",a:"ไม่มีค่าติดตั้ง ไม่ต้องใช้บัตรเครดิตสำหรับแผน Free และทุกแพ็กเกจสามารถยกเลิกหรือลดระดับได้ทุกเมื่อ"}, en:{q:"Are there setup fees or card requirements?",a:"No setup fees. No credit card needed for the Free plan. Every paid plan can be cancelled or downgraded anytime."} },
              { th:{q:"มีทดลองใช้ Pro ฟรีไหม?",a:"แผน Starter และ Pro มีทดลองใช้ฟรี 14 วัน เต็มฟีเจอร์ ไม่ต้องผูกบัตร และไม่มี auto-renew"}, en:{q:"Is there a free trial of Pro?",a:"Yes — Starter and Pro come with a 14-day full-feature trial. No card required, no auto-renewal."} },
            ].map((it, i) => {
              const c   = isTH ? it.th : it.en
              const isO = faqOpen === i
              return (
                <div key={i} className={`rounded-[12px] border transition bg-white dark:bg-gray-900 ${isO ? "border-indigo-300 dark:border-indigo-500/40" : "border-gray-100 dark:border-gray-800"}`}>
                  <button onClick={() => setFaqOpen(isO ? -1 : i)} className="w-full flex items-center justify-between gap-4 text-left px-5 lg:px-6 py-4 lg:py-5">
                    <span className="text-[15px] lg:text-[15.5px] font-semibold leading-snug">{c.q}</span>
                    <span className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-all ${isO ? "bg-indigo-600 text-white rotate-45" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
                      <IPlus size={14}/>
                    </span>
                  </button>
                  {isO && <div className="px-5 lg:px-6 pb-5 text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">{c.a}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────────────── */}
      <section className="py-16 lg:py-24">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8">
          <div className="relative overflow-hidden rounded-[24px] bg-[#070a18] text-white p-10 lg:p-16 text-center">
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(67,56,202,0.18), transparent 50%)", opacity: 0.9 }}/>
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(rgba(99,102,241,0.18) 1px, transparent 1px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(circle at 50% 50%, black, transparent 70%)", WebkitMaskImage: "radial-gradient(circle at 50% 50%, black, transparent 70%)" }}/>
            <div className="relative">
              <div className="flex justify-center mb-6" style={{ filter: "drop-shadow(0 0 24px rgba(99,102,241,0.5))" }}>
                <LogoMark size={56}/>
              </div>
              <h2 className="text-[32px] lg:text-[44px] leading-[1.1] font-bold tracking-tight">
                {isTH ? "พร้อมจะคืนเย็นวันศุกร์ของคุณ?" : "Ready to get your Friday evenings back?"}
              </h2>
              <p className="mt-4 text-[15.5px] lg:text-[16px] text-white/65 max-w-[540px] mx-auto leading-relaxed">
                {isTH ? "เริ่มต้นใช้ Slippy ฟรี 50 เอกสาร/เดือน ไม่ต้องผูกบัตร — ตั้งค่าเสร็จใน 2 นาที" : "Start Slippy free with 50 docs/month, no card needed — set up in 2 minutes."}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/register" className="inline-flex items-center gap-2 h-12 px-6 rounded-[10px] bg-white text-[#070a18] font-semibold text-[14.5px] hover:bg-white/90 transition">
                  {isTH ? "เริ่มใช้งานฟรี" : "Start free"} <IArrowRight size={15}/>
                </Link>
                <a href="mailto:hello@slippy.app" className="inline-flex items-center gap-2 h-12 px-5 rounded-[10px] border border-white/15 text-white text-[14px] hover:bg-white/5 transition">
                  {isTH ? "นัดคุยกับทีมขาย" : "Talk to sales"}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="max-w-[1200px] mx-auto px-5 lg:px-8 py-14 grid lg:grid-cols-12 gap-10 lg:gap-8">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2.5 mb-4">
              <LogoMark size={30}/>
              <span className="text-[18px] font-bold tracking-tight">Slippy</span>
            </div>
            <p className="text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed max-w-[300px]">
              {isTH ? "แพลตฟอร์มจัดการเอกสารบัญชีด้วย AI สำหรับ SME ไทย — รับ ตรวจสอบ และส่งเข้าระบบบัญชี อัตโนมัติ" : "AI-powered accounting document workspace for Thai SMEs — intake, verify and push to your books automatically."}
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[
                "M6 5l5 7-5 7h2l4-5.6L16 19h3l-5.5-7.5L18.5 5h-2L13 9.4 9 5z",
                "M13 22v-9h3l.5-4H13V6.5c0-1.1.3-1.9 1.9-1.9H17V1.1C16.6 1 15.5 1 14.3 1 11.7 1 10 2.5 10 5.3V9H7v4h3v9z",
                "M4 4h4v16H4zM6 2a2 2 0 110 4 2 2 0 010-4zm5 6h4v2c.7-1.3 2-2.2 3.8-2.2 4 0 4.7 2.6 4.7 6V20h-4v-6.4c0-1.5-.6-2.5-2-2.5s-2.4 1-2.4 2.5V20H11z",
              ].map((d, i) => (
                <a key={i} href="#" className="h-8 w-8 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d={d}/></svg>
                </a>
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
            {[
              { th:"ผลิตภัณฑ์", en:"Product",   links:[["Features","#features"],["Pricing","#pricing"],["Mobile App","/mobile-app"],["Changelog","/changelog"]] },
              { th:"องค์กร",    en:"Company",   links:[[isTH?"เกี่ยวกับเรา":"About","/about"],[isTH?"ลูกค้า":"Customers","/customers"],["Careers","/careers"],["Press","/press"]] },
              { th:"ทรัพยากร", en:"Resources", links:[["Help center","/help-center"],["API docs","/api-docs"],["Status","/status"],["Blog","/blog"]] },
              { th:"กฎหมาย",   en:"Legal",     links:[[isTH?"นโยบายความเป็นส่วนตัว":"Privacy","/privacy-policy"],[isTH?"นโยบาย Cookie":"Cookie","/cookie-policy"],["PDPA","/privacy-policy"],["DPA","/dpa"]] },
            ].map((col, i) => (
              <div key={i}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-800 dark:text-gray-100 mb-4">{isTH ? col.th : col.en}</div>
                <ul className="space-y-3">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-[13px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-50 transition">{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800">
          <div className="max-w-[1200px] mx-auto px-5 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-gray-400">
            <div>© 2026 Slippy. {isTH ? "สงวนลิขสิทธิ์ · บริษัท สลิปปี้ จำกัด" : "All rights reserved."}</div>
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5"><IShieldCheck size={12}/> PDPA Compliant</span>
              <span className="inline-flex items-center gap-1.5"><IGlobe size={12}/> {isTH ? "ไทย · กรุงเทพฯ" : "Thailand · Bangkok"}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
