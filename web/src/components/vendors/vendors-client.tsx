"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useState, useMemo, useCallback } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  Search, Download, MapPin, BarChart3, FileText, Clock,
  TrendingUp, Building2, Map, List, BadgeCheck,
  ChevronLeft, ChevronRight, Pencil, X, Check, Loader2,
  ExternalLink,
} from "lucide-react"
import { formatThb, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Vendor {
  id:              string
  name:            string
  tax_id:          string | null
  address:         string | null
  phone:           string | null
  category:        string | null
  lat:             number | null
  lng:             number | null
  doc_count:       number
  total_amount:    number
  vat_total:       number
  last_doc_date:   string | null
  status_counts?:  Record<string, number>
}

// Statuses excluded from totals/doc_count — shown separately so users know
// why a vendor's figures don't match the raw document count.
const PENDING_STATUSES  = ["pending", "processing", "reviewing", "flagged"]
const EXCLUDED_STATUSES = ["rejected", "failed"]

interface Props { vendors: Vendor[] }

const PAGE_SIZE = 24

// ── Category definitions ───────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "all",          label: "ทั้งหมด",        emoji: "📋" },
  { id: "food",         label: "อาหาร & เครื่องดื่ม", emoji: "🍽️" },
  { id: "transport",    label: "การเดินทาง",     emoji: "🚖" },
  { id: "utilities",    label: "สาธารณูปโภค",    emoji: "💡" },
  { id: "software",     label: "ซอฟต์แวร์ & Cloud", emoji: "☁️" },
  { id: "retail",       label: "ค้าปลีก",         emoji: "🛒" },
  { id: "health",       label: "สุขภาพ",           emoji: "🏥" },
  { id: "office",       label: "สำนักงาน",         emoji: "🏢" },
  { id: "fuel",         label: "น้ำมัน & พลังงาน", emoji: "⛽" },
  { id: "telecom",      label: "โทรคมนาคม",       emoji: "📶" },
  { id: "other",        label: "อื่นๆ",            emoji: "📦" },
]

// ── Lazy-load map ─────────────────────────────────────────────────────────────
const VendorMap = dynamic(() => import("./vendor-map"), { ssr: false, loading: () => (
  <div className="flex-1 flex items-center justify-center bg-muted/20 rounded-[12px]">
    <div className="text-sm text-muted-foreground">กำลังโหลดแผนที่...</div>
  </div>
)})

