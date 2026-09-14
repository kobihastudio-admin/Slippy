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
import { Download, TrendingUp, TrendingDown } from "lucide-react"
import { formatThb } from "@/lib/utils"

// ── Fallback demo data (shown only when real DB data is insufficient) ──────────
const DEMO_MONTH_SERIES = [
  { m: "มิ.ย.",  spend: 84300,  vat: 5510 },
  { m: "ก.ค.",   spend: 92100,  vat: 6022 },
  { m: "ส.ค.",   spend: 76500,  vat: 5005 },
  { m: "ก.ย.",   spend: 105200, vat: 6884 },
  { m: "ต.ค.",   spend: 118400, vat: 7748 },
  { m: "พ.ย.",   spend: 99300,  vat: 6498 },
  { m: "ธ.ค.",   spend: 132800, vat: 8689 },
  { m: "ม.ค.",   spend: 121500, vat: 7950 },
  { m: "ก.พ.",   spend: 109700, vat: 7179 },
  { m: "มี.ค.",  spend: 127200, vat: 8324 },
  { m: "เม.ย.",  spend: 131979, vat: 8633 },
  { m: "พ.ค.",   spend: 142380, vat: 9307 },
]

const DEMO_CATEGORY = [
  { name: "ค่า Software / Cloud",   value: 38200, color: "#6366f1" },
  { name: "ค่าเช่าสำนักงาน",       value: 35000, color: "#8b5cf6" },
  { name: "ค่าเดินทาง",             value: 18700, color: "#06b6d4" },
  { name: "ของใช้สำนักงาน",         value: 14250, color: "#10b981" },
  { name: "อาหารและเครื่องดื่ม",   value: 13420, color: "#f97316" },
  { name: "ค่าสาธารณูปโภค",         value: 11800, color: "#f59e0b" },
  { name: "ผ่อนสินค้า",             value: 9280,  color: "#a855f7" },
  { name: "ของใช้ส่วนตัว",          value: 9105,  color: "#14b8a6" },
  { name: "รับรองลูกค้า",           value: 8900,  color: "#ef4444" },
  { name: "อื่นๆ",                  value: 6155,  color: "#94a3b8" },
]

const DEMO_TOP_VENDORS = [
  { name: "Amazon Web Services",        count: 8,  total: 38200 },
  { name: "บจก. โอเอ็ม พร็อพเพอร์ตี้", count: 1,  total: 35000 },
  { name: "Grab (Thailand)",            count: 23, total: 12450 },
  { name: "7-Eleven",                   count: 41, total: 9870 },
  { name: "Starbucks Coffee",           count: 18, total: 3420 },
]

// Color palette for real category data
const CATEGORY_PALETTE = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f97316",
  "#f59e0b","#a855f7","#14b8a6","#ef4444","#94a3b8",
]

