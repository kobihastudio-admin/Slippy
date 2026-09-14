"use client"

import { useState, useMemo } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts"
import {
  Wallet, Clock, ImageIcon, Receipt, X, Check, ChevronRight,
  Loader2, Trophy, Plane, FileText, CheckCircle2,
} from "lucide-react"

/* ─── Types ───────────────────────────────────────────────────────────────── */
export type IncomeParticipant = {
  id:                 string
  name:               string
  amount:             number
  paid_at:            string | null
  payment_proof_url:  string | null
  line_picture_url:   string | null
  line_display:       string | null
}

export type IncomeBill = {
  id:                 string
  title:              string
  total_amount:       number
  category:           string | null
  status:             string | null
  created_at:         string
  sport_type:         string | null
  venue:              string | null
  trip_type:          string | null
  destination:        string | null
  sport_group_id:     string | null
  split_participants: IncomeParticipant[]
}

export interface IncomeClientProps {
  orgId:           string
  bills:           IncomeBill[]
  sportGroupNames: Record<string, string>
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const fmtTHB = (n: number) =>
  "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })
}

function fmtMonth(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { month: "short", year: "2-digit" })
}

type CategoryKey = "sport" | "trip" | "general"

function categoryOf(bill: IncomeBill): CategoryKey {
  if (bill.category === "sport") return "sport"
  if (bill.category === "trip") return "trip"
  return "general"
}

const CATEGORY_META: Record<CategoryKey, { label: string; color: string; icon: typeof Trophy }> = {
  sport:   { label: "กีฬา",   color: "#6366f1", icon: Trophy   },
  trip:    { label: "ทริป",   color: "#38bdf8", icon: Plane    },
  general: { label: "ทั่วไป", color: "#a3a3a3", icon: FileText },
}

function billSubtitle(bill: IncomeBill, sportGroupNames: Record<string, string>): string {
  if (bill.category === "sport") {
    const group = bill.sport_group_id ? sportGroupNames[bill.sport_group_id] : null
    return [group, bill.venue].filter(Boolean).join(" · ") || "กลุ่มกีฬา"
  }
  if (bill.category === "trip") {
    return [bill.trip_type, bill.destination].filter(Boolean).join(" · ") || "ทริป"
  }
  return "บิลทั่วไป"
}

