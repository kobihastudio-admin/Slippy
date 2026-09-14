"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useState, useEffect, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Icons }     from "@/components/ui/icons"
import { toast }     from "sonner"
import { createClient } from "@/lib/supabase/client"

// ── Types ────────────────────────────────────────────────────────────────────
type Consents = {
  necessary: boolean; ai: boolean; analytics: boolean
  marketing: boolean; research: boolean; cross_border: boolean
  updated_at?: string
}
type SecurityPrefs = { login_alerts: boolean; auto_lock: string; updated_at?: string }
type TotpFactor = { id: string; status: "verified" | "unverified"; friendly_name?: string | null }
type Session = {
  id: string; device_name: string | null; device_type: string | null
  os: string | null; browser: string | null; ip_address: string | null
  location: string | null; last_active: string; created_at: string; token_hash: string
}
type ActivityLog = {
  id: string; action: string; detail: string | null
  ip_address: string | null; created_at: string
}

// ── Tiny design-system shims ─────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-xl ${className}`}>{children}</div>
}

const TONE_CLASSES: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  purple:  "bg-purple-500/10 text-purple-600 dark:text-purple-300",
  rose:    "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  brand:   "bg-brand-500/10 text-brand-600 dark:text-brand-300",
  slate:   "bg-muted text-muted-foreground",
}

