/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * DashboardView — the whole dashboard, as pure presentation.
 *
 * All Supabase access lives in app/(app)/dashboard/page.tsx; this component only
 * receives plain data. Keeping the split means the layout can be rendered with
 * fixture data (no session, no DB) when checking the visual design.
 */

import Link from "next/link"
import {
  FileText, Clock, ArrowUpRight, QrCode, ChevronRight,
  AlertCircle, CheckCircle2, FileUp, Bell, Inbox,
  FileBadge, Mail, CreditCard, Zap,
  Receipt, FileSpreadsheet, FileMinus2, Plane, Users, ScanLine,
  Split, Settings2, Folder, Plus, TrendingUp, TrendingDown, Wallet,
  BarChart3,
} from "lucide-react"
import { formatThb } from "@/lib/utils"
import { DashboardUploadZone } from "@/components/documents/dashboard-upload-zone"
import { RecentDocumentsPanel, type HubDoc } from "@/components/dashboard/recent-documents-panel"

export interface DashboardViewProps {
  greeting:    string
  displayName: string
  orgId:       string
  orgSlug:     string
  org: { name: string; plan: string; docUsed: number; docQuota: number } | null
  /** Header slot — the "seed demo data" button on the real page. */
  headerAction?: React.ReactNode

  counts: {
    total: number; receipt: number; invoice: number; creditNote: number
    trips: number; pending: number; failed: number
  }
  docs:    { recent: HubDoc[]; mine: HubDoc[]; shared: HubDoc[] }
  folders: { id: string; name: string; count: number }[]
  spend: {
    thisMonth: number; prevMonth: number; vat: number; docCount: number
    byCategory: [string, number][]
  }
  notifications:  { id: string; type: string; title: string; body: string | null; read_at: string | null; created_at: string }[]
}

