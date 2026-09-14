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
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Plus, TrendingUp, TrendingDown, X, Wallet, ChevronLeft, ChevronRight, Calculator, Landmark } from "lucide-react"
import Link from "next/link"
import type { WealthDoc, WealthSeries, WealthCategory } from "@/app/(app)/personal/wealth/page"

/* ─── Props ───────────────────────────────────────────────────────────────── */

export interface WealthClientProps {
  monthSpend:     number
  prevMonthSpend: number
  monthlySeries:  WealthSeries[]
  categories:     WealthCategory[]
  totalThisYear:  number
  recentDocs:     WealthDoc[]
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const fmtTHB = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
}

const HEALTH_CATEGORIES = [
  "อาหาร", "สุขภาพ", "ออกกำลังกาย", "เดินทาง", "ความบันเทิง",
  "การศึกษา", "ช็อปปิ้ง", "สาธารณูปโภค", "อื่นๆ",
]

const CAT_COLORS = [
  "bg-emerald-500", "bg-teal-500", "bg-sky-500", "bg-violet-500", "bg-amber-500",
]

/* ─── Line chart ──────────────────────────────────────────────────────────── */

function LineChart({ series }: { series: WealthSeries[] }) {
  if (series.length < 2) return null
  const W = 400
  const H = 120
  const pad = { top: 8, right: 8, bottom: 28, left: 8 }
  const max = Math.max(...series.map(s => s.value), 1)
  const pts = series.map((s, i) => {
    const x = pad.left + (i / (series.length - 1)) * (W - pad.left - pad.right)
    const y = pad.top + (1 - s.value / max) * (H - pad.top - pad.bottom)
    return { x, y, ...s }
  })
  const pathD = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ")
  const areaD = [
    pathD,
    `L${pts[pts.length - 1].x},${H - pad.bottom}`,
    `L${pts[0].x},${H - pad.bottom}`,
    "Z",
  ].join(" ")

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wealthGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#wealthGrad)" />
      <path d={pathD} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="#10b981" />
          <text x={p.x} y={H - 4} textAnchor="middle" fontSize={9} fill="currentColor" className="text-muted-foreground opacity-60">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/* ─── Add expense modal ───────────────────────────────────────────────────── */

function AddExpenseModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd:   (doc: WealthDoc) => void
}) {
  const [vendorName, setVendorName]       = useState("")
  const [amount, setAmount]               = useState("")
  const [category, setCategory]           = useState("")
  const [date, setDate]                   = useState(new Date().toISOString().split("T")[0])
  const [loading, setLoading]             = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount) { toast.error("กรุณากรอกยอดเงิน"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/personal/wealth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_name:     vendorName.trim() || "รายการส่วนตัว",
          total_amount:    Number(amount),
          health_category: category || null,
          document_date:   date,
          is_personal:     true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "เกิดข้อผิดพลาด")
      onAdd({
        id:              data.id ?? crypto.randomUUID(),
        vendor_name:     vendorName.trim() || "รายการส่วนตัว",
        total_amount:    Number(amount),
        document_date:   date,
        health_category: category || null,
      })
      toast.success("เพิ่มรายการเรียบร้อย")
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-[16px] shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-[17px] font-semibold">เพิ่มรายการ</h3>
              <p className="text-xs text-muted-foreground mt-0.5">บันทึกค่าใช้จ่ายส่วนตัว</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">ร้านค้า / ผู้รับเงิน</label>
              <input
                value={vendorName}
                onChange={e => setVendorName(e.target.value)}
                placeholder="เช่น Tops, Central, Netflix"
                className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm
                  outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition"
              />
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">ยอดเงิน (฿) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm
                  outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition"
              />
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">หมวดหมู่</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm
                  outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition"
              >
                <option value="">เลือกหมวดหมู่</option>
                {HEALTH_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">วันที่</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm
                  outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-[10px] hover:bg-muted text-sm font-medium transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={loading}
                className="h-9 px-5 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ──────────────────────────────────────────────────────── */

export function WealthClient({
  monthSpend,
  prevMonthSpend,
  monthlySeries,
  categories,
  totalThisYear,
  recentDocs: initialDocs,
}: WealthClientProps) {
  const [showModal, setShowModal] = useState(false)
  const [docs, setDocs]           = useState<WealthDoc[]>(initialDocs)

  const delta    = monthSpend - prevMonthSpend
  const deltaPct = prevMonthSpend > 0 ? Math.round(Math.abs(delta / prevMonthSpend) * 100) : 0
  const up       = delta > 0

  const catMax = categories[0]?.total ?? 1

  const handleAdd = (doc: WealthDoc) => {
    setDocs(prev => [doc, ...prev])
  }

  return (
    <div className="p-6 lg:p-7 max-w-[960px] animate-fade-in">

      {/* ── Back + Header ── */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/personal"
            className="h-9 w-9 rounded-[10px] border border-border hover:bg-muted flex items-center justify-center transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Wealth Tracker</h2>
            <p className="text-muted-foreground text-sm">ติดตามการใช้จ่ายส่วนตัว</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium
            transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
        </button>
      </div>

      {/* ── Hero card ── */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 70% 30%, white 0%, transparent 70%)" }} />
        <p className="text-sm text-white/70 mb-1">ค่าใช้จ่ายเดือนนี้</p>
        <p className="text-4xl font-bold tracking-tight">{fmtTHB(monthSpend)}</p>
        <div className="flex items-center gap-2 mt-2">
          {up ? (
            <TrendingUp className="w-4 h-4 text-red-300" />
          ) : (
            <TrendingDown className="w-4 h-4 text-emerald-200" />
          )}
          <span className={cn("text-sm font-medium", up ? "text-red-200" : "text-emerald-200")}>
            {up ? "+" : "-"}{deltaPct}% จากเดือนที่แล้ว ({fmtTHB(prevMonthSpend)})
          </span>
        </div>
        <div className="mt-4 pt-4 border-t border-white/20 flex gap-6">
          <div>
            <p className="text-xs text-white/60">รวมปีนี้</p>
            <p className="font-semibold">{fmtTHB(totalThisYear)}</p>
          </div>
        </div>
      </div>

      {/* ── Tools ── */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <Link
          href="/personal/wealth/loan-calculator"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors group"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">คำนวณผ่อน/โปะคอนโด</p>
            <p className="text-xs text-muted-foreground">เทียบดอกเบี้ยที่ประหยัดได้ (what-if)</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <Link
          href="/personal/wealth/loans"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors group"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">สินเชื่อของฉัน</p>
            <p className="text-xs text-muted-foreground">บันทึกการชำระจริง + วิเคราะห์สถานะ</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* ── Line chart ── */}
      <div className="rounded-2xl border bg-card p-5 mb-6">
        <h3 className="text-sm font-semibold mb-4">ค่าใช้จ่าย 6 เดือนล่าสุด</h3>
        <div className="h-[120px]">
          <LineChart series={monthlySeries} />
        </div>
      </div>

      {/* ── Category breakdown ── */}
      {categories.length > 0 && (
        <div className="rounded-2xl border bg-card p-5 mb-6">
          <h3 className="text-sm font-semibold mb-4">หมวดหมู่เดือนนี้ (Top 5)</h3>
          <div className="space-y-3">
            {categories.map((cat, i) => (
              <div key={cat.name} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 shrink-0 truncate">{cat.name}</span>
                <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", CAT_COLORS[i % CAT_COLORS.length])}
                    style={{ width: `${(cat.total / catMax) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-20 text-right shrink-0">{fmtTHB(cat.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent transactions ── */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">รายการล่าสุด</h3>
        </div>
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Wallet className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium">ยังไม่มีรายการ</p>
            <p className="text-sm text-muted-foreground mt-1">กดปุ่มเพิ่มรายการเพื่อเริ่มบันทึก</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 text-base">
                  {doc.health_category === "อาหาร" ? "🍽️"
                    : doc.health_category === "สุขภาพ" ? "🏥"
                    : doc.health_category === "ออกกำลังกาย" ? "🏃"
                    : doc.health_category === "เดินทาง" ? "🚗"
                    : "🧾"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.vendor_name ?? "รายการส่วนตัว"}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(doc.document_date)}</p>
                </div>
                {doc.health_category && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400 font-medium shrink-0">
                    {doc.health_category}
                  </span>
                )}
                <p className="text-sm font-semibold shrink-0">{fmtTHB(Number(doc.total_amount))}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <AddExpenseModal
          onClose={() => setShowModal(false)}
          onAdd={handleAdd}
        />
      )}
    </div>
  )
}
