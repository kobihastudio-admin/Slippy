"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ChevronLeft, Landmark, Plus, X, Loader2, TrendingDown, TrendingUp,
  CheckCircle2, AlertTriangle, Trash2,
} from "lucide-react"
import { buildLedger, projectRemaining, type LoanRecord, type PaymentRecord } from "@/lib/loan-ledger"

interface LoanDto {
  id: string
  name: string
  lender: string | null
  principal: number
  annual_rate_pct: number
  term_months: number
  start_date: string
  is_archived: boolean
}
interface PaymentDto {
  id: string
  payment_date: string
  amount: number
  note: string | null
}

const fmtTHB = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH")
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })
const fmtYearsMonths = (months: number) => {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} เดือน`
  if (m === 0) return `${y} ปี`
  return `${y} ปี ${m} เดือน`
}

function AddPaymentModal({ loanId, onClose, onAdded }: { loanId: string; onClose: () => void; onAdded: () => void }) {
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount]   = useState("")
  const [note, setNote]       = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) { toast.error("กรอกยอดเงินให้ถูกต้อง"); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/personal/loans/${loanId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentDate: date, amount: Number(amount), note: note || undefined }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "เกิดข้อผิดพลาด")
      toast.success("บันทึกการชำระเรียบร้อย")
      onAdded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-[16px] shadow-2xl w-full max-w-sm">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <h3 className="text-[17px] font-semibold">บันทึกการชำระ</h3>
            <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="ยอดที่ชำระ (บาท)"
              className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ) เช่น โปะเพิ่ม"
              className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            <button type="submit" disabled={loading}
              className="w-full h-10 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              บันทึก
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export function LoanDetailClient({ loanId }: { loanId: string }) {
  const [loan, setLoan]         = useState<LoanDto | null>(null)
  const [payments, setPayments] = useState<PaymentDto[]>([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/personal/loans/${loanId}`)
      if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ")
      const json = await res.json()
      setLoan(json.loan)
      setPayments(json.payments ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [loanId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deletePayment(paymentId: string) {
    try {
      const res = await fetch(`/api/personal/loans/${loanId}/payments/${paymentId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setPayments(prev => prev.filter(p => p.id !== paymentId))
      toast.success("ลบรายการแล้ว")
    } catch {
      toast.error("ลบไม่สำเร็จ")
    }
  }

  const analysis = useMemo(() => {
    if (!loan) return null
    const record: LoanRecord = {
      principal: loan.principal,
      annualRatePct: loan.annual_rate_pct,
      termMonths: loan.term_months,
      startDate: loan.start_date,
    }
    const paymentRecords: PaymentRecord[] = payments.map(p => ({ paymentDate: p.payment_date, amount: p.amount }))
    const ledger = buildLedger(record, paymentRecords)
    const projection = projectRemaining(record, ledger)
    const aheadBy = ledger.theoreticalBalanceNow - ledger.currentBalance // positive = ahead of original schedule
    return { ledger, projection, aheadBy }
  }, [loan, payments])

  if (loading) return <div className="p-8 text-center text-muted-foreground text-sm">กำลังโหลด...</div>
  if (!loan) return <div className="p-8 text-center text-muted-foreground text-sm">ไม่พบสินเชื่อนี้</div>

  const { ledger, projection, aheadBy } = analysis!

  return (
    <div className="p-6 lg:p-7 max-w-[960px] animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/personal/wealth/loans" className="h-9 w-9 rounded-[10px] border border-border hover:bg-muted flex items-center justify-center transition-colors">
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <Landmark className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold truncate">{loan.name}</h2>
          <p className="text-muted-foreground text-sm">
            {loan.lender ? `${loan.lender} · ` : ""}{fmtTHB(loan.principal)} · {loan.annual_rate_pct}%/ปี · เริ่ม {fmtDate(loan.start_date)}
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors inline-flex items-center gap-1.5 shrink-0">
          <Plus className="w-3.5 h-3.5" /> บันทึกการชำระ
        </button>
      </div>

      {showModal && (
        <AddPaymentModal loanId={loanId} onClose={() => setShowModal(false)} onAdded={() => { setShowModal(false); load() }} />
      )}

      {/* ── Hero: current status ── */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 70% 30%, white 0%, transparent 70%)" }} />
        <p className="text-sm text-white/70 mb-1">ยอดหนี้คงเหลือปัจจุบัน</p>
        <p className="text-4xl font-bold tracking-tight">{fmtTHB(ledger.currentBalance)}</p>
        <div className="flex items-center gap-2 mt-2">
          {ledger.isPaidOff ? (
            <><CheckCircle2 className="w-4 h-4 text-emerald-200" /><span className="text-sm font-medium text-emerald-200">ผ่อนหมดแล้ว 🎉</span></>
          ) : aheadBy > 0 ? (
            <><TrendingDown className="w-4 h-4 text-emerald-200" /><span className="text-sm font-medium text-emerald-200">นำหน้าแผนเดิมอยู่ {fmtTHB(aheadBy)}</span></>
          ) : aheadBy < -0.01 ? (
            <><TrendingUp className="w-4 h-4 text-amber-200" /><span className="text-sm font-medium text-amber-200">ล่าช้ากว่าแผนเดิม {fmtTHB(-aheadBy)}</span></>
          ) : (
            <span className="text-sm font-medium text-white/70">เป็นไปตามแผนเดิม</span>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-white/20 flex gap-6 flex-wrap">
          <div>
            <p className="text-xs text-white/60">จ่ายไปแล้วทั้งหมด</p>
            <p className="font-semibold">{fmtTHB(ledger.totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">ดอกเบี้ยที่จ่ายไปแล้ว</p>
            <p className="font-semibold">{fmtTHB(ledger.totalInterestPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">ตัดเงินต้นไปแล้ว</p>
            <p className="font-semibold">{fmtTHB(ledger.totalPrincipalPaid)}</p>
          </div>
        </div>
      </div>

      {/* ── Projection ── */}
      {projection && (
        <div className="rounded-2xl border border-border bg-card p-5 mb-6">
          <h3 className="text-sm font-semibold mb-3">คาดการณ์ (ถ้าผ่อนตามค่างวดเดิมต่อไปเรื่อยๆ ไม่โปะเพิ่ม)</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">เหลืออีก</p>
              <p className="font-semibold">{fmtYearsMonths(projection.remainingMonths)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">คาดว่าจะหมดหนี้</p>
              <p className="font-semibold">{fmtDate(projection.projectedPayoffDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ดอกเบี้ยที่จะจ่ายอีก</p>
              <p className="font-semibold">{fmtTHB(projection.remainingInterest)}</p>
            </div>
          </div>
          <Link href="/personal/wealth/loan-calculator"
            className="inline-block mt-4 text-xs text-emerald-600 hover:underline">
            ลองคำนวณแผนโปะเพิ่มเพื่อลดดอกเบี้ยตรงนี้ →
          </Link>
        </div>
      )}

      {/* ── Payment history ── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">ประวัติการชำระ ({payments.length} รายการ)</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">ยังไม่มีประวัติการชำระ — กด &quot;บันทึกการชำระ&quot; เพื่อเริ่มติดตาม</p>
        ) : (
          <div className="space-y-1.5">
            {[...payments].reverse().map(p => {
              const ledgerRow = ledger.months.find(m => m.monthLabel === p.payment_date.slice(0, 7))
              const isExtra = ledgerRow && ledgerRow.extraPaid > 0
              return (
                <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{fmtDate(p.payment_date)}</p>
                    {p.note && <p className="text-xs text-muted-foreground truncate">{p.note}</p>}
                  </div>
                  {isExtra && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 shrink-0">โปะเพิ่ม</span>
                  )}
                  <span className="text-sm font-semibold shrink-0">{fmtTHB(p.amount)}</span>
                  <button onClick={() => deletePayment(p.id)}
                    className="h-7 w-7 rounded-[8px] hover:bg-destructive/10 hover:text-destructive text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {ledger.months.some(m => m.shortfall > 0.01) && (
          <div className="flex gap-2 items-start text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-[10px] p-3 mt-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p>บางเดือนยอดที่บันทึกไว้น้อยกว่าค่างวดปกติ ({fmtTHB(ledger.scheduledPayment)}/เดือน) — อาจกระทบดอกเบี้ยที่คำนวณ ลองเช็คว่าบันทึกครบทุกเดือนหรือยัง</p>
          </div>
        )}
      </div>
    </div>
  )
}