/* ─── Slip review modal ───────────────────────────────────────────────────── */
function SlipModal({ bill, participant, onClose, onApprove, onReject }: {
  bill:        IncomeBill
  participant: IncomeParticipant
  onClose:     () => void
  onApprove:   () => Promise<void>
  onReject:    () => Promise<void>
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)

  const run = async (action: "approve" | "reject", fn: () => Promise<void>) => {
    setBusy(action)
    try { await fn() } finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-sm font-semibold">{participant.name}</p>
            <p className="text-xs text-muted-foreground">{bill.title} · {fmtTHB(participant.amount)}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 bg-muted/30 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={participant.payment_proof_url!} alt="สลิปการโอน" className="max-h-[60vh] rounded-[10px] object-contain" />
        </div>
        {!participant.paid_at && (
          <div className="flex gap-2 p-4 border-t">
            <button
              onClick={() => run("reject", onReject)}
              disabled={busy !== null}
              className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {busy === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              ปฏิเสธสลิป
            </button>
            <button
              onClick={() => run("approve", onApprove)}
              disabled={busy !== null}
              className="flex-1 h-10 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              ยืนยันรับเงิน
            </button>
          </div>
        )}
        {participant.paid_at && (
          <div className="px-5 py-3 border-t flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> ยืนยันรับเงินแล้ว · {fmtDate(participant.paid_at)}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Bill row ────────────────────────────────────────────────────────────── */
function BillRow({ bill, sportGroupNames, onOpenSlip }: {
  bill:            IncomeBill
  sportGroupNames: Record<string, string>
  onOpenSlip:      (bill: IncomeBill, participant: IncomeParticipant) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const cat   = categoryOf(bill)
  const meta  = CATEGORY_META[cat]
  const total = bill.split_participants.length
  const settled = bill.split_participants.filter(p => p.paid_at).length
  const pendingProofs = bill.split_participants.filter(p => p.payment_proof_url && !p.paid_at).length

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}1a` }}>
          <meta.icon className="w-5 h-5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{bill.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {billSubtitle(bill, sportGroupNames)} · {fmtDate(bill.created_at)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold text-sm">{fmtTHB(Number(bill.total_amount))}</p>
          <div className="flex items-center gap-1.5 justify-end mt-1">
            {pendingProofs > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 font-medium inline-flex items-center gap-1">
                <ImageIcon className="w-2.5 h-2.5" /> รอตรวจ {pendingProofs}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {settled}/{total} จ่ายแล้ว
            </span>
          </div>
        </div>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t divide-y divide-border">
          {bill.split_participants.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
              {p.line_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.line_picture_url} alt={p.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {p.name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                {p.line_display && p.line_display !== p.name && (
                  <p className="text-xs text-muted-foreground truncate">{p.line_display}</p>
                )}
              </div>
              <p className="text-sm font-semibold shrink-0">{fmtTHB(Number(p.amount))}</p>

              {p.payment_proof_url ? (
                <button
                  onClick={() => onOpenSlip(bill, p)}
                  className="h-8 px-2.5 rounded-lg border bg-background hover:bg-muted text-xs font-medium transition-colors inline-flex items-center gap-1.5 shrink-0"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  ดูสลิป
                </button>
              ) : (
                <span className="text-xs text-muted-foreground shrink-0 w-[68px] text-center">—</span>
              )}

              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                p.paid_at ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
              )}>
                {p.paid_at ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              </div>
            </div>
          ))}
          {bill.split_participants.length === 0 && (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีผู้เข้าร่วม</div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Main IncomeClient ──────────────────────────────────────────────────── */
type FilterKey = "all" | "review" | CategoryKey

export function IncomeClient({ bills: initialBills, sportGroupNames }: IncomeClientProps) {
  const [bills, setBills] = useState<IncomeBill[]>(initialBills)
  const [filter, setFilter] = useState<FilterKey>("all")
  const [slipTarget, setSlipTarget] = useState<{ bill: IncomeBill; participant: IncomeParticipant } | null>(null)

  /* ── Aggregates ── */
  const allParticipants = useMemo(() => bills.flatMap(b => b.split_participants), [bills])

  const totalCollected = useMemo(
    () => allParticipants.filter(p => p.paid_at).reduce((s, p) => s + Number(p.amount), 0),
    [allParticipants]
  )
  const totalPending = useMemo(
    () => allParticipants.filter(p => !p.paid_at).reduce((s, p) => s + Number(p.amount), 0),
    [allParticipants]
  )
  const slipsAwaitingReview = useMemo(
    () => allParticipants.filter(p => p.payment_proof_url && !p.paid_at).length,
    [allParticipants]
  )

  /* ── Category breakdown (by total bill amount) ── */
  const categoryData = useMemo(() => {
    const sums: Record<CategoryKey, number> = { sport: 0, trip: 0, general: 0 }
    for (const b of bills) sums[categoryOf(b)] += Number(b.total_amount)
    return (Object.keys(sums) as CategoryKey[])
      .filter(k => sums[k] > 0)
      .map(k => ({ key: k, name: CATEGORY_META[k].label, value: sums[k], color: CATEGORY_META[k].color }))
  }, [bills])

  /* ── Monthly income trend (last 6 months, by paid_at) ── */
  const monthlyData = useMemo(() => {
    const now = new Date()
    const months: { key: string; label: string; total: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: fmtMonth(d.toISOString()), total: 0 })
    }
    const byKey = new Map(months.map(m => [m.key, m]))
    for (const p of allParticipants) {
      if (!p.paid_at) continue
      const d = new Date(p.paid_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const m = byKey.get(key)
      if (m) m.total += Number(p.amount)
    }
    return months
  }, [allParticipants])

  /* ── Filtered bill list ── */
  const filteredBills = useMemo(() => {
    switch (filter) {
      case "review":
        return bills.filter(b => b.split_participants.some(p => p.payment_proof_url && !p.paid_at))
      case "sport":
      case "trip":
      case "general":
        return bills.filter(b => categoryOf(b) === filter)
      default:
        return bills
    }
  }, [bills, filter])

  /* ── Slip actions ── */
  const updateParticipant = (billId: string, participantId: string, patch: Partial<IncomeParticipant>) => {
    setBills(prev => prev.map(b => b.id !== billId ? b : {
      ...b,
      split_participants: b.split_participants.map(p => p.id !== participantId ? p : { ...p, ...patch }),
    }))
  }

  const handleApprove = async (bill: IncomeBill, participant: IncomeParticipant) => {
    updateParticipant(bill.id, participant.id, { paid_at: new Date().toISOString() })
    try {
      const res = await fetch(`/api/split/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_paid", participantId: participant.id }),
      })
      if (!res.ok) throw new Error()
      toast.success("ยืนยันรับเงินแล้ว ✓")
      setSlipTarget(null)
    } catch {
      updateParticipant(bill.id, participant.id, { paid_at: null })
      toast.error("อัปเดตไม่สำเร็จ")
    }
  }

  const handleReject = async (bill: IncomeBill, participant: IncomeParticipant) => {
    const prevUrl = participant.payment_proof_url
    updateParticipant(bill.id, participant.id, { payment_proof_url: null })
    try {
      const res = await fetch(`/api/split/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject_proof", participantId: participant.id }),
      })
      if (!res.ok) throw new Error()
      toast.success("ปฏิเสธสลิปแล้ว — ผู้เข้าร่วมสามารถส่งใหม่ได้")
      setSlipTarget(null)
    } catch {
      updateParticipant(bill.id, participant.id, { payment_proof_url: prevUrl })
      toast.error("อัปเดตไม่สำเร็จ")
    }
  }

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all",     label: "ทั้งหมด" },
    { key: "review",  label: `รอตรวจสอบสลิป${slipsAwaitingReview > 0 ? ` (${slipsAwaitingReview})` : ""}` },
    { key: "sport",   label: CATEGORY_META.sport.label },
    { key: "trip",    label: CATEGORY_META.trip.label },
    { key: "general", label: CATEGORY_META.general.label },
  ]

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold">บิลรายรับ</h2>
          <p className="text-muted-foreground text-sm">สลิปและสถิติรายรับจากกลุ่มต่างๆ ใน Slippy</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "รายรับสะสม", value: fmtTHB(totalCollected), icon: Wallet,      color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "ยอดค้างรับ",  value: fmtTHB(totalPending),   icon: Clock,       color: "text-amber-500",   bg: "bg-amber-500/10" },
          { label: "สลิปรอตรวจสอบ", value: String(slipsAwaitingReview), icon: ImageIcon, color: "text-indigo-500", bg: "bg-indigo-500/10" },
          { label: "บิลทั้งหมด",  value: String(bills.length),   icon: Receipt,     color: "text-brand-500",   bg: "bg-brand-500/10" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border bg-card p-5">
            <div className={cn("w-9 h-9 rounded-[10px] flex items-center justify-center mb-3", s.bg)}>
              <s.icon className={cn("w-4 h-4", s.color)} />
            </div>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm font-semibold mb-1">ยอดบิลตามประเภทกลุ่ม</p>
          <p className="text-xs text-muted-foreground mb-3">สัดส่วนยอดรวมของบิลแบ่งตามประเภท</p>
          {categoryData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</div>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {categoryData.map(d => <Cell key={d.key} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtTHB(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            {categoryData.map(d => (
              <div key={d.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name} · {fmtTHB(d.value)}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm font-semibold mb-1">รายรับรายเดือน</p>
          <p className="text-xs text-muted-foreground mb-3">ยอดที่ยืนยันรับเงินแล้ว ย้อนหลัง 6 เดือน</p>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={48}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip formatter={(v: number) => fmtTHB(v)} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 bg-muted p-1 rounded-[10px] mb-4 overflow-x-auto">
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn(
              "h-8 px-3 rounded-[7px] text-sm font-medium transition-colors whitespace-nowrap",
              filter === f.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Bills list */}
      {filteredBills.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-16 px-8 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Receipt className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="font-medium">ไม่มีบิลในหมวดนี้</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBills.map(bill => (
            <BillRow key={bill.id} bill={bill} sportGroupNames={sportGroupNames}
              onOpenSlip={(b, p) => setSlipTarget({ bill: b, participant: p })} />
          ))}
        </div>
      )}

      {slipTarget && (
        <SlipModal
          bill={slipTarget.bill}
          participant={slipTarget.participant}
          onClose={() => setSlipTarget(null)}
          onApprove={() => handleApprove(slipTarget.bill, slipTarget.participant)}
          onReject={() => handleReject(slipTarget.bill, slipTarget.participant)}
        />
      )}
    </div>
  )
}