// ── Notification meta ──────────────────────────────────────────────────────────
function notifMeta(type: string): { icon: typeof Bell; color: string; bg: string } {
  switch (type) {
    case "document_approved":  return { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" }
    case "document_failed":    return { icon: AlertCircle,  color: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-500/10" }
    case "document_duplicate": return { icon: FileBadge,    color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/10" }
    case "quota_warning":      return { icon: AlertCircle,  color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/10" }
    case "quota_exceeded":     return { icon: AlertCircle,  color: "text-rose-600 dark:text-rose-400",     bg: "bg-rose-500/10" }
    case "payment_due":        return { icon: CreditCard,   color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/10" }
    case "payment_failed":     return { icon: CreditCard,   color: "text-rose-600 dark:text-rose-400",     bg: "bg-rose-500/10" }
    case "payment_success":    return { icon: CreditCard,   color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" }
    case "integration_sync":   return { icon: Zap,          color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10" }
    case "line_received":      return { icon: FileText,     color: "text-[#06C755]",                       bg: "bg-[#06C755]/10" }
    case "email_received":     return { icon: Mail,         color: "text-blue-600 dark:text-blue-400",     bg: "bg-blue-500/10" }
    default:                   return { icon: Bell,         color: "text-brand-600 dark:text-brand-300",   bg: "bg-brand-500/10" }
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "เมื่อกี้"
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชม.ที่แล้ว`
  const d = Math.floor(h / 24)
  return d === 1 ? "เมื่อวาน" : `${d} วันที่แล้ว`
}

function momLabel(cur: number, prev: number): { text: string; up: boolean | null } {
  if (prev === 0) return { text: "เดือนแรกที่มีข้อมูล", up: null }
  const pct = ((cur - prev) / prev) * 100
  const sign = pct >= 0 ? "+" : ""
  return { text: `${sign}${pct.toFixed(0)}% เทียบเดือนก่อน`, up: pct >= 0 }
}

// Dashboard-only shortcuts, reusing the icon set already shipped with the app.
const QUICK_ACTIONS = [
  { label: "หารบิล",       href: "/split",                   icon: Split,    tone: "violet" },
  { label: "อัปโหลดเอกสาร", href: "/documents?action=upload", icon: FileUp,   tone: "indigo" },
  { label: "สแกนเอกสาร",   href: "/documents?action=scan",   icon: ScanLine, tone: "blue"   },
  { label: "สร้างทริป",     href: "/trips",                   icon: Plane,    tone: "amber"  },
  // → /social/friends, not the /social feed: the Vita Social group is hidden
  // from the sidebar (see layout/sidebar.tsx), and a shortcut is the one place a
  // hidden section must not reappear. "เพื่อน" is also the closer match anyway.
  { label: "กลุ่มและเพื่อน", href: "/social/friends",          icon: Users,     tone: "purple" },
  { label: "รายงาน",        href: "/analytics",               icon: BarChart3, tone: "slate"  },
] as const

export function DashboardView({
  greeting, displayName, orgId, orgSlug, org, headerAction,
  counts, docs, folders, spend, notifications,
}: DashboardViewProps) {

  const docUsed     = org?.docUsed  ?? 0
  const docQuota    = org?.docQuota ?? 50
  const quotaPct    = Math.min((docUsed / Math.max(docQuota, 1)) * 100, 100)
  const isUnlimited = docQuota >= 99999

  const spendMom     = momLabel(spend.thisMonth, spend.prevMonth)
  const unreadNotifs = notifications.filter(n => !n.read_at).length

  // Quick access to documents — real counts, deep-linked into /documents
  const quickAccess = [
    { label: "ทั้งหมด",       value: counts.total,      href: "/documents",                  icon: FileText,        tone: "indigo" },
    { label: "บิล / ใบเสร็จ",  value: counts.receipt,    href: "/documents?type=receipt",     icon: Receipt,         tone: "violet" },
    { label: "ใบแจ้งหนี้",     value: counts.invoice,    href: "/documents?type=invoice",     icon: FileSpreadsheet, tone: "blue"   },
    { label: "ใบลดหนี้",      value: counts.creditNote, href: "/documents?type=credit_note", icon: FileMinus2,      tone: "amber"  },
    { label: "ทริป / เดินทาง", value: counts.trips,      href: "/trips",                      icon: Plane,           tone: "purple" },
    { label: "รอตรวจสอบ",     value: counts.pending,    href: "/documents?status=reviewing", icon: Clock,           tone: "slate"  },
  ] as const

  // "สิ่งที่ต้องจัดการ" — only real, actionable items
  const todos = [
    counts.pending > 0 && {
      key: "reviewing",
      label: `เอกสารรอตรวจสอบ ${counts.pending} รายการ`,
      hint:  "ยืนยันข้อมูลที่ AI อ่านมาให้",
      href:  "/documents?status=reviewing",
      icon:  Clock,
      cls:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    counts.failed > 0 && {
      key: "failed",
      label: `ประมวลผลไม่สำเร็จ ${counts.failed} รายการ`,
      hint:  "ลองส่งเข้าระบบใหม่อีกครั้ง",
      href:  "/documents?status=failed",
      icon:  AlertCircle,
      cls:   "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    },
    !isUnlimited && quotaPct >= 80 && {
      key: "quota",
      label: `ใช้โควตาแล้ว ${docUsed} / ${docQuota} เอกสาร`,
      hint:  "อัปเกรดแพ็กเกจก่อนโควตาเต็ม",
      href:  "/billing",
      icon:  Zap,
      cls:   "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
    unreadNotifs > 0 && {
      key: "notifs",
      label: `การแจ้งเตือนใหม่ ${unreadNotifs} รายการ`,
      hint:  "ยังไม่ได้เปิดอ่าน",
      href:  "/notifications",
      icon:  Bell,
      cls:   "bg-brand-500/10 text-brand-600 dark:text-brand-300",
    },
  ].filter(Boolean) as Array<{
    key: string; label: string; hint: string; href: string
    icon: typeof Clock; cls: string
  }>

  return (
    // Not .page-wide: the dashboard keeps its own p-4 step for phones. Same
    // 1600px cap and centering as that class, so it lines up with every other
    // wide page.
    <div className="dashboard-violet p-4 sm:p-6 lg:p-7 mx-auto w-full max-w-[1600px] space-y-5 animate-fade-in">

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[22px] sm:text-2xl font-bold leading-tight">
            {greeting}, {displayName} <span aria-hidden>👋</span>
          </h2>
          <p className="text-muted-foreground text-[13px] mt-1">
            วันนี้มีอะไรให้ Slippy ช่วยจัดการบ้าง?
          </p>
        </div>
        <div className="flex items-center gap-3">
          {headerAction}
          {org && (
            <div className="text-right">
              <p className="text-[13px] font-semibold truncate max-w-[200px]">{org.name}</p>
              <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">
                {org.plan}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── ทำรายการด่วน ─────────────────────────────────────────────────────── */}
      <section className="dashboard-violet-panel rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-[15px] font-semibold">ทำรายการด่วน</h3>
          <Link
            href="/settings"
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
          >
            <Settings2 className="h-3.5 w-3.5" /> ปรับแต่ง
          </Link>
        </div>
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-2.5">
          {QUICK_ACTIONS.map(({ label, href, icon: Icon, tone }) => (
            <Link
              key={label}
              href={href}
              className="dashboard-violet-action group rounded-xl border bg-card p-3.5
                min-h-[108px] flex flex-col items-center justify-center gap-2.5 text-center"
            >
              <span className={`dashboard-violet-action-icon dashboard-violet-action-icon--${tone}
                h-11 w-11 rounded-xl flex items-center justify-center`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[12.5px] font-semibold leading-snug
                group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── เข้าถึงเอกสารได้อย่างรวดเร็ว ──────────────────────────────────────── */}
      <section className="dashboard-violet-panel rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-[15px] font-semibold">เข้าถึงเอกสารได้อย่างรวดเร็ว</h3>
          <Link
            href="/documents"
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
          >
            ดูทั้งหมด <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {quickAccess.map(({ label, value, href, icon: Icon, tone }) => (
            <Link
              key={label}
              href={href}
              className="dashboard-violet-action rounded-xl border bg-card p-3.5 flex flex-col gap-2.5"
            >
              <span className={`dashboard-violet-action-icon dashboard-violet-action-icon--${tone}
                h-9 w-9 rounded-[10px] flex items-center justify-center`}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span>
                <span className="block text-[11.5px] text-muted-foreground">{label}</span>
                <span className="block text-[19px] font-bold tabular-nums mt-0.5">
                  {value.toLocaleString("th-TH")}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Drag & drop upload ───────────────────────────────────────────────── */}
      <DashboardUploadZone orgId={orgId} orgSlug={orgSlug} compact />

      {/* ── เอกสารล่าสุด ─────────────────────────────────────────────────────── */}
      <RecentDocumentsPanel recent={docs.recent} mine={docs.mine} shared={docs.shared} />

      {/* ── หมวดหมู่ที่เข้าถึงบ่อย ──────────────────────────────────────────────── */}
      <section className="dashboard-violet-panel rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-[15px] font-semibold">หมวดหมู่ที่เข้าถึงบ่อย</h3>
          <Link
            href="/documents"
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
          >
            ดูทั้งหมด <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {folders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Folder className="h-8 w-8 opacity-30" />
            <p className="text-[12.5px]">ยังไม่มีหมวดหมู่ — จัดหมวดหมู่เอกสารเพื่อให้ค้นหาได้ไวขึ้น</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {folders.map(f => (
              <Link
                key={f.id}
                href={`/documents?category=${encodeURIComponent(f.name)}`}
                className="dashboard-violet-action rounded-xl border bg-card p-3.5 flex flex-col gap-2.5"
              >
                <span className="h-9 w-9 rounded-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-300
                  flex items-center justify-center">
                  <Folder className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-[12.5px] font-semibold truncate">{f.name}</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {f.count.toLocaleString("th-TH")} เอกสาร
                  </span>
                </span>
              </Link>
            ))}
            <Link
              href="/documents"
              className="dashboard-violet-action rounded-xl border border-dashed bg-card p-3.5
                flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-brand-600"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[12px] font-medium text-center leading-snug">จัดหมวดหมู่เอกสาร</span>
            </Link>
          </div>
        )}
      </section>

      {/* ── ภาพรวมการใช้จ่าย · สิ่งที่ต้องจัดการ ─────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* Spending overview */}
        <section className="dashboard-violet-panel rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-[15px] font-semibold">ภาพรวมการใช้จ่าย (เดือนนี้)</h3>
            <Link
              href="/analytics"
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
            >
              ดูทั้งหมด <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <p className="text-[30px] font-bold leading-none tabular-nums">{formatThb(spend.thisMonth)}</p>
            <span className={`flex items-center gap-1 text-xs font-medium mb-1 ${
              spendMom.up === null ? "text-muted-foreground"
                : spendMom.up ? "text-rose-500" : "text-emerald-500"
            }`}>
              {spendMom.up === null ? null
                : spendMom.up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {spendMom.text}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 mt-4">
            {[
              { label: "เอกสารเดือนนี้", value: spend.docCount.toLocaleString("th-TH"), icon: FileText, tone: "text-brand-600 dark:text-brand-300" },
              { label: "ภาษีซื้อ (VAT)", value: formatThb(spend.vat),                   icon: Wallet,   tone: "text-purple-600 dark:text-purple-400" },
              { label: "เดือนก่อน",      value: formatThb(spend.prevMonth),             icon: Clock,    tone: "text-muted-foreground" },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="rounded-xl bg-muted/40 px-3 py-2.5">
                <Icon className={`h-4 w-4 ${tone}`} />
                <p className="text-[15px] font-semibold mt-1.5 tabular-nums truncate">{value}</p>
                <p className="text-[10.5px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {spend.byCategory.length > 0 && (
            <div className="mt-5 space-y-2.5">
              {spend.byCategory.map(([name, amount]) => {
                const pct = spend.thisMonth > 0 ? (amount / spend.thisMonth) * 100 : 0
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="truncate">{name}</span>
                      <span className="font-medium tabular-nums shrink-0">{formatThb(amount)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                      <div
                        className="h-1.5 rounded-full"
                        style={{ width: `${pct}%`, background: "linear-gradient(90deg,#6366f1,#8b5cf6)" }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Things needing attention */}
        <section className="dashboard-violet-panel rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-[15px] font-semibold">สิ่งที่ต้องจัดการ</h3>
            <Link
              href="/notifications"
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
            >
              ดูทั้งหมด <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          {todos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <CheckCircle2 className="h-9 w-9 text-emerald-500/60" />
              <p className="text-[13px]">เคลียร์หมดแล้ว ไม่มีอะไรค้าง 🎉</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todos.map(({ key, label, hint, href, icon: Icon, cls }) => (
                <Link
                  key={key}
                  href={href}
                  className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3
                    hover:bg-muted/40 transition-colors"
                >
                  <span className={`h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 ${cls}`}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          )}

          {/* Quota strip */}
          {org && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[12px] font-medium">
                  ใช้ไป {docUsed.toLocaleString("th-TH")} / {isUnlimited ? "∞" : docQuota.toLocaleString("th-TH")} เอกสาร
                </span>
                <Link href="/billing" className="text-[11.5px] font-semibold text-brand-600 dark:text-brand-300 hover:underline">
                  อัปเกรด
                </Link>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${quotaPct}%`,
                    background: quotaPct > 80
                      ? "linear-gradient(90deg,#f59e0b,#ef4444)"
                      : "linear-gradient(90deg,#6366f1,#8b5cf6)",
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── กิจกรรมล่าสุด · LINE ─────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Activity feed — from notifications table */}
        <div className="lg:col-span-2 rounded-[12px] border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">กิจกรรมล่าสุด</h3>
            <Link href="/notifications"
              className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline">
              ดูทั้งหมด
            </Link>
          </div>
          <div className="p-2 space-y-0.5">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Inbox className="w-8 h-8 opacity-40" />
                <p className="text-[12px]">ยังไม่มีกิจกรรม</p>
              </div>
            ) : (
              notifications.map((n) => {
                const { icon: Icon, color, bg } = notifMeta(n.type)
                return (
                  <Link key={n.id} href="/notifications"
                    className="flex gap-3 p-2.5 rounded-[8px] hover:bg-muted/50 transition">
                    <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium leading-snug">{n.title}</p>
                      {n.body && (
                        <p className="text-[11.5px] text-muted-foreground leading-snug truncate">{n.body}</p>
                      )}
                    </div>
                    <span className="text-[10.5px] text-muted-foreground shrink-0 whitespace-nowrap">
                      {relTime(n.created_at)}
                    </span>
                  </Link>
                )
              })
            )}
          </div>
        </div>

        {/* LINE Bot teaser card */}
        <div className="rounded-xl border bg-card overflow-hidden relative glow-radial">
          <div className="px-5 py-5 relative z-10">
            <div className="w-10 h-10 rounded-[10px] bg-[#06C755] flex items-center justify-center mb-3">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-semibold text-sm mb-1">เชื่อมต่อ LINE Bot</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              ถ่ายรูปสลิปส่งผ่าน LINE ได้เลย AI จัดการทุกอย่างอัตโนมัติ
            </p>
            <Link
              href="/settings/integrations"
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
            >
              ดูวิธีเชื่อมต่อ
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

    </div>
  )
}
