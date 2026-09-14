"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronLeft, Calculator, TrendingDown, Clock, Info } from "lucide-react"
import { compareScenarios, type ScenarioComparison } from "@/lib/loan-amortization"

const fmtTHB = (n: number) =>
  "฿" + Math.round(n).toLocaleString("th-TH")

const fmtYearsMonths = (months: number) => {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} เดือน`
  if (m === 0) return `${y} ปี`
  return `${y} ปี ${m} เดือน`
}

/* ─── Dual-line balance chart (baseline vs with-extra) ─────────────────── */

function BalanceChart({ comparison }: { comparison: ScenarioComparison }) {
  const { baseline, withExtra } = comparison
  const W = 600
  const H = 200
  const pad = { top: 10, right: 10, bottom: 24, left: 10 }
  const maxMonths = baseline.schedule.length
  const maxBalance = baseline.schedule[0]?.balance ?? 1

  const toPoints = (schedule: typeof baseline.schedule) =>
    schedule.map(s => ({
      x: pad.left + (s.month / maxMonths) * (W - pad.left - pad.right),
      y: pad.top + (1 - s.balance / maxBalance) * (H - pad.top - pad.bottom),
    }))

  const basePts  = toPoints(baseline.schedule)
  const extraPts = toPoints(withExtra.schedule)
  const pathOf = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ")

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <path d={pathOf(basePts)} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" />
      <path d={pathOf(extraPts)} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" />
      <text x={W - pad.right} y={pad.top + 12} textAnchor="end" fontSize={10} fill="#94a3b8">ผ่อนปกติ</text>
      <text x={W - pad.right} y={pad.top + 26} textAnchor="end" fontSize={10} fill="#10b981" fontWeight={600}>แผนโปะ</text>
    </svg>
  )
}

/* ─── Field ──────────────────────────────────────────────────────────────── */

function Field({
  label, suffix, value, onChange, min = 0, step = 1,
}: {
  label: string
  suffix?: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value) || 0)}
          className="w-full h-10 px-3 pr-12 rounded-[10px] border border-border bg-background text-sm
            outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Main ───────────────────────────────────────────────────────────────── */

export function LoanCalculatorClient() {
  const [principal, setPrincipal]     = useState(3_000_000)
  const [ratePct, setRatePct]         = useState(5)
  const [termYears, setTermYears]     = useState(20)
  const [extraMonthly, setExtraMonthly] = useState(0)
  const [lumpAmount, setLumpAmount]   = useState(0)
  const [lumpMonth, setLumpMonth]     = useState(1)

  const termMonths = termYears * 12

  const comparison = useMemo(() => {
    if (principal <= 0 || ratePct <= 0 || termMonths <= 0) return null
    try {
      return compareScenarios({
        principal,
        annualRatePct: ratePct,
        termMonths,
        extraMonthly,
        extraLumpSums: lumpAmount > 0 ? { [Math.max(1, Math.min(lumpMonth, termMonths))]: lumpAmount } : {},
      })
    } catch {
      return null
    }
  }, [principal, ratePct, termMonths, extraMonthly, lumpAmount, lumpMonth])

  return (
    <div className="p-6 lg:p-7 max-w-[960px] animate-fade-in">
      {/* ── Back + Header ── */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/personal/wealth"
          className="h-9 w-9 rounded-[10px] border border-border hover:bg-muted flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <Calculator className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold">คำนวณผ่อน/โปะคอนโด</h2>
          <p className="text-muted-foreground text-sm">เทียบดอกเบี้ยที่ประหยัดได้ ระหว่างผ่อนปกติกับโปะเพิ่ม</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* ── Input form ── */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4 h-fit">
          <h3 className="text-sm font-semibold">รายละเอียดสินเชื่อ</h3>
          <Field label="ยอดกู้" suffix="บาท" value={principal} onChange={setPrincipal} step={10000} />
          <Field label="อัตราดอกเบี้ย" suffix="% ต่อปี" value={ratePct} onChange={setRatePct} step={0.05} />
          <Field label="ระยะเวลาผ่อน" suffix="ปี" value={termYears} onChange={setTermYears} step={1} />

          <div className="pt-2 border-t border-border" />
          <h3 className="text-sm font-semibold">แผนโปะเพิ่ม (ไม่บังคับ)</h3>
          <Field label="โปะเพิ่มทุกเดือน" suffix="บาท/เดือน" value={extraMonthly} onChange={setExtraMonthly} step={500} />
          <Field label="โปะก้อนเดียว" suffix="บาท" value={lumpAmount} onChange={setLumpAmount} step={10000} />
          {lumpAmount > 0 && (
            <Field label="โปะก้อนในเดือนที่" suffix={`จาก ${termMonths}`} value={lumpMonth} onChange={setLumpMonth} step={1} min={1} />
          )}

          <div className="flex gap-2 items-start text-xs text-muted-foreground bg-muted/60 rounded-[10px] p-3 mt-4">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p>ตัวเลขนี้เป็นการประมาณการแบบลดต้นลดดอก ไม่รวมค่าปรับโปะก่อนกำหนด — เช็คเงื่อนไขกับธนาคารก่อนโปะจริงเสมอ</p>
          </div>
        </div>

        {/* ── Results ── */}
        <div className="space-y-6">
          {!comparison ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              กรอกยอดกู้ ดอกเบี้ย และระยะเวลาผ่อนให้ครบ
            </div>
          ) : (
            <>
              {/* Hero comparison card */}
              <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white relative overflow-hidden">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 70% 30%, white 0%, transparent 70%)" }} />
                <p className="text-sm text-white/70 mb-1">ดอกเบี้ยที่ประหยัดได้</p>
                <p className="text-4xl font-bold tracking-tight">{fmtTHB(comparison.interestSaved)}</p>
                <div className="flex items-center gap-2 mt-2">
                  <TrendingDown className="w-4 h-4 text-emerald-200" />
                  <span className="text-sm font-medium text-emerald-200">
                    จากดอกเบี้ยรวมเดิม {fmtTHB(comparison.baseline.totalInterest)}
                  </span>
                </div>
                <div className="mt-4 pt-4 border-t border-white/20 flex gap-6 flex-wrap">
                  <div>
                    <p className="text-xs text-white/60 flex items-center gap-1"><Clock className="w-3 h-3" /> หมดหนี้เร็วขึ้น</p>
                    <p className="font-semibold">{fmtYearsMonths(comparison.monthsSaved)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/60">ผ่อนเหลือ</p>
                    <p className="font-semibold">{fmtYearsMonths(comparison.withExtra.monthsToPayoff)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/60">ค่างวดปกติ/เดือน</p>
                    <p className="font-semibold">{fmtTHB(comparison.baseline.monthlyPayment)}</p>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold mb-4">เงินต้นคงเหลือตลอดสัญญา</h3>
                <div className="h-[200px]">
                  <BalanceChart comparison={comparison} />
                </div>
              </div>

              {/* Detail table (first 12 months of the with-extra schedule) */}
              <div className="rounded-2xl border border-border bg-card p-5 overflow-x-auto">
                <h3 className="text-sm font-semibold mb-4">ตารางผ่อนช่วง 12 เดือนแรก (แผนโปะ)</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">เดือน</th>
                      <th className="py-1.5 pr-3 font-medium text-right">ดอกเบี้ย</th>
                      <th className="py-1.5 pr-3 font-medium text-right">ตัดเงินต้น</th>
                      <th className="py-1.5 pr-3 font-medium text-right">โปะเพิ่ม</th>
                      <th className="py-1.5 font-medium text-right">คงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.withExtra.schedule.slice(0, 12).map(row => (
                      <tr key={row.month} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-3">{row.month}</td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">{fmtTHB(row.interest)}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtTHB(row.principalPaid)}</td>
                        <td className="py-1.5 pr-3 text-right text-emerald-600 font-medium">
                          {row.extraPaid > 0 ? fmtTHB(row.extraPaid) : "—"}
                        </td>
                        <td className="py-1.5 text-right font-medium">{fmtTHB(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