// ── Helpers ───────────────────────────────────────────────────────────────────
const THUMB_MAP: [string, string][] = [
  ["grab",       "🚖"], ["line man",  "🛵"], ["lineman",   "🛵"],
  ["foodpanda",  "🛵"], ["robinhood", "🛵"], ["shopee",    "🛍️"],
  ["lazada",     "🛍️"], ["amazon",    "☁️"], ["aws",       "☁️"],
  ["google",     "☁️"], ["microsoft", "☁️"], ["azure",     "☁️"],
  ["7-eleven",   "🧾"], ["7eleven",   "🧾"], ["makro",     "🛒"],
  ["lotus",      "🛒"], ["big c",     "🛒"], ["homepro",   "🔨"],
  ["shell",      "⛽"], ["ptt",       "⛽"], ["bangchak",  "⛽"],
  ["esso",       "⛽"], ["caltex",    "⛽"], ["ais",       "📶"],
  ["true",       "📶"], ["dtac",      "📶"], ["mea",       "💡"],
  ["pea",        "💡"], ["mwa",       "💧"], ["starbucks", "☕"],
  ["figma",      "🎨"], ["slack",     "🎨"], ["notion",    "🎨"],
]
function getThumb(name: string) {
  const l = name.toLowerCase()
  for (const [k, e] of THUMB_MAP) if (l.includes(k)) return e
  return "🏢"
}
function brandColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  const colors = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#ec4899","#84cc16","#6366f1"]
  return colors[Math.abs(h) % colors.length]
}
function catLabel(id: string | null) {
  return CATEGORIES.find(c => c.id === id)?.label ?? id ?? ""
}
function catEmoji(id: string | null) {
  return CATEGORIES.find(c => c.id === id)?.emoji ?? "📦"
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditVendorModal({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor
  onClose: () => void
  onSaved: (updated: Vendor) => void
}) {
  const [form, setForm] = useState({
    name:     vendor.name,
    tax_id:   vendor.tax_id    ?? "",
    address:  vendor.address   ?? "",
    phone:    vendor.phone     ?? "",
    category: vendor.category  ?? "other",
  })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const save = async () => {
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from("vendors")
        .update({
          name:     form.name.trim()    || vendor.name,
          tax_id:   form.tax_id.trim()  || null,
          address:  form.address.trim() || null,
          phone:    form.phone.trim()   || null,
          category: form.category       || null,
        })
        .eq("id", vendor.id)
        .select()
        .single()

      if (error) throw error
      toast.success("บันทึกข้อมูลผู้ขายแล้ว ✓")
      onSaved({ ...vendor, ...data })
      onClose()
    } catch (e: any) {
      toast.error("บันทึกไม่สำเร็จ: " + (e?.message ?? "unknown"))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = `w-full h-9 rounded-[8px] border border-border bg-card text-sm text-foreground
    px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15
    transition placeholder:text-muted-foreground/50`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-card border border-border rounded-[16px] shadow-2xl w-full max-w-[440px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-[8px] flex items-center justify-center font-bold text-white text-sm"
              style={{ background: brandColor(vendor.name) }}>
              {getThumb(vendor.name) === "🏢" ? vendor.name[0]?.toUpperCase() : getThumb(vendor.name)}
            </div>
            <span className="font-semibold text-[14px]">แก้ไขข้อมูลผู้ขาย</span>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-muted-foreground mb-1.5">ชื่อผู้ขาย / บริษัท</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputCls} placeholder="ชื่อผู้ขาย" />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-muted-foreground mb-1.5">เลขประจำตัวผู้เสียภาษี</label>
            <input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
              className={inputCls} placeholder="0000000000000" maxLength={13} />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-muted-foreground mb-1.5">ประเภทผู้ขาย</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className={inputCls}>
              {CATEGORIES.filter(c => c.id !== "all").map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-muted-foreground mb-1.5">เบอร์โทรศัพท์</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className={inputCls} placeholder="02-xxx-xxxx" />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-muted-foreground mb-1.5">ที่อยู่</label>
            <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              rows={2} className={`${inputCls} h-auto py-2 resize-none`} placeholder="ที่อยู่สาขา..." />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2.5">
          <button onClick={onClose} disabled={saving}
            className="h-9 px-4 rounded-[8px] border border-border text-sm font-medium text-foreground
              hover:bg-muted transition disabled:opacity-50">
            ยกเลิก
          </button>
          <button onClick={save} disabled={saving}
            className="h-9 px-4 rounded-[8px] bg-brand-500 hover:bg-brand-600 text-white text-sm
              font-semibold transition disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Compact Vendor Card ────────────────────────────────────────────────────────
function VendorCard({ v, onEdit }: { v: Vendor; onEdit: (v: Vendor) => void }) {
  const color = brandColor(v.name)
  const thumb = getThumb(v.name)
  const docsHref = `/documents?vendor=${encodeURIComponent(v.name)}`

  const counts = v.status_counts ?? {}
  const pendingCount  = PENDING_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0)
  const excludedCount = EXCLUDED_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0)

  return (
    <div className="bg-card border border-border rounded-[10px] p-3.5
      hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600
      transition-all duration-150 group relative flex flex-col">

      {/* Edit button */}
      <button
        onClick={e => { e.stopPropagation(); onEdit(v) }}
        className="absolute top-2 right-2 h-6 w-6 rounded-md opacity-0 group-hover:opacity-100
          bg-muted hover:bg-brand-50 dark:hover:bg-brand-500/10 text-muted-foreground
          hover:text-brand-600 flex items-center justify-center transition-all z-10">
        <Pencil className="w-3 h-3" />
      </button>

      {/* Header row */}
      <div className="flex items-center gap-2.5 pr-6">
        <div className="h-9 w-9 rounded-[8px] flex items-center justify-center
          font-bold text-white text-[14px] shrink-0 select-none"
          style={{ background: color }}>
          {thumb === "🏢" ? v.name[0]?.toUpperCase() ?? "?" : thumb}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground truncate text-[13px] leading-tight">
            {v.name}
          </p>
          {v.tax_id ? (
            <p className="text-[10.5px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
              <BadgeCheck className="w-2.5 h-2.5 shrink-0 text-emerald-500" />
              {v.tax_id}
            </p>
          ) : (
            <p className="text-[10.5px] text-muted-foreground/60 mt-0.5">ไม่มีเลขภาษี</p>
          )}
        </div>
      </div>

      {/* Category badge */}
      {v.category && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            {catEmoji(v.category)} {catLabel(v.category)}
          </span>
        </div>
      )}

      {/* Amounts row */}
      <div className="mt-2.5 flex items-end justify-between gap-2 flex-1">
        <div>
          <p className="text-[15px] font-bold text-foreground tabular-nums leading-tight">
            {formatThb(v.total_amount).replace(".00", "")}
          </p>
          {v.last_doc_date && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />
              {formatDate(v.last_doc_date)}
            </p>
          )}
        </div>
        {v.lat && v.lng && (
          <div className="flex items-center gap-0.5 text-[9.5px] text-emerald-600 dark:text-emerald-400
            bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
            <MapPin className="w-2.5 h-2.5" /> GPS
          </div>
        )}
      </div>

      {/* Status badges — pending review / excluded (rejected, cancelled) */}
      {(pendingCount > 0 || excludedCount > 0) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
              bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <Clock className="w-2.5 h-2.5" /> รอตรวจสอบ {pendingCount}
            </span>
          )}
          {excludedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
              bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
              <X className="w-2.5 h-2.5" /> ไม่รวม {excludedCount}
            </span>
          )}
        </div>
      )}

      {/* Footer — link to documents */}
      <Link href={docsHref}
        className="mt-3 pt-2.5 border-t border-border flex items-center justify-between
          text-[11.5px] text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400
          transition-colors group/link">
        <span className="flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          <span className="font-medium">{v.doc_count} เอกสาร</span>
        </span>
        <span className="flex items-center gap-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity text-[10.5px]">
          ดูเอกสาร <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
        </span>
      </Link>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string
  icon: React.ElementType; tone: "brand" | "emerald" | "purple" | "amber"
}) {
  const cls = {
    brand:   "bg-brand-500/10 text-brand-600 dark:text-brand-300",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    purple:  "bg-purple-500/10 text-purple-600 dark:text-purple-300",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  }[tone]
  return (
    <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3">
      <div className={cn("h-10 w-10 rounded-[10px] flex items-center justify-center shrink-0", cls)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-[18px] font-bold text-foreground tabular-nums truncate">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function VendorsClient({ vendors: initialVendors }: Props) {
  const [vendors,   setVendors]   = useState<Vendor[]>(initialVendors)
  const [query,     setQuery]     = useState("")
  const [sort,      setSort]      = useState<"total"|"docs"|"name">("total")
  const [tab,       setTab]       = useState<"list"|"map">("list")
  const [catFilter, setCatFilter] = useState("all")
  const [page,      setPage]      = useState(1)
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)

  const handleSaved = useCallback((updated: Vendor) => {
    setVendors(prev => prev.map(v => v.id === updated.id ? updated : v))
  }, [])

  // Filter + sort
  const filtered = useMemo(() => {
    let list = vendors
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.tax_id   ?? "").includes(q) ||
        (v.address  ?? "").toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q)
      )
    }
    if (catFilter !== "all") {
      list = list.filter(v => v.category === catFilter)
    }
    return list.sort((a, b) =>
      sort === "total" ? b.total_amount - a.total_amount :
      sort === "docs"  ? b.doc_count    - a.doc_count    :
      a.name.localeCompare(b.name, "th")
    )
  }, [vendors, query, sort, catFilter])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset page on filter change
  const setFilter = useCallback((fn: () => void) => { fn(); setPage(1) }, [])

  // Category counts
  const catCounts = useMemo(() => {
    const map: Record<string, number> = { all: vendors.length }
    for (const v of vendors) {
      const key = v.category ?? "other"
      map[key] = (map[key] ?? 0) + 1
    }
    return map
  }, [vendors])

  const totalSpend = vendors.reduce((s, v) => s + v.total_amount, 0)
  const totalDocs  = vendors.reduce((s, v) => s + v.doc_count, 0)
  const geoCount   = vendors.filter(v => v.lat && v.lng).length

  return (
    <div className="page-wide space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[20px] font-bold text-foreground">ผู้ขาย / Vendors</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            {vendors.length} ผู้ขาย · บันทึกจากเอกสารที่อนุมัติแล้ว
          </p>
        </div>
        <button className="h-9 px-3.5 rounded-[10px] border border-border bg-card
          text-sm font-medium text-foreground hover:bg-muted transition
          inline-flex items-center gap-2">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="ผู้ขายทั้งหมด"  value={vendors.length.toString()}              icon={Building2}  tone="brand"   />
        <StatCard label="รวมยอดทั้งสิ้น" value={formatThb(totalSpend).replace(".00","")} icon={TrendingUp} tone="emerald"
          sub="ไม่รวมรายการที่ยกเลิก/ปฏิเสธ" />
        <StatCard label="จำนวนเอกสาร"   value={totalDocs.toLocaleString()}              icon={FileText}   tone="purple"  />
        <StatCard label="บนแผนที่"       value={geoCount.toString()}                     icon={MapPin}     tone="amber"
          sub={vendors.length ? `${Math.round(geoCount/vendors.length*100)}% ระบุตำแหน่งได้` : ""} />
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.filter(c => (catCounts[c.id] ?? 0) > 0 || c.id === "all").map(c => (
          <button key={c.id}
            onClick={() => setFilter(() => setCatFilter(c.id))}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-medium transition",
              catFilter === c.id
                ? "bg-brand-500 text-white shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            )}>
            <span>{c.emoji}</span>
            {c.label}
            <span className={cn(
              "text-[10px] font-bold px-1 rounded-full",
              catFilter === c.id ? "bg-white/25 text-white" : "bg-card text-muted-foreground"
            )}>
              {c.id === "all" ? vendors.length : (catCounts[c.id] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-card border border-border rounded-[10px] p-2.5
        flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5
            text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={e => setFilter(() => setQuery(e.target.value))}
            placeholder="ค้นหาชื่อ, Tax ID, ประเภท..."
            className="w-full h-8 rounded-[8px] border border-border bg-card text-sm
              text-foreground pl-8 pr-3 outline-none focus:border-brand-500
              focus:ring-2 focus:ring-brand-500/15 placeholder:text-muted-foreground/60 transition"
          />
        </div>

        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          className="h-8 rounded-[8px] border border-border bg-card text-[13px]
            text-foreground px-2.5 outline-none focus:border-brand-500 transition">
          <option value="total">ยอดรวม ↓</option>
          <option value="docs">เอกสาร ↓</option>
          <option value="name">ชื่อ A–Z</option>
        </select>

        <div className="flex items-center bg-muted rounded-[8px] p-0.5 gap-0.5 ml-auto">
          {([["list","รายการ", List], ["map","แผนที่", Map]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cn(
                "h-7 px-2.5 rounded-[6px] text-[12px] font-medium inline-flex items-center gap-1 transition",
                tab === key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Result count */}
      {tab === "list" && (
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            แสดง {paged.length > 0 ? `${(safePage-1)*PAGE_SIZE+1}–${Math.min(safePage*PAGE_SIZE, filtered.length)}` : "0"}
            {" "}จาก {filtered.length} ผู้ขาย
          </span>
          {query || catFilter !== "all" ? (
            <button onClick={() => setFilter(() => { setQuery(""); setCatFilter("all") })}
              className="flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline">
              <X className="w-3 h-3" /> ล้างตัวกรอง
            </button>
          ) : null}
        </div>
      )}

      {/* Content */}
      {tab === "list" ? (
        <>
          {paged.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {paged.map(v => (
                <VendorCard key={v.id} v={v} onEdit={setEditVendor} />
              ))}
            </div>
          ) : (
            <div className="bg-card border border-dashed border-border rounded-[12px] py-16 text-center">
              <Building2 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-[13px] font-medium text-foreground">ไม่พบผู้ขาย</p>
              <p className="text-[12px] text-muted-foreground mt-1">ลองเปลี่ยนตัวกรอง</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={safePage === 1}
                className="h-8 w-8 rounded-[8px] border border-border bg-card flex items-center justify-center
                  text-muted-foreground hover:bg-muted transition disabled:opacity-40">
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page numbers */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<(number | "...")[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i-1] as number) > 1) acc.push("...")
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) => p === "..." ? (
                  <span key={`e${i}`} className="text-[12px] text-muted-foreground px-1">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)}
                    className={cn(
                      "h-8 min-w-[32px] px-2 rounded-[8px] text-[13px] font-medium transition",
                      safePage === p
                        ? "bg-brand-500 text-white shadow-sm"
                        : "border border-border bg-card text-foreground hover:bg-muted"
                    )}>
                    {p}
                  </button>
                ))
              }

              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={safePage === totalPages}
                className="h-8 w-8 rounded-[8px] border border-border bg-card flex items-center justify-center
                  text-muted-foreground hover:bg-muted transition disabled:opacity-40">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[12px] overflow-hidden border border-border" style={{ height: 560 }}>
          <VendorMap vendors={filtered} />
        </div>
      )}

      {/* Top 5 by spend */}
      {tab === "list" && filtered.length > 0 && (
        <div className="bg-card border border-border rounded-[12px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-500" />
            <span className="text-[13px] font-semibold text-foreground">
              Top {Math.min(5, filtered.length)} ยอดใช้จ่ายสูงสุด
            </span>
          </div>
          <div className="p-4 space-y-2.5">
            {filtered.slice(0, 5).map((v, i) => {
              const pct = filtered[0].total_amount > 0 ? Math.round((v.total_amount / filtered[0].total_amount) * 100) : 0
              return (
                <div key={v.id} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-muted-foreground w-4 text-right">{i+1}</span>
                  <div className="h-7 w-7 rounded-[6px] flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: brandColor(v.name) }}>
                    {getThumb(v.name) === "🏢" ? v.name[0]?.toUpperCase() : getThumb(v.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12.5px] font-medium truncate">{v.name}</span>
                      <span className="text-[12.5px] font-bold tabular-nums ml-2 shrink-0">
                        {formatThb(v.total_amount).replace(".00","")}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground w-7 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editVendor && (
        <EditVendorModal
          vendor={editVendor}
          onClose={() => setEditVendor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