function Badge({ tone = "brand", dot = false, children, className = "" }: {
  tone?: string; dot?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONE_CLASSES[tone] ?? TONE_CLASSES.brand} ${className}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

function Btn({ children, variant = "default", size = "md", leftIcon, onClick, disabled, className = "" }: {
  children: React.ReactNode; variant?: "default"|"outline"|"ghost"|"destructive"
  size?: "sm"|"md"; leftIcon?: React.ReactNode; onClick?: () => void
  disabled?: boolean; className?: string
}) {
  const base = "inline-flex items-center gap-1.5 font-semibold rounded-lg transition-colors disabled:opacity-50"
  const sz   = size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-4 py-2 text-[13px]"
  const var_ = {
    default:     "bg-brand-600 text-white hover:bg-brand-500",
    outline:     "border border-border hover:bg-muted text-foreground",
    ghost:       "hover:bg-muted text-foreground",
    destructive: "bg-rose-600 text-white hover:bg-rose-500",
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sz} ${var_} ${className}`}>
      {leftIcon}{children}
    </button>
  )
}

function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      role="switch" aria-checked={on} onClick={onChange} disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${on ? "bg-brand-500" : "bg-muted"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  )
}

function SecRow({ icon, title, desc, right, tone = "brand", embed = false }: {
  icon: React.ReactNode; title: string; desc: string; right: React.ReactNode
  tone?: string; embed?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 ${embed ? "border border-border rounded-[10px] p-3" : "py-3 first:pt-0 last:pb-0"}`}>
      <span className={`h-9 w-9 rounded-[8px] flex items-center justify-center shrink-0 ${TONE_CLASSES[tone]}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[11.5px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  )
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PrivacyPage() {
  const [tab, setTab] = useState<"overview"|"pdpa"|"security"|"sessions"|"log"|"data">("overview")

  const tabs = [
    { id: "overview",  label: "ภาพรวม",            icon: <Icons.ShieldCheck size={14} /> },
    { id: "pdpa",      label: "PDPA & ความยินยอม", icon: <Icons.FileText size={14} /> },
    { id: "security",  label: "ความปลอดภัยบัญชี",  icon: <Icons.Eye size={14} /> },
    { id: "sessions",  label: "อุปกรณ์ที่ใช้งาน",  icon: <Icons.Smartphone size={14} /> },
    { id: "log",       label: "บันทึกกิจกรรม",     icon: <Icons.Bell size={14} /> },
    { id: "data",      label: "ข้อมูลของคุณ",       icon: <Icons.Download size={14} /> },
  ] as const

  return (
    <div className="page space-y-5">

      {/* ── Hero ── */}
      <div className="relative rounded-[16px] overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-500 to-brand-500 text-white p-6 lg:p-7">
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 50%), radial-gradient(circle at 10% 90%, white 0%, transparent 40%)" }} />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <Badge tone="emerald" className="!bg-white/20 !text-white border-0">
              <Icons.ShieldCheck size={11} /> สอดคล้อง PDPA
            </Badge>
            <h2 className="mt-3 text-[24px] font-bold tracking-tight">
              ความเป็นส่วนตัวคือพื้นฐานของ Slippy
            </h2>
            <p className="text-[13.5px] text-white/85 mt-2 leading-relaxed">
              ข้อมูลของคุณเป็นของคุณ — เราเข้ารหัสทุกชั้น เก็บในประเทศไทย
              และให้คุณควบคุมความยินยอมได้ตลอดเวลาตามกฎหมาย PDPA พ.ศ. 2562
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center w-full sm:w-auto">
            {[
              { label: "เข้ารหัส",  value: "AES-256"   },
              { label: "ที่เก็บ",   value: "🇹🇭 TH"     },
              { label: "ตรวจสอบ",  value: "ISO 27001" },
            ].map(s => (
              <div key={s.label} className="bg-white/15 backdrop-blur rounded-[10px] px-3 py-3 min-w-[88px]">
                <div className="text-[10px] uppercase tracking-wider opacity-80">{s.label}</div>
                <div className="text-[16px] font-bold mt-1">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`inline-flex items-center gap-1.5 px-3.5 h-10 text-[12.5px] font-semibold whitespace-nowrap border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? "border-brand-500 text-brand-600 dark:text-brand-300"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "overview"  && <OverviewTab />}
      {tab === "pdpa"      && <PdpaTab />}
      {tab === "security"  && <SecurityTab />}
      {tab === "sessions"  && <SessionsTab />}
      {tab === "log"       && <LogTab />}
      {tab === "data"      && <DataTab />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab() {
  const promises = [
    { icon: <Icons.ShieldCheck size={16}/>, tone: "emerald", title: "เข้ารหัสตั้งแต่อุปกรณ์ของคุณ",   desc: "ทุกใบเสร็จเข้ารหัสด้วย AES-256 ก่อนส่งขึ้น และอีกครั้งบนเซิร์ฟเวอร์" },
    { icon: <Icons.ShieldCheck size={16}/>, tone: "blue",    title: "เก็บในประเทศไทยเท่านั้น",        desc: "ใช้ Data Center กรุงเทพฯ ไม่ส่งข้อมูลส่วนบุคคลไปต่างประเทศ ยกเว้นได้รับความยินยอม" },
    { icon: <Icons.Eye size={16}/>,         tone: "purple",  title: "เราไม่อ่านข้อมูลของคุณ",          desc: "มีเพียง AI อ่านเพื่อสรุปข้อมูลให้คุณ พนักงานเข้าถึงได้เฉพาะกรณีคุณขอความช่วยเหลือเท่านั้น" },
    { icon: <Icons.Trash size={16}/>,       tone: "rose",    title: "สิทธิ์ลบข้อมูล",                  desc: "ขอลบข้อมูลทั้งหมดได้ทุกเมื่อ — เสร็จภายใน 30 วันตามกฎหมาย" },
    { icon: <Icons.Download size={16}/>,    tone: "amber",   title: "พกข้อมูลออกได้",                  desc: "ดาวน์โหลดเอกสารและข้อมูลของคุณทั้งหมดเป็น CSV/PDF/JSON ได้ตลอด" },
    { icon: <Icons.Zap size={16}/>,         tone: "brand",   title: "ไม่มีโฆษณา ไม่ขายข้อมูล",        desc: "รายได้เรามาจากค่าสมาชิกเท่านั้น ไม่ได้ขายข้อมูลให้บุคคลที่สาม" },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {promises.map((p, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 rounded-[10px] flex items-center justify-center shrink-0 ${TONE_CLASSES[p.tone]}`}>{p.icon}</div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold">{p.title}</div>
                <div className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">{p.desc}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Compliance badges */}
      <Card className="p-5">
        <h3 className="text-[14px] font-semibold">มาตรฐานที่เราปฏิบัติตาม</h3>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { l: "PDPA",     s: "พ.ร.บ. ไทย"    },
            { l: "GDPR",     s: "EU มาตรฐาน"    },
            { l: "ISO 27001",s: "ความปลอดภัย"   },
            { l: "SOC 2",    s: "Type II"        },
            { l: "OWASP",    s: "Top 10"         },
            { l: "PCI DSS",  s: "การชำระเงิน"   },
          ].map((b, i) => (
            <div key={i} className="border border-border rounded-[10px] p-3 text-center hover:border-brand-300 transition-colors">
              <div className="text-[13px] font-bold">{b.l}</div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">{b.s}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Data flow */}
      <Card className="p-6 overflow-hidden">
        <h3 className="text-[14px] font-semibold">เส้นทางข้อมูลของคุณ</h3>
        <p className="text-[12px] text-muted-foreground mt-1">ตั้งแต่ถ่ายภาพจนถึงรายงาน เราเข้ารหัสและตรวจสอบทุกขั้น</p>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            { icon: <Icons.Camera size={22}/>,     tone: "amber",   grad: "from-amber-500/20 to-amber-400/10",     ring: "ring-amber-400/25",   l: "ถ่ายภาพ",     d: "เข้ารหัสในเครื่อง" },
            { icon: <Icons.ShieldCheck size={22}/>, tone: "blue",   grad: "from-blue-500/20 to-blue-400/10",       ring: "ring-blue-400/25",    l: "ส่งผ่าน TLS", d: "TLS 1.3 only"      },
            { icon: <Icons.Sparkles size={22}/>,    tone: "purple", grad: "from-purple-500/20 to-purple-400/10",   ring: "ring-purple-400/25",  l: "AI อ่าน",     d: "ใช้แล้วลบทันที"   },
            { icon: <Icons.Building size={22}/>,    tone: "emerald",grad: "from-emerald-500/20 to-emerald-400/10", ring: "ring-emerald-400/25", l: "เก็บที่ไทย",  d: "AES-256, BKK"      },
            { icon: <Icons.BarChart size={22}/>,    tone: "brand",  grad: "from-brand-500/20 to-brand-400/10",     ring: "ring-brand-400/25",   l: "รายงาน",      d: "มองเห็นแค่คุณ"    },
          ] as const).map((s, i) => (
            <div key={i} className="relative">
              <div className={`bg-gradient-to-br ${s.grad} ring-1 ${s.ring} rounded-[14px] p-4 text-center flex flex-col items-center gap-2 hover:scale-[1.02] transition-transform`}>
                <div className={`h-11 w-11 rounded-[10px] flex items-center justify-center ${TONE_CLASSES[s.tone]} ring-1 ${s.ring} bg-card/70`}>{s.icon}</div>
                <div className="text-[12.5px] font-semibold leading-tight">{s.l}</div>
                <div className="text-[10.5px] text-muted-foreground leading-tight">{s.d}</div>
              </div>
              {i < 4 && <div className="hidden md:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10"><Icons.ChevronRight size={14} className="text-muted-foreground" /></div>}
            </div>
          ))}
        </div>
      </Card>

      {/* DPO contact */}
      <Card className="p-5 bg-brand-500/5 border-brand-500/30">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-brand-500/15 text-brand-600 flex items-center justify-center shrink-0">
            <Icons.Mail size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold">เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO)</div>
            <div className="text-[12px] text-muted-foreground">
              <a href="mailto:privacy@slippy.app" className="hover:text-brand-600 transition-colors">privacy@slippy.app</a>
              {" "}· ตอบภายใน 7 วัน
            </div>
          </div>
          <a href="mailto:privacy@slippy.app?subject=PDPA%20%E0%B8%84%E0%B8%B3%E0%B8%A3%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B8%AA%E0%B8%B4%E0%B8%97%E0%B8%98%E0%B8%B4%E0%B9%8C%20-%20Slippy" className="shrink-0">
            <Btn variant="outline" size="sm" leftIcon={<Icons.Mail size={12}/>}>ติดต่อ</Btn>
          </a>
        </div>
      </Card>
    </div>
  )
}

// ── PDPA & Consent ────────────────────────────────────────────────────────────
function PdpaTab() {
  const [consents, setConsents] = useState<Consents>({
    necessary: true, ai: true, analytics: true,
    marketing: false, research: false, cross_border: false,
  })
  const [loading, setLoading]     = useState(true)
  const [isPending, startSave]    = useTransition()
  const [savedAt,  setSavedAt]    = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/privacy/consents")
      .then(r => r.json())
      .then(d => { setConsents(d); setSavedAt(d.updated_at ?? null) })
      .finally(() => setLoading(false))
  }, [])

  const toggle = (k: keyof Consents) => {
    if (k === "necessary") return
    setConsents(c => ({ ...c, [k]: !c[k] }))
  }

  const save = () => {
    startSave(async () => {
      const r = await fetch("/api/privacy/consents", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(consents),
      })
      if (r.ok) {
        const now = new Date().toISOString()
        setSavedAt(now)
        toast.success("บันทึกความยินยอมแล้ว")
      } else {
        toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่")
      }
    })
  }

  const items: { id: keyof Consents; title: string; desc: string; lock?: boolean }[] = [
    { id: "necessary",   title: "จำเป็นสำหรับการใช้งาน",              desc: "การประมวลผลใบเสร็จและให้บริการพื้นฐาน — ปิดไม่ได้", lock: true },
    { id: "ai",          title: "AI อ่านเอกสารและจัดหมวด",           desc: "ใช้ Claude อ่านใบเสร็จและจัดหมวดหมู่อัตโนมัติ ข้อมูลจะถูกประมวลผลแล้วลบ" },
    { id: "analytics",   title: "การวิเคราะห์การใช้งาน (Anonymous)",  desc: "ช่วยให้เราปรับปรุงแอป โดยไม่ระบุตัวตน" },
    { id: "marketing",   title: "การตลาดและโปรโมชั่น",                desc: "รับโปรโมชั่น ข่าวสารฟีเจอร์ใหม่ทางอีเมลและ Push" },
    { id: "research",    title: "พัฒนาผลิตภัณฑ์",                    desc: "อนุญาตให้ทีมขอติดต่อสำหรับการสัมภาษณ์/ทดสอบฟีเจอร์ใหม่" },
    { id: "crossBorder" as keyof Consents, title: "การส่งข้อมูลไปต่างประเทศ", desc: "อนุญาตให้ใช้บริการ AI ในต่างประเทศ (เช่น Anthropic US) เพิ่มความเร็ว" },
  ]

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-[15px] font-semibold">ความยินยอมของคุณ</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              เปลี่ยนแปลงได้ตลอดเวลา
              {savedAt && ` · บันทึกครั้งล่าสุด ${fmtDate(savedAt)}`}
            </p>
          </div>
          {savedAt && <Badge tone="emerald" dot>อัปเดตแล้ว</Badge>}
        </div>

        {loading ? (
          <div className="mt-5 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center py-3 border-b border-border last:border-b-0">
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 divide-y divide-border">
            {items.map(it => {
              const key = it.id === ("crossBorder" as keyof Consents) ? "cross_border" as keyof Consents : it.id
              return (
                <div key={it.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-[13.5px] font-semibold">{it.title}</div>
                      {it.lock && <Badge tone="slate" className="text-[10px]">จำเป็น</Badge>}
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{it.desc}</div>
                  </div>
                  <Toggle
                    on={Boolean(consents[key])}
                    disabled={it.lock}
                    onChange={() => toggle(key)}
                  />
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] text-muted-foreground">การเปลี่ยนแปลงจะมีผลทันทีหลังบันทึก</div>
          <Btn leftIcon={isPending ? <Icons.Loader size={14}/> : <Icons.Check size={14}/>} onClick={save} disabled={isPending || loading}>
            {isPending ? "กำลังบันทึก…" : "บันทึก"}
          </Btn>
        </div>
      </Card>

      {/* PDPA Rights */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">สิทธิ์ของคุณตาม PDPA</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">มาตรา 30-37 — สิทธิ์ที่คุณมีต่อข้อมูลของคุณ</p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { icon: <Icons.Eye size={14}/>,          title: "สิทธิ์เข้าถึงข้อมูล", sub: "ขอดูข้อมูลที่เราเก็บ",    href: "?tab=data"     },
            { icon: <Icons.Edit size={14}/>,          title: "สิทธิ์แก้ไขข้อมูล",   sub: "แก้ไขข้อมูลที่ผิด",       href: "/settings"     },
            { icon: <Icons.Trash size={14}/>,         title: "สิทธิ์ลบข้อมูล",       sub: "ลบข้อมูลทั้งหมด",         href: "?tab=data"     },
            { icon: <Icons.Download size={14}/>,      title: "สิทธิ์โอนข้อมูล",      sub: "ดาวน์โหลดเป็นไฟล์",      href: "?tab=data"     },
            { icon: <Icons.X size={14}/>,             title: "สิทธิ์คัดค้าน",         sub: "คัดค้านการประมวลผล",      href: "mailto:privacy@slippy.app" },
            { icon: <Icons.AlertTriangle size={14}/>, title: "สิทธิ์ร้องเรียน",       sub: "ร้อง สคส. หรือศาล",      href: "https://www.pdpc.or.th" },
          ].map((r, i) => (
            <a key={i} href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
              className="text-left border border-border rounded-[10px] p-3 hover:border-brand-400 hover:bg-muted/50 transition-colors flex items-start gap-3">
              <span className="h-8 w-8 rounded-[8px] bg-brand-500/10 text-brand-600 flex items-center justify-center shrink-0">{r.icon}</span>
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">{r.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{r.sub}</div>
              </div>
              <Icons.ChevronRight size={14} className="text-muted-foreground shrink-0 mt-1" />
            </a>
          ))}
        </div>
      </Card>

      {/* Data retention */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">ระยะเวลาเก็บข้อมูล</h3>
        <div className="mt-4 space-y-3">
          {[
            { l: "ใบเสร็จและเอกสาร",             v: "7 ปี",              n: "ตามกฎหมายภาษีไทย"             },
            { l: "ข้อมูลโปรไฟล์",                v: "จนกว่าจะลบบัญชี",  n: "+ 30 วันสำหรับการกู้คืน"      },
            { l: "ภาพต้นฉบับ (ก่อน AI อ่าน)",   v: "90 วัน",            n: "ลบอัตโนมัติ"                  },
            { l: "Log การใช้งาน",                 v: "1 ปี",              n: "เพื่อการรักษาความปลอดภัย"     },
            { l: "AI training data",              v: "ไม่ใช้",            n: "ข้อมูลคุณไม่ถูกใช้ฝึก AI"    },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0">
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{r.l}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{r.n}</div>
              </div>
              <Badge tone="brand">{r.v}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Security ──────────────────────────────────────────────────────────────────
function SecurityTab() {
  const [prefs,    setPrefs]    = useState<SecurityPrefs>({ login_alerts: true, auto_lock: "5min" })
  const [loading,  setLoading]  = useState(true)
  const [isPending, startSave]  = useTransition()
  const [resetSent, setResetSent] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetch("/api/privacy/security")
      .then(r => r.json())
      .then(d => setPrefs(d))
      .finally(() => setLoading(false))
  }, [])

  const savePrefs = useCallback((next: SecurityPrefs) => {
    setPrefs(next)
    startSave(async () => {
      const r = await fetch("/api/privacy/security", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (r.ok) toast.success("บันทึกการตั้งค่าแล้ว")
      else toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่")
    })
  }, [])

  const sendPasswordReset = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })
    if (error) { toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่"); return }
    setResetSent(true)
    toast.success(`ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${user.email} แล้ว`)
  }

  return (
    <div className="space-y-5">
      {/* Auth methods */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">การยืนยันตัวตน</h3>
        {loading ? (
          <div className="mt-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-[10px]" />)}</div>
        ) : (
          <div className="mt-4 divide-y divide-border">
            <SecRow
              icon={<Icons.Bell size={16}/>} tone="amber"
              title="แจ้งเตือนเมื่อมีการเข้าสู่ระบบใหม่"
              desc="อีเมลและ Push ทันทีเมื่อมีอุปกรณ์ใหม่"
              right={
                <Toggle
                  on={prefs.login_alerts}
                  onChange={() => savePrefs({ ...prefs, login_alerts: !prefs.login_alerts })}
                  disabled={isPending}
                />
              }
            />
            <SecRow
              icon={<Icons.Bell size={16}/>} tone="purple"
              title="ล็อกอัตโนมัติ"
              desc="ล็อกแอปเมื่อไม่ได้ใช้งาน"
              right={
                <select
                  value={prefs.auto_lock}
                  onChange={e => savePrefs({ ...prefs, auto_lock: e.target.value })}
                  disabled={isPending}
                  className="h-9 rounded-[8px] border border-border bg-card text-[12px] px-2.5 outline-none focus:border-brand-500 disabled:opacity-50"
                >
                  <option value="immediate">ทันที</option>
                  <option value="1min">1 นาที</option>
                  <option value="5min">5 นาที</option>
                  <option value="30min">30 นาที</option>
                  <option value="never">ไม่ล็อก</option>
                </select>
              }
            />
            <SecRow
              icon={<Icons.Smartphone size={16}/>} tone="blue"
              title="Face ID / ลายนิ้วมือ"
              desc="ใช้ biometric แทนรหัสผ่านในแอปมือถือ"
              right={<Badge tone="slate">เฉพาะแอปมือถือ</Badge>}
            />
          </div>
        )}
      </Card>

      {/* Two-factor authentication */}
      <MfaCard />

      {/* Password */}
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">รหัสผ่าน</h3>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <SecRow
            icon={<Icons.Eye size={16}/>} tone="brand" embed
            title="เปลี่ยนรหัสผ่าน"
            desc={resetSent ? "ส่งลิงก์ไปที่อีเมลของคุณแล้ว" : "รับลิงก์รีเซ็ตทางอีเมล"}
            right={
              <Btn variant="outline" size="sm" onClick={sendPasswordReset} disabled={resetSent}>
                {resetSent ? "ส่งแล้ว ✓" : "ส่งลิงก์"}
              </Btn>
            }
          />
          <SecRow
            icon={<Icons.Sparkles size={16}/>} tone="purple" embed
            title="Passkey"
            desc="ลงชื่อเข้าใช้ด้วย biometric ไม่ต้องใช้รหัสผ่าน"
            right={<Badge tone="brand">เร็วๆ นี้</Badge>}
          />
        </div>
      </Card>

      {/* Sign out all */}
      <SignOutAllCard />
    </div>
  )
}

function MfaCard() {
  const supabase = createClient()
  const [factors, setFactors] = useState<TotpFactor[]>([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [enrollId, setEnrollId] = useState<string | null>(null)
  const [qrCode, setQrCode]     = useState<string | null>(null)
  const [secret, setSecret]     = useState<string | null>(null)
  const [code, setCode]         = useState("")

  const verifiedFactor = factors.find(f => f.status === "verified") ?? null

  const loadFactors = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (!error) setFactors(data.totp)
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadFactors() }, [loadFactors])

  const startEnroll = async () => {
    setBusy(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Slippy" })
    setBusy(false)
    if (error || !data) { toast.error(error?.message ?? "เปิดใช้งานไม่สำเร็จ"); return }
    setEnrollId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
  }

  const cancelEnroll = async () => {
    // The factor created by enroll() stays "unverified" until confirmed —
    // clean it up so it doesn't linger if the user backs out.
    if (enrollId) await supabase.auth.mfa.unenroll({ factorId: enrollId })
    setEnrollId(null); setQrCode(null); setSecret(null); setCode("")
  }

  const confirmEnroll = async () => {
    if (!enrollId || code.length !== 6) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollId, code })
    setBusy(false)
    if (error) { toast.error("รหัสไม่ถูกต้อง กรุณาลองใหม่"); return }
    toast.success("เปิดใช้งาน 2-Factor Authentication แล้ว")
    setEnrollId(null); setQrCode(null); setSecret(null); setCode("")
    await loadFactors()
  }

  const disable = async () => {
    if (!verifiedFactor) return
    if (!confirm("ปิดใช้งาน 2-Factor Authentication? บัญชีจะใช้แค่รหัสผ่านในการเข้าสู่ระบบ")) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success("ปิดใช้งานแล้ว")
    await loadFactors()
  }

  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold">2-Factor Authentication (2FA)</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">
        เพิ่มชั้นความปลอดภัยด้วยแอป Authenticator (Google Authenticator, Authy ฯลฯ) — ไม่บังคับ แนะนำให้เปิดใช้งาน
      </p>

      {loading ? (
        <div className="mt-4"><Skeleton className="h-14 w-full rounded-[10px]" /></div>
      ) : (
        <div className="mt-4">
          <SecRow
            icon={<Icons.ShieldCheck size={16}/>} tone={verifiedFactor ? "emerald" : "amber"} embed
            title="TOTP Authenticator"
            desc={verifiedFactor ? "เปิดใช้งานแล้ว — ต้องใช้รหัส 6 หลักทุกครั้งที่เข้าสู่ระบบ" : "ยังไม่เปิดใช้งาน"}
            right={
              verifiedFactor ? (
                <Btn variant="destructive" size="sm" onClick={disable} disabled={busy}>ปิดใช้งาน</Btn>
              ) : (
                <Btn variant="default" size="sm" onClick={startEnroll} disabled={busy || !!enrollId}>เปิดใช้งาน</Btn>
              )
            }
          />

          {qrCode && (
            <div className="mt-4 rounded-[10px] border border-border p-4 space-y-3">
              <p className="text-[12.5px] text-muted-foreground">
                สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน
              </p>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from Supabase, not an optimizable asset */}
                <img src={qrCode} alt="2FA QR code" className="h-40 w-40 rounded-lg border border-border bg-white p-2" />
                <div className="flex-1 space-y-3 min-w-0">
                  {secret && (
                    <div>
                      <p className="text-[11px] text-muted-foreground">หรือกรอกโค้ดนี้เอง</p>
                      <code className="block text-[12px] font-mono break-all bg-muted rounded px-2 py-1 mt-1">{secret}</code>
                    </div>
                  )}
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    className="w-32 h-10 rounded-[8px] border border-border bg-card text-center text-[16px] tracking-widest font-mono outline-none focus:border-brand-500"
                  />
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={confirmEnroll} disabled={busy || code.length !== 6}>ยืนยัน</Btn>
                    <Btn variant="ghost" size="sm" onClick={cancelEnroll} disabled={busy}>ยกเลิก</Btn>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function SignOutAllCard() {
  const router    = useRouter()
  const [loading, setLoading] = useState(false)

  const signOutAll = async () => {
    if (!confirm("ออกจากระบบทุกอุปกรณ์? คุณจะต้องลงชื่อเข้าใช้ใหม่")) return
    setLoading(true)
    const r = await fetch("/api/privacy/sessions", { method: "DELETE" })
    const d = await r.json()
    if (r.ok) {
      toast.success("ออกจากระบบทุกอุปกรณ์แล้ว")
      router.push(d.redirectTo ?? "/auth/login")
    } else {
      toast.error("เกิดข้อผิดพลาด")
      setLoading(false)
    }
  }

  return (
    <Card className="p-5 border-rose-500/30">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-[10px] bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
          <Icons.AlertTriangle size={16}/>
        </span>
        <div className="flex-1">
          <h3 className="text-[14px] font-semibold text-rose-600 dark:text-rose-400">ออกจากระบบทุกอุปกรณ์</h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            ใช้เมื่อคิดว่ามีคนอื่นเข้าถึงบัญชี — ทุกอุปกรณ์จะต้องลงชื่อเข้าใหม่รวมถึงอุปกรณ์นี้
          </p>
        </div>
        <Btn variant="destructive" size="sm" disabled={loading} onClick={signOutAll}
          leftIcon={loading ? <Icons.Loader size={12}/> : <Icons.LogOut size={12}/>}>
          {loading ? "กำลังออก…" : "ออกจากทุกอุปกรณ์"}
        </Btn>
      </div>
    </Card>
  )
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function SessionsTab() {
  const [sessions,     setSessions]     = useState<Session[]>([])
  const [currentHash,  setCurrentHash]  = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [revokingId,   setRevokingId]   = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/privacy/sessions")
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setCurrentHash(d.currentHash ?? null) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const revokeSession = async (id: string) => {
    setRevokingId(id)
    const r = await fetch(`/api/privacy/sessions/${id}`, { method: "DELETE" })
    if (r.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      toast.success("ออกจากระบบอุปกรณ์นั้นแล้ว")
    } else {
      toast.error("เกิดข้อผิดพลาด")
    }
    setRevokingId(null)
  }

  const deviceIcon = (type: string | null) =>
    type === "mobile" ? "📱" : type === "tablet" ? "📱" : "💻"

  const fmtTime = (iso: string) => {
    const d   = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000)      return "เมื่อกี้"
    if (diff < 3_600_000)   return `${Math.floor(diff/60_000)} นาทีที่แล้ว`
    if (diff < 86_400_000)  return `${Math.floor(diff/3_600_000)} ชั่วโมงที่แล้ว`
    if (diff < 604_800_000) return `${Math.floor(diff/86_400_000)} วันที่แล้ว`
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-[15px] font-semibold">อุปกรณ์ที่ลงชื่อเข้าใช้อยู่</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {loading ? "กำลังโหลด…" : `${sessions.length} อุปกรณ์ · เห็นบางอย่างไม่คุ้น? ออกจากระบบได้ทันที`}
            </p>
          </div>
          <Btn variant="outline" size="sm" onClick={load} leftIcon={<Icons.RotateCw size={12}/>}>รีเฟรช</Btn>
        </div>

        {loading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-[10px]" />)}
          </div>
        ) : sessions.length === 0 ? (
          <div className="mt-6 text-center text-[13px] text-muted-foreground py-4">
            ไม่พบข้อมูลอุปกรณ์ — รีเฟรชเพื่อโหลดใหม่
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {sessions.map(s => {
              const isCurrent = s.token_hash === currentHash
              return (
                <div key={s.id} className={`flex items-center gap-3 p-3 rounded-[10px] border ${isCurrent ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}>
                  <span className="h-10 w-10 rounded-[10px] bg-muted text-xl flex items-center justify-center shrink-0">
                    {deviceIcon(s.device_type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[13.5px] font-semibold">{s.device_name ?? "อุปกรณ์ไม่ทราบชื่อ"}</div>
                      {isCurrent && <Badge tone="emerald" dot>อุปกรณ์นี้</Badge>}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">
                      {[s.os, s.browser].filter(Boolean).join(" · ")}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      {s.ip_address && <span className="font-mono">{s.ip_address}</span>}
                      <span>· ใช้ล่าสุด {fmtTime(s.last_active)}</span>
                    </div>
                  </div>
                  {!isCurrent && (
                    <Btn
                      variant="ghost" size="sm"
                      className="text-rose-600 hover:bg-rose-500/10"
                      disabled={revokingId === s.id}
                      onClick={() => revokeSession(s.id)}
                      leftIcon={revokingId === s.id ? <Icons.Loader size={12}/> : <Icons.X size={12}/>}
                    >
                      ออก
                    </Btn>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Activity log ──────────────────────────────────────────────────────────────
const ACTION_META: Record<string, { icon: React.ReactNode; tone: string; label: string }> = {
  login:                  { icon: <Icons.User size={12}/>,         tone: "emerald", label: "ลงชื่อเข้าใช้สำเร็จ"          },
  logout:                 { icon: <Icons.LogOut size={12}/>,       tone: "slate",   label: "ออกจากระบบ"                   },
  consent_update:         { icon: <Icons.FileText size={12}/>,     tone: "brand",   label: "อัปเดตความยินยอม PDPA"         },
  security_update:        { icon: <Icons.ShieldCheck size={12}/>,  tone: "purple",  label: "อัปเดตการตั้งค่าความปลอดภัย"  },
  export_request:         { icon: <Icons.Download size={12}/>,     tone: "amber",   label: "ขอส่งออกข้อมูล"               },
  session_revoke:         { icon: <Icons.X size={12}/>,            tone: "rose",    label: "ออกจากระบบอุปกรณ์"            },
  session_revoke_all:     { icon: <Icons.LogOut size={12}/>,       tone: "rose",    label: "ออกจากระบบทุกอุปกรณ์"         },
  account_delete_request: { icon: <Icons.Trash size={12}/>,        tone: "rose",    label: "ขอลบบัญชี"                    },
}

function LogTab() {
  const [logs,    setLogs]    = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/privacy/activity")
      .then(r => r.json())
      .then(d => setLogs(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [])

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })
      + " · " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  }

  const exportLogs = () => {
    if (logs.length === 0) return
    const csv = ["วันที่,กิจกรรม,รายละเอียด,IP",
      ...logs.map(l => `"${fmt(l.created_at)}","${ACTION_META[l.action]?.label ?? l.action}","${l.detail ?? ""}","${l.ip_address ?? ""}"`)
    ].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }))
    a.download = `slippy-activity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-semibold">บันทึกกิจกรรมในบัญชี</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">เก็บไว้ 1 ปี · ใช้สำหรับตรวจสอบความปลอดภัย</p>
        </div>
        <Btn variant="outline" size="sm" leftIcon={<Icons.Download size={12}/>} onClick={exportLogs} disabled={loading || logs.length === 0}>
          ดาวน์โหลด CSV
        </Btn>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5 pt-1">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="mt-6 text-center py-8 text-[13px] text-muted-foreground">
          <Icons.Bell size={28} className="mx-auto mb-3 opacity-30" />
          ยังไม่มีบันทึกกิจกรรม
        </div>
      ) : (
        <div className="mt-5 relative">
          <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />
          <div className="space-y-3">
            {logs.map(e => {
              const meta = ACTION_META[e.action] ?? { icon: <Icons.Info size={12}/>, tone: "slate", label: e.action }
              return (
                <div key={e.id} className="flex items-start gap-3 relative">
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 border-2 border-card z-10 ${TONE_CLASSES[meta.tone]}`}>
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-[13px] font-semibold">{meta.label}</div>
                      <div className="text-[10.5px] text-muted-foreground tabular-nums">{fmt(e.created_at)}</div>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5 flex items-center gap-2">
                      {e.detail && <span>{e.detail}</span>}
                      {e.ip_address && <span className="font-mono opacity-60">{e.ip_address}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Your data ─────────────────────────────────────────────────────────────────
function DataTab() {
  const [exporting,  setExporting]  = useState(false)
  const [exportFmt,  setExportFmt]  = useState<"csv"|"json"|"pdf">("csv")
  const [showDelete, setShowDelete] = useState(false)
  const router = useRouter()

  const requestExport = async () => {
    setExporting(true)
    const r = await fetch("/api/privacy/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: exportFmt }),
    })
    const d = await r.json()
    if (r.ok) {
      toast.success(`เราจะส่งไฟล์ ${exportFmt.toUpperCase()} ไปที่อีเมล ${d.email} ภายใน 24 ชั่วโมง`)
    } else {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่")
    }
    setExporting(false)
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Export */}
        <Card className="p-5">
          <div className="h-10 w-10 rounded-[10px] bg-blue-500/10 text-blue-600 flex items-center justify-center mb-3">
            <Icons.Download size={16}/>
          </div>
          <h3 className="text-[15px] font-semibold">ดาวน์โหลดข้อมูลของคุณ</h3>
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
            สำเนาทั้งหมดของใบเสร็จ, รายงาน, การตั้งค่า — ส่งไปที่อีเมลของคุณ
          </p>
          <div className="mt-3 flex items-center gap-2">
            {(["csv","json","pdf"] as const).map(f => (
              <button key={f}
                onClick={() => setExportFmt(f)}
                className={`px-3 py-1 rounded-lg text-[12px] font-semibold border transition-colors ${exportFmt === f ? "bg-brand-600 text-white border-brand-600" : "border-border hover:bg-muted"}`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          <Btn
            className="mt-4 w-full justify-center"
            variant="outline"
            leftIcon={exporting ? <Icons.Loader size={13}/> : <Icons.Download size={13}/>}
            onClick={requestExport}
            disabled={exporting}
          >
            {exporting ? "กำลังเตรียม…" : `ขอดาวน์โหลด (${exportFmt.toUpperCase()})`}
          </Btn>
        </Card>

        {/* View data */}
        <Card className="p-5">
          <div className="h-10 w-10 rounded-[10px] bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3">
            <Icons.Eye size={16}/>
          </div>
          <h3 className="text-[15px] font-semibold">ดูข้อมูลที่เราเก็บ</h3>
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
            รายงานข้อมูลส่วนบุคคลทั้งหมดที่ Slippy เก็บเกี่ยวกับคุณ
          </p>
          <Btn className="mt-4 w-full justify-center" variant="outline"
            leftIcon={<Icons.Eye size={13}/>}
            onClick={() => toast.info("รายงานจะถูกส่งไปที่อีเมลของคุณ — อยู่ระหว่างพัฒนา")}
          >
            ดูรายงาน
          </Btn>
        </Card>

        {/* Portability */}
        <Card className="p-5">
          <div className="h-10 w-10 rounded-[10px] bg-purple-500/10 text-purple-600 flex items-center justify-center mb-3">
            <Icons.Send size={16}/>
          </div>
          <h3 className="text-[15px] font-semibold">ย้ายข้อมูลไปบริการอื่น</h3>
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
            ส่งข้อมูลทั้งหมดของคุณตรงไป FlowAccount, Xero หรือบริการที่รองรับ
          </p>
          <Btn className="mt-4 w-full justify-center" variant="outline"
            leftIcon={<Icons.ArrowUpRight size={13}/>}
            onClick={() => toast.info("ฟีเจอร์นี้กำลังพัฒนา — เร็วๆ นี้")}
          >
            เลือกปลายทาง
          </Btn>
        </Card>

        {/* Delete account */}
        <Card className="p-5 border-rose-500/30 bg-rose-500/5">
          <div className="h-10 w-10 rounded-[10px] bg-rose-500/15 text-rose-600 flex items-center justify-center mb-3">
            <Icons.Trash size={16}/>
          </div>
          <h3 className="text-[15px] font-semibold text-rose-700 dark:text-rose-300">ลบบัญชีและข้อมูลทั้งหมด</h3>
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
            ลบถาวรภายใน 30 วัน — รวมใบเสร็จ, รายงาน, การเชื่อมต่อ และข้อมูลส่วนตัว
          </p>
          <Btn variant="destructive" className="mt-4 w-full justify-center"
            leftIcon={<Icons.Trash size={13}/>}
            onClick={() => setShowDelete(true)}
          >
            ขอลบบัญชี
          </Btn>
        </Card>
      </div>

      {/* Legal note */}
      <Card className="p-5 bg-muted/40">
        <div className="flex items-start gap-3">
          <Icons.Info size={18} className="text-brand-600 dark:text-brand-300 mt-0.5 shrink-0"/>
          <div className="text-[12.5px] text-muted-foreground leading-relaxed">
            ตามมาตรา 30-37 ของ{" "}
            <b className="text-foreground">พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</b>{" "}
            Slippy จะดำเนินการตามคำขอของคุณภายใน 30 วันโดยไม่คิดค่าใช้จ่าย
            หากไม่ได้รับการตอบกลับ คุณสามารถร้องเรียนกับ
            สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) ได้ที่{" "}
            <a href="https://www.pdpc.or.th" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">pdpc.or.th</a>
          </div>
        </div>
      </Card>

      {/* Delete confirmation modal */}
      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} onDeleted={() => router.push("/")} />}
    </div>
  )
}

// ── Delete account modal ──────────────────────────────────────────────────────
function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm]   = useState("")
  const [loading, setLoading]   = useState(false)
  const REQUIRED = "ลบบัญชี"
  const ready = confirm === REQUIRED

  const doDelete = async () => {
    if (!ready) return
    setLoading(true)
    const r = await fetch("/api/privacy/delete-account", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    })
    const d = await r.json()
    if (r.ok) {
      toast.success("ลบบัญชีแล้ว — ขอบคุณที่เคยใช้ Slippy")
      onDeleted()
    } else {
      toast.error(d.error ?? "เกิดข้อผิดพลาด กรุณาติดต่อ privacy@slippy.app")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-[10px] bg-rose-500/15 text-rose-600 flex items-center justify-center shrink-0">
            <Icons.AlertTriangle size={18}/>
          </span>
          <div>
            <h3 className="text-[16px] font-bold text-rose-700 dark:text-rose-300">ยืนยันการลบบัญชี</h3>
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
              การกระทำนี้<b> ไม่สามารถย้อนกลับได้</b> — ข้อมูลทั้งหมดของคุณจะถูกลบถาวร รวมถึงใบเสร็จ รายงาน และการเชื่อมต่อทั้งหมด
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[12px] text-muted-foreground mb-2">
            พิมพ์ <code className="bg-muted px-1.5 py-0.5 rounded text-rose-600 font-mono font-bold">{REQUIRED}</code> เพื่อยืนยัน
          </p>
          <input
            type="text"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder={REQUIRED}
            className="w-full h-10 rounded-[10px] border border-border bg-background px-3 text-[13px] outline-none focus:border-rose-500 font-mono"
          />
        </div>

        <div className="mt-5 flex items-center gap-3 justify-end">
          <Btn variant="outline" onClick={onClose} disabled={loading}>ยกเลิก</Btn>
          <Btn
            variant="destructive"
            onClick={doDelete}
            disabled={!ready || loading}
            leftIcon={loading ? <Icons.Loader size={13}/> : <Icons.Trash size={13}/>}
          >
            {loading ? "กำลังลบ…" : "ลบบัญชีถาวร"}
          </Btn>
        </div>
      </div>
    </div>
  )
}
