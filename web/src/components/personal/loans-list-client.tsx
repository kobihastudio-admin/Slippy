"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ChevronLeft, Landmark, Plus, X, Loader2 } from "lucide-react"

interface LoanRow {
  id:              string
  name:            string
  lender:          string | null
  principal:       number
  annual_rate_pct: number
  term_months:     number
  start_date:      string
  is_archived:     boolean
}

const fmtTHB = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH")

function NewLoanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName]           = useState("")
  const [lender, setLender]       = useState("")
  const [principal, setPrincipal] = useState("")
  const [rate, setRate]           = useState("")
  const [years, setYears]         = useState("")
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !principal || !rate || !years) { toast.error("กรอกข้อมูลให้ครบ"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/personal/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, lender: lender || undefined,
          principal: Number(principal),
          annualRatePct: Number(rate),
          termMonths: Number(years) * 12,
          startDate,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "เกิดข้อผิดพลาด")
      toast.success("เพิ่มสินเชื่อเรียบร้อย")
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด")
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
            <h3 className="text-[17px] font-semibold">เพิ่มสินเชื่อ</h3>
            <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อสินเชื่อ เช่น คอนโด The Base"
              className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            <input value={lender} onChange={e => setLender(e.target.value)} placeholder="ธนาคาร (ไม่บังคับ)"
              className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="ยอดกู้ (บาท)"
                className="h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
              <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder="ดอกเบี้ย (%/ปี)"
                className="h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={years} onChange={e => setYears(e.target.value)} placeholder="ระยะเวลา (ปี)"
                className="h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="h-10 px-3 rounded-[10px] border border-border bg-background text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
            </div>
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

export function LoansListClient() {
  const [loans, setLoans]         = useState<LoanRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/personal/loans")
      const json = await res.json()
      setLoans(json.loans ?? [])
    } catch {
      toast.error("โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 lg:p-7 max-w-[960px] animate-fade-in">
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/personal/wealth" className="h-9 w-9 rounded-[10px] border border-border hover:bg-muted flex items-center justify-center transition-colors">
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Landmark className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">สินเชื่อของฉัน</h2>
            <p className="text-muted-foreground text-sm">บันทึกและติดตามการผ่อนชำระจริง</p>
          </div>
        </div>
        <button onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> เพิ่มสินเชื่อ
        </button>
      </div>

      {showModal && (
        <NewLoanModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); load() }} />
      )}

      {loading ? (
        <div className="text-center py-14 text-muted-foreground text-sm">กำลังโหลด...</div>
      ) : loans.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground">
          <Landmark className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">ยังไม่มีสินเชื่อที่บันทึกไว้</p>
          <p className="text-xs mt-1 opacity-70">กด &quot;เพิ่มสินเชื่อ&quot; เพื่อเริ่มติดตามการผ่อนชำระจริง</p>
        </div>
      ) : (
        <div className="space-y-2">
          {loans.map(loan => (
            <Link key={loan.id} href={`/personal/wealth/loans/${loan.id}`}
              className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Landmark className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{loan.name}</p>
                <p className="text-xs text-muted-foreground">
                  {loan.lender ? `${loan.lender} · ` : ""}{fmtTHB(loan.principal)} · {loan.annual_rate_pct}%/ปี · {loan.term_months / 12} ปี
                </p>
              </div>
              {loan.is_archived && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">ปิดแล้ว</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