// ── Bar Chart (custom SVG) ──────────────────────────────────────────────────────
function BarChart({ series }: { series: { m: string; spend: number; vat: number }[] }) {
  const w = 800, h = 220, pad = { l: 44, r: 12, t: 16, b: 28 }
  const max = Math.max(...series.map(s => s.spend), 1)
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const groupW = innerW / series.length
  const barW   = Math.min(18, groupW * 0.38)
  const ticks  = 4

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = pad.t + (innerH / ticks) * i
          const v = max - (max / ticks) * i
          return (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y}
                stroke="hsl(var(--border))" strokeDasharray="2 4" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">
                {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
              </text>
            </g>
          )
        })}
        {series.map((s, i) => {
          const cx      = pad.l + groupW * i + groupW / 2
          const bhSpend = (s.spend / max) * innerH
          const bhVat   = (s.vat   / max) * innerH
          const isLast  = i === series.length - 1
          return (
            <g key={i}>
              <rect x={cx - barW - 1} y={pad.t + innerH - bhSpend} width={barW} height={bhSpend}
                rx={3} fill="#6366f1" opacity={isLast ? 1 : 0.82} />
              <rect x={cx + 1}        y={pad.t + innerH - bhVat}   width={barW} height={bhVat}
                rx={3} fill="#a855f7" opacity="0.75" />
              <text x={cx} y={h - pad.b + 14} textAnchor="middle" fontSize="9.5" fill="hsl(var(--muted-foreground))">
                {s.m}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Donut Chart ─────────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  let acc = 0
  const r = 70, cx = 100, cy = 100, stroke = 22
  const C = 2 * Math.PI * r

  if (total === 0) {
    return (
      <div className="flex items-center justify-center my-4">
        <div className="w-[200px] h-[200px] rounded-full border-[22px] border-muted flex items-center justify-center">
          <span className="text-[11px] text-muted-foreground text-center">ยังไม่มีข้อมูล</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center my-4">
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        {data.map((d, i) => {
          const frac   = d.value / total
          const dash   = frac * C
          const offset = -acc * C
          acc += frac
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={d.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
        })}
        <text x={cx} y={cy - 6}  textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">รวม</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="17" fontWeight="700" fill="hsl(var(--foreground))">
          {formatThb(total).replace(".00", "")}
        </text>
      </svg>
    </div>
  )
}

// ── Line Chart (VAT trend) ───────────────────────────────────────────────────────
function LineChart({ series }: { series: { m: string; spend: number; vat: number }[] }) {
  const w = 760, h = 200, pad = { l: 40, r: 12, t: 16, b: 28 }
  const max    = Math.max(...series.map(s => s.vat), 1)
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b

  const pts = series.map((s, i) => {
    const x = pad.l + (innerW / Math.max(series.length - 1, 1)) * i
    const y = pad.t + innerH - (s.vat / max) * innerH
    return [x, y] as [number, number]
  })
  const pathD = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")
  const areaD = pathD + ` L ${pts[pts.length - 1][0]} ${pad.t + innerH} L ${pts[0][0]} ${pad.t + innerH} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-3">
      <defs>
        <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map(i => {
        const y = pad.t + (innerH / 4) * i
        return <line key={i} x1={pad.l} x2={w - pad.r} y1={y} y2={y}
          stroke="hsl(var(--border))" strokeDasharray="2 4" />
      })}
      <path d={areaD} fill="url(#lineAreaGrad)" />
      <path d={pathD} fill="none" stroke="#6366f1" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill="white" stroke="#6366f1" strokeWidth={2} />
      ))}
      {series.map((s, i) => {
        const x = pad.l + (innerW / Math.max(series.length - 1, 1)) * i
        return (
          <text key={i} x={x} y={h - pad.b + 14} textAnchor="middle" fontSize="9.5" fill="hsl(var(--muted-foreground))">
            {s.m}
          </text>
        )
      })}
    </svg>
  )
}

// ── Mini stat card ──────────────────────────────────────────────────────────────
function MiniStat({ label, value, delta, tone = "brand" }: {
  label: string; value: string; delta: string | null; tone?: "brand" | "emerald" | "purple" | "amber"
}) {
  const positive = delta === null ? true : !String(delta).startsWith("-")
  return (
    <div className="bg-card border border-border rounded-[12px] p-4">
      <div className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-2 text-[22px] font-bold text-foreground tabular-nums">{value}</div>
      {delta !== null && (
        <div className={`mt-1 text-[12px] font-medium inline-flex items-center gap-1 ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {delta}
        </div>
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────────
interface Props {
  monthly:    any[]
  topVendors: any[]
  categories: { name: string; value: number }[]
}

export function AnalyticsClient({ monthly, topVendors, categories }: Props) {
  const [range, setRange] = useState("12m")

  // Build real series when >= 3 months of data available
  const hasRealMonthly = monthly.length >= 3
  const series = hasRealMonthly
    ? monthly.slice(-12).map(m => ({
        m:     (m.month as string).slice(5, 7) + "/" + (m.month as string).slice(2, 4),
        spend: Number(m.grand_total ?? 0),
        vat:   Number(m.vat_total   ?? 0),
      }))
    : DEMO_MONTH_SERIES

  // KPI stats from real series
  const totalYear = series.reduce((s, m) => s + m.spend, 0)
  const totalVat  = series.reduce((s, m) => s + m.vat,   0)
  const totalDocs = hasRealMonthly
    ? monthly.reduce((s, m) => s + Number(m.doc_count ?? 0), 0)
    : 0
  const ave = series.length > 0 ? Math.round(totalYear / series.length) : 0

  // Month-over-month delta for main KPI
  let momDelta: string | null = null
  if (series.length >= 2) {
    const last = series[series.length - 1].spend
    const prev = series[series.length - 2].spend
    if (prev > 0) {
      const pct = ((last - prev) / prev) * 100
      momDelta = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs เดือนที่แล้ว`
    }
  }

  // Real categories with palette colors
  const hasRealCategories = categories.length > 0
  const categoryData = hasRealCategories
    ? categories.map((c, i) => ({ ...c, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }))
    : DEMO_CATEGORY

  // Top vendors from real data or demo
  const vendors = topVendors.length > 0
    ? topVendors.slice(0, 5).map((v: any) => ({
        name:  v.vendor_name as string,
        count: Number(v.doc_count  ?? 0),
        total: Number(v.total_paid ?? 0),
      }))
    : DEMO_TOP_VENDORS

  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0)

  return (
    <div className="page-wide space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[20px] font-bold text-foreground">รายงานและสถิติ</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            ภาพรวมค่าใช้จ่ายและ VAT ของคุณ
            {!hasRealMonthly && (
              <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full font-medium">
                ข้อมูลตัวอย่าง
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5 bg-muted rounded-[10px]">
            {[["3m","3M"],["6m","6M"],["12m","12M"],["ytd","YTD"]].map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)}
                className={`h-8 px-3 rounded-[8px] text-xs font-medium transition ${range === k ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}>
                {l}
              </button>
            ))}
          </div>
          <button className="h-10 px-4 rounded-[10px] border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat label="ยอดรวมปีนี้"             value={formatThb(totalYear)} delta={momDelta} tone="brand" />
        <MiniStat label="VAT ที่ขอคืนได้"         value={formatThb(totalVat)} delta={null} tone="purple" />
        <MiniStat label="เอกสารทั้งหมด"           value={hasRealMonthly ? totalDocs.toLocaleString() : "—"} delta={null} tone="emerald" />
        <MiniStat label="ค่าใช้จ่ายเฉลี่ย/เดือน" value={formatThb(ave)} delta={null} tone="amber" />
      </div>

      {/* Bar chart */}
      <div className="bg-card border border-border rounded-[12px] p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">รายจ่ายรายเดือน</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {hasRealMonthly ? `${monthly.length} เดือนล่าสุด` : "12 เดือนล่าสุด (ตัวอย่าง)"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11.5px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-brand-500" /> ค่าใช้จ่าย
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-purple-500" /> VAT
            </span>
          </div>
        </div>
        <BarChart series={series} />
      </div>

      {/* Category breakdown + VAT trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-card border border-border rounded-[12px] p-5 lg:col-span-1">
          <h3 className="text-[15px] font-semibold text-foreground">สัดส่วนตามหมวด</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {hasRealCategories ? `ปีนี้ · ${formatThb(categoryTotal)}` : `ตัวอย่าง · ${formatThb(categoryTotal)}`}
          </p>
          <DonutChart data={categoryData} />
          <div className="mt-2 space-y-2">
            {categoryData.map(c => (
              <div key={c.name} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                <span className="flex-1 text-foreground truncate">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">{formatThb(c.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-[12px] p-5 lg:col-span-2">
          <h3 className="text-[15px] font-semibold text-foreground">เทรนด์ VAT</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">ภาษีซื้อที่ขอคืนได้</p>
          <LineChart series={series} />
        </div>
      </div>

      {/* Top vendors */}
      <div className="bg-card border border-border rounded-[12px] overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-foreground">ผู้ขายที่ใช้บ่อย</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {topVendors.length > 0 ? "5 อันดับแรกใน 30 วันที่ผ่านมา" : "5 อันดับแรก (ตัวอย่าง)"}
          </p>
        </div>
        {vendors.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">
            ยังไม่มีข้อมูลผู้ขาย — เริ่มสแกนเอกสารเพื่อดูสถิติผู้ขาย
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-2.5 px-5 font-medium">ผู้ขาย</th>
                <th className="text-right px-3 py-2.5 font-medium">จำนวน</th>
                <th className="text-right px-3 py-2.5 font-medium">ยอดรวม</th>
                <th className="px-3 py-2.5 font-medium w-40 hidden sm:table-cell">สัดส่วน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors.map((v, i) => {
                const maxTotal = Math.max(...vendors.map(x => x.total), 1)
                return (
                  <tr key={v.name} className="hover:bg-muted/30">
                    <td className="px-5 py-3 flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                        #{i + 1}
                      </span>
                      <span className="font-medium text-foreground">{v.name}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{v.count}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-foreground">{formatThb(v.total)}</td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full transition-all"
                          style={{ width: `${(v.total / maxTotal) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
