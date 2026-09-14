"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { COMMON_CURRENCIES } from "@/lib/exchange-rates"
import { expenseCategory, ACTIVITY_CATEGORIES } from "@/lib/activity-taxonomy"
import { TripMembersPanel } from "./trip-members-panel"
import {
  ArrowLeft, Plus, Check, X, Copy, ExternalLink,
  Receipt, Users, ChevronDown, ChevronUp, Loader2,
  QrCode, AlertCircle, DollarSign, Clock, CheckCircle2,
  MapPin, Utensils, Car, Hotel, Ticket, Pin, Calendar, ShoppingBag, Lock,
  ScanLine, Trash2, AlertTriangle,
} from "lucide-react"

type Participant = {
  id: string; display_name: string; is_host: boolean
  amount_owed: number; amount_paid: number; paid_at: string | null
  line_user_id: string | null; promptpay_type: string | null
  promptpay_value: string | null; qr_image_url: string | null
}
type Expense = {
  id: string; title: string; amount: number; category: string | null
  split_mode: string; split_values?: Record<string, number>
  note: string | null; expense_date: string; paid_by_id: string
  trip_participants: { id: string; display_name: string }
  expense_splits: Array<{ participant_id: string; amount: number; is_paid: boolean }>
  currency?: string; exchange_rate?: number; amount_base_currency?: number; rate_is_manual?: boolean
  /** Per-item breakdown, in the expense's own currency. */
  trip_expense_items?: Array<{
    id: string; sort_order: number; description: string
    quantity: number | null; unit_price: number | null; amount: number
  }>
}
const SPLIT_MODE_DISPLAY: Record<string, string> = {
  equal: "เท่ากัน", individual: "ตามจำนวนที่ระบุ", percent: "ตามเปอร์เซ็นต์", shares: "ตามจำนวนหุ้น", exclude: "เท่ากัน (บางคน)",
}
type Payment = {
  id: string; from_participant: string; to_participant: string
  amount: number; slip_url: string | null; status: string
  paid_at: string; note: string | null
}
type Settlement = { from_name: string; to_name: string; amount: number; from_id: string; to_id: string }

const fmtTHB  = (n: number) => "฿" + Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 })
const fmtDate = (d: string) => new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
const MONEY_CATEGORY = expenseCategory()
const MoneyIcon = MONEY_CATEGORY.icon
/** Formats an amount in an arbitrary currency (not just THB) — used for a
 * trip expense's original entered amount before conversion. */
const fmtCcy = (n: number, ccy: string) =>
  `${Number(n).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${ccy}`

/* ─── Add Expense Modal ─────────────────────────────────────────────────────── */
type SplitMode = "equal" | "individual" | "percent" | "shares"
const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  equal: "หารเท่ากัน", individual: "ระบุจำนวนเอง", percent: "ระบุเปอร์เซ็นต์", shares: "ตามจำนวนหุ้น",
}
type IntervalUnit = "weekly" | "monthly" | "yearly"
const INTERVAL_LABEL: Record<IntervalUnit, string> = {
  weekly: "ทุกสัปดาห์", monthly: "ทุกเดือน", yearly: "ทุกปี",
}

/** +1 interval on a YYYY-MM-DD string — used so "recurring starting today"
 * schedules the NEXT auto-generated occurrence one period out, since the
 * first occurrence is created immediately below (same as a normal expense),
 * not left for the cron to pick up. */
function addIntervalClient(dateStr: string, unit: IntervalUnit): string {
  const d = new Date(dateStr + "T00:00:00")
  if (unit === "weekly")  d.setDate(d.getDate() + 7)
  if (unit === "monthly") d.setMonth(d.getMonth() + 1)
  if (unit === "yearly")  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Keep a line's total consistent with quantity × unit price.
 *
 * Only when BOTH are present — a line that has just a total (the common case on
 * a Thai receipt, which prints one figure per row) keeps whatever was typed.
 * Recomputing from a blank quantity would zero it.
 */
function recalcLine(line: ExpenseLine): ExpenseLine {
  const q = Number(line.quantity), u = Number(line.unit_price)
  if (!line.quantity || !line.unit_price || !Number.isFinite(q) || !Number.isFinite(u)) return line
  return { ...line, amount: String(Math.round(q * u * 100) / 100) }
}

/** One line of a receipt. `amount` is in the expense's currency. */
interface ExpenseLine {
  description: string
  quantity: string
  unit_price: string
  amount: string
}

function AddExpenseModal({ tripId, baseCurrency, participants, onClose, onAdd }: {
  tripId: string; baseCurrency: string; participants: Participant[]
  onClose: () => void; onAdd: (e: Expense) => void
}) {
  const [title,    setTitle]    = useState("")
  const [amount,   setAmount]   = useState("")
  const [paidBy,   setPaidBy]   = useState(participants.find(p => p.is_host)?.id ?? participants[0]?.id ?? "")
  const [category, setCategory] = useState("food")
  const [note,     setNote]     = useState("")
  /**
   * The per-item breakdown. Amounts are in `currency` — the receipt's own —
   * never the trip base; there is one conversion, on the expense.
   */
  const [items,    setItems]    = useState<ExpenseLine[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanIssues, setScanIssues] = useState<string[]>([])
  const [documentId, setDocumentId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>("equal")
  const [included,  setIncluded] = useState<Set<string>>(new Set(participants.map(p => p.id)))
  // Raw per-person input for individual/percent/shares — keyed by participant id
  const [values,    setValues]   = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState(false)
  const [isRecurring, setIsRecurring] = useState(false)
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("monthly")
  const [endDate,      setEndDate]      = useState("")
  const [expenseDate,  setExpenseDate]  = useState(() => new Date().toISOString().slice(0, 10))
  const [currency,     setCurrency]     = useState(baseCurrency)
  const [autoRate,     setAutoRate]     = useState<number | null>(null)
  const [rateLoading,  setRateLoading]  = useState(false)
  const [manualRate,   setManualRate]   = useState("")

  const isForeign = currency !== baseCurrency
  const effectiveRate = isForeign ? (manualRate ? Number(manualRate) : autoRate) : 1

  // Fetch the historical rate whenever currency/date changes, for preview —
  // the actual save still resolves it server-side (this is just so the user
  // sees what will be used before submitting, and can override it).
  useEffect(() => {
    if (!isForeign) { setAutoRate(null); return }
    let cancelled = false
    setRateLoading(true)
    fetch(`https://api.frankfurter.dev/v1/${expenseDate}?base=${currency}&symbols=${baseCurrency}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setAutoRate(d?.rates?.[baseCurrency] ?? null) })
      .catch(() => { if (!cancelled) setAutoRate(null) })
      .finally(() => { if (!cancelled) setRateLoading(false) })
    return () => { cancelled = true }
  }, [currency, expenseDate, isForeign, baseCurrency])

  const itemsTotal = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
  const hasItems = items.some(i => i.description.trim() || Number(i.amount))
  /**
   * Whether the lines add up to the amount charged.
   *
   * Reported, never enforced. A receipt legitimately has a service charge, a
   * discount or a rounding line that the itemised part does not include — and
   * silently rewriting the total to match the lines is exactly the bug that put
   * ฿915.92 on an ฿856 bill. The user is told, and decides.
   */
  const itemsMismatch = hasItems && Math.abs(itemsTotal - (Number(amount) || 0)) > 0.01

  const includedList = participants.filter(p => included.has(p.id))
  const amountNum = Number(amount) || 0
  const amountInBase = effectiveRate ? Math.round(amountNum * effectiveRate * 100) / 100 : amountNum

  /**
   * Read a receipt into the form.
   *
   * Fills in — it does not submit. Everything here came from a machine reading
   * small print, and this codebase's recurring failure is a machine-read number
   * that nobody compared to the paper and that then reconciles perfectly against
   * itself forever. The user sees the total, the lines and whatever the reader
   * was unsure about, and presses save themselves.
   */
  const scanReceipt = async (file: File) => {
    setScanning(true)
    setScanIssues([])
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/trips/${tripId}/expenses/scan`, { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "อ่านใบเสร็จไม่สำเร็จ")

      setDocumentId(json.documentId ?? null)
      if (json.vendorName && !title) setTitle(json.vendorName)
      if (json.total != null) setAmount(String(json.total))
      if (json.currency) setCurrency(json.currency)
      if (json.date) setExpenseDate(String(json.date).slice(0, 10))
      setItems((json.items ?? []).map((i: {
        description: string; quantity: number | null; unit_price: number | null; amount: number
      }) => ({
        description: i.description ?? "",
        quantity:   i.quantity   == null ? "" : String(i.quantity),
        unit_price: i.unit_price == null ? "" : String(i.unit_price),
        amount:     String(i.amount ?? 0),
      })))
      setScanIssues(json.issues ?? [])

      const n = json.items?.length ?? 0
      toast.success(n ? `อ่านได้ ${n} รายการ — ตรวจกับใบเสร็จก่อนบันทึก` : "อ่านยอดได้แล้ว — ตรวจก่อนบันทึก")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อ่านใบเสร็จไม่สำเร็จ")
    } finally {
      setScanning(false)
    }
  }

  const toggleIncluded = (pid: string) => {
    setIncluded(prev => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid); else next.add(pid)
      return next
    })
  }

  // Live total for individual/percent/shares — lets the user see if they're
  // off before submitting, instead of only finding out from a server error.
  const valuesSum = includedList.reduce((s, p) => s + (Number(values[p.id]) || 0), 0)
  const valuesHint =
    splitMode === "individual" ? `รวม ${valuesSum.toFixed(2)} / ${amountNum.toFixed(2)} ${currency}`
  : splitMode === "percent"    ? `รวม ${valuesSum}% / 100%`
  : splitMode === "shares"     ? `รวม ${valuesSum} หุ้น`
  : null

  const handleAdd = async () => {
    if (!title.trim() || !amount) { toast.error("กรอกชื่อรายการและจำนวนเงิน"); return }
    if (includedList.length === 0) { toast.error("เลือกคนที่ร่วมจ่ายอย่างน้อย 1 คน"); return }
    if (isForeign && !effectiveRate) { toast.error("ยังไม่มีอัตราแลกเปลี่ยน — รอสักครู่หรือระบุอัตราเอง"); return }

    // "individual" amounts are entered in the same currency the user is
    // thinking in (`currency`), but resolveExpenseSplits validates against
    // the base-currency total server-side — convert here so a JPY receipt
    // split by exact amounts still adds up correctly after conversion.
    const split_values = splitMode === "equal"
      ? {}
      : Object.fromEntries(includedList.map(p => {
          const raw = Number(values[p.id]) || 0
          const converted = splitMode === "individual" && isForeign ? raw * (effectiveRate ?? 1) : raw
          return [p.id, converted]
        }))

    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, amount: amountNum, paid_by_id: paidBy, category, note: note || null,
          split_mode: splitMode, split_with: includedList.map(p => p.id), split_values,
          expense_date: expenseDate, currency,
          exchange_rate: manualRate ? Number(manualRate) : undefined,
          document_id: documentId ?? undefined,
          items: items
            .filter(i => i.description.trim())
            .map(i => ({
              description: i.description.trim(),
              quantity:   i.quantity   ? Number(i.quantity)   : null,
              unit_price: i.unit_price ? Number(i.unit_price) : null,
              amount:     Number(i.amount) || 0,
            })),
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error) }
      // The expense saved but its lines did not — say so rather than let the
      // breakdown vanish without a word.
      const saved = await res.clone().json().catch(() => ({} as { itemsError?: string }))
      if (saved.itemsError) toast.error(`บันทึกรายจ่ายแล้ว แต่รายการย่อยไม่ถูกบันทึก: ${saved.itemsError}`)

      // Recurring: this call created the FIRST occurrence above (so the
      // user sees it immediately, same as a one-off expense) — the
      // template's next_run_date starts one interval later, since the cron
      // only needs to generate the second occurrence onward.
      if (isRecurring) {
        const today = new Date().toISOString().slice(0, 10)
        const recRes = await fetch("/api/trips/recurring", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            journeyId: tripId, paidById: paidBy, title, amount: amountNum, category,
            splitMode, splitValues: split_values,
            intervalUnit, startDate: addIntervalClient(today, intervalUnit),
            endDate: endDate || null,
          }),
        })
        if (!recRes.ok) {
          const d = await recRes.json().catch(() => ({}))
          toast.error(`เพิ่มรายจ่ายแล้ว แต่ตั้งเป็นรายจ่ายประจำไม่สำเร็จ: ${d.error ?? "unknown"}`)
        }
      }

      toast.success(isRecurring ? "เพิ่มรายจ่ายประจำแล้ว" : "เพิ่มรายจ่ายแล้ว")
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "เกิดข้อผิดพลาด")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-semibold">เพิ่มค่าใช้จ่าย</h3>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
          {/* ── Scan a receipt ── */}
          <div className="rounded-[10px] border border-dashed p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">สแกนใบเสร็จ</p>
                <p className="text-[11px] text-muted-foreground">
                  อ่านยอดและรายการย่อยให้อัตโนมัติ · ตรวจก่อนบันทึกได้
                </p>
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={scanning}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border bg-card px-3 text-xs font-semibold hover:bg-muted/50 disabled:opacity-60">
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                {scanning ? "กำลังอ่าน…" : "เลือกรูป"}
              </button>
            </div>
            <input ref={fileRef} type="file" className="hidden"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={e => { const f = e.target.files?.[0]; if (f) scanReceipt(f); e.target.value = "" }} />

            {documentId && (
              <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                แนบใบเสร็จแล้ว — จะผูกกับรายจ่ายนี้และเปิดดูภาพต้นฉบับได้ภายหลัง
              </p>
            )}
            {scanIssues.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {scanIssues.slice(0, 4).map((iss, k) => (
                  <li key={k} className="text-[10.5px] text-amber-600 dark:text-amber-400">· {iss}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">รายการ *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="ค่าอาหาร, ค่าโรงแรม, ..."
              className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">จำนวน *</label>
              <div className="flex gap-1.5">
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                  className="flex-1 h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500 min-w-0" />
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className="w-[76px] h-9 rounded-[8px] border bg-background px-1.5 text-[12.5px] outline-none focus:border-brand-500">
                  {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">หมวด</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500">
                {ACTIVITY_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.labelTh}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">วันที่เกิดค่าใช้จ่าย</label>
            <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)}
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          </div>

          {isForeign && (
            <div className="rounded-[10px] border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted-foreground">อัตราแลกเปลี่ยน (1 {currency} =)</span>
                {rateLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  : <span className="font-semibold">{autoRate ? `${autoRate.toFixed(4)} ${baseCurrency}` : "ไม่พบ — ระบุเอง"}</span>}
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">ระบุอัตราเอง (ไม่บังคับ — เช่น เรทที่บัตรคิดจริง)</label>
                <input type="number" step="0.0001" value={manualRate} onChange={e => setManualRate(e.target.value)}
                  placeholder={autoRate ? String(autoRate) : "เช่น 0.245"}
                  className="w-full h-8 rounded-[8px] border bg-background px-2 text-[12.5px] outline-none focus:border-brand-500" />
              </div>
              {!!amountNum && !!effectiveRate && (
                <p className="text-[12px] text-muted-foreground">
                  ≈ {fmtCcy(amountInBase, baseCurrency)} {manualRate ? "(อัตราที่ระบุเอง)" : "(อัตราวันที่เกิดค่าใช้จ่าย)"}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">บิลนี้ใครออกก่อน</label>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)}
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500">
              {participants.map(p => <option key={p.id} value={p.id}>{p.display_name}{p.is_host ? " (เจ้าภาพ)" : ""}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1.5">หารกันแบบไหน</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(SPLIT_MODE_LABEL) as SplitMode[]).map(m => (
                <button key={m} onClick={() => setSplitMode(m)}
                  className={cn("h-9 rounded-[8px] border text-sm font-medium transition-colors",
                    splitMode === m ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-600" : "hover:bg-muted/50")}>
                  {SPLIT_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11.5px] font-medium text-muted-foreground">ใครร่วมจ่ายบิลนี้</label>
              {valuesHint && <span className="text-[11px] text-muted-foreground">{valuesHint}</span>}
            </div>
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto rounded-[10px] border p-2">
              {participants.map(p => {
                const isIn = included.has(p.id)
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <button onClick={() => toggleIncluded(p.id)}
                      className={cn("h-7 w-7 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                        isIn ? "bg-brand-500 border-brand-500 text-white" : "hover:bg-muted/50")}>
                      {isIn && <Check className="w-3.5 h-3.5" />}
                    </button>
                    <span className={cn("flex-1 text-sm", !isIn && "text-muted-foreground")}>{p.display_name}</span>
                    {isIn && splitMode !== "equal" && (
                      <input
                        type="number"
                        value={values[p.id] ?? ""}
                        onChange={e => setValues(v => ({ ...v, [p.id]: e.target.value }))}
                        placeholder={splitMode === "individual" ? "บาท" : splitMode === "percent" ? "%" : "หุ้น"}
                        className="w-20 h-8 rounded-[6px] border bg-background px-2 text-sm text-right outline-none focus:border-brand-500"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Per-item breakdown ── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] font-medium text-muted-foreground">
                รายการย่อย (ไม่บังคับ)
              </label>
              <button type="button"
                onClick={() => setItems(v => [...v, { description: "", quantity: "", unit_price: "", amount: "" }])}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-600">
                <Plus className="h-3 w-3" />เพิ่มรายการ
              </button>
            </div>

            {items.length === 0 ? (
              <p className="rounded-[10px] border border-dashed px-3 py-2.5 text-[11px] text-muted-foreground">
                แยกได้ว่าอะไรเท่าไหร่ — สแกนใบเสร็จแล้วระบบจะเติมให้ หรือกดเพิ่มเอง
              </p>
            ) : (
              <div className="space-y-1.5">
                {items.map((it, k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <input value={it.description}
                      onChange={e => setItems(v => v.map((x, j) => j === k ? { ...x, description: e.target.value } : x))}
                      placeholder="ชื่อรายการ"
                      className="h-9 min-w-0 flex-1 rounded-[8px] border bg-background px-2 text-[13px] outline-none focus:border-brand-500" />
                    <input value={it.quantity} inputMode="decimal"
                      onChange={e => setItems(v => v.map((x, j) => j === k ? recalcLine({ ...x, quantity: e.target.value }) : x))}
                      placeholder="จน."
                      className="h-9 w-[52px] shrink-0 rounded-[8px] border bg-background px-1.5 text-center text-[12.5px] outline-none focus:border-brand-500" />
                    <input value={it.unit_price} inputMode="decimal"
                      onChange={e => setItems(v => v.map((x, j) => j === k ? recalcLine({ ...x, unit_price: e.target.value }) : x))}
                      placeholder="ราคา/หน่วย"
                      className="h-9 w-[84px] shrink-0 rounded-[8px] border bg-background px-1.5 text-right text-[12.5px] outline-none focus:border-brand-500" />
                    <input value={it.amount} inputMode="decimal"
                      onChange={e => setItems(v => v.map((x, j) => j === k ? { ...x, amount: e.target.value } : x))}
                      placeholder="รวม"
                      className="h-9 w-[84px] shrink-0 rounded-[8px] border bg-background px-1.5 text-right text-[12.5px] font-semibold outline-none focus:border-brand-500" />
                    <button type="button" aria-label="ลบรายการ"
                      onClick={() => setItems(v => v.filter((_, j) => j !== k))}
                      className="shrink-0 rounded-[8px] p-1.5 text-muted-foreground hover:bg-muted">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <div className="flex items-center justify-between px-1 pt-1 text-[11.5px]">
                  <span className="text-muted-foreground">
                    รวมรายการย่อย {items.length} รายการ
                  </span>
                  <span className={cn("font-semibold tabular-nums",
                    itemsMismatch ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                    {itemsTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} {currency}
                  </span>
                </div>

                {itemsMismatch && (
                  <div className="flex items-start gap-2 rounded-[8px] bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      รายการย่อยรวมได้ {itemsTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} แต่ยอดที่จ่ายคือ{" "}
                      {(Number(amount) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })} {currency} —
                      อาจมีค่าบริการหรือส่วนลดที่ไม่ได้แยกไว้ ระบบจะเก็บทั้งสองค่าตามที่กรอก
                      <button type="button" onClick={() => setAmount(String(itemsTotal))}
                        className="ml-1 font-semibold underline">ใช้ยอดรวมรายการย่อย</button>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">รายละเอียด (ไม่บังคับ)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น มื้อเย็นวันแรก รวมค่าบริการแล้ว"
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          </div>

          <div className="rounded-[10px] border p-3">
            <button onClick={() => setIsRecurring(v => !v)} className="flex items-center gap-2 w-full">
              <div className={cn("h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                isRecurring ? "bg-brand-500 border-brand-500 text-white" : "hover:bg-muted/50")}>
                {isRecurring && <Check className="w-3.5 h-3.5" />}
              </div>
              <span className="text-sm font-medium flex-1 text-left">ทำเป็นรายจ่ายประจำ</span>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </button>
            {isRecurring && (
              <div className="mt-3 space-y-2.5 pl-7">
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(INTERVAL_LABEL) as IntervalUnit[]).map(u => (
                    <button key={u} onClick={() => setIntervalUnit(u)}
                      className={cn("h-8 rounded-[8px] border text-[12.5px] font-medium transition-colors",
                        intervalUnit === u ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-600" : "hover:bg-muted/50")}>
                      {INTERVAL_LABEL[u]}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">สิ้นสุด (ไม่บังคับ — ไม่ใส่ = ทำซ้ำไปเรื่อยๆ)</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full h-8 rounded-[8px] border bg-background px-2 text-[12.5px] outline-none focus:border-brand-500" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  ระบบจะสร้างรายจ่ายนี้ให้อัตโนมัติ{INTERVAL_LABEL[intervalUnit]} เริ่มรอบถัดไป
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
            <button onClick={handleAdd} disabled={saving}
              className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} เพิ่มรายการ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Payment Modal ──────────────────────────────────────────────────────────── */
function PaymentModal({ tripId, from, to, amount, onClose, onPaid }: {
  tripId: string; from: Participant; to: Participant; amount: number
  onClose: () => void; onPaid: () => void
}) {
  const [note,    setNote]    = useState("")
  const [saving,  setSaving]  = useState(false)

  const handlePay = async () => {
    setSaving(true)
    try {
      await fetch(`/api/trips/${tripId}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_participant: from.id, to_participant: to.id, amount, note: note || null }),
      })
      toast.success("บันทึกการจ่ายแล้ว — รอผู้รับยืนยัน")
      onPaid()
      onClose()
    } catch { toast.error("เกิดข้อผิดพลาด") } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm">
        <div className="p-6 space-y-4">
          <h3 className="text-[17px] font-semibold">จ่ายเงิน</h3>
          <div className="p-4 bg-muted/40 rounded-xl text-center">
            <p className="text-sm text-muted-foreground">{from.display_name} → {to.display_name}</p>
            <p className="text-3xl font-black mt-1 text-brand-600">{fmtTHB(amount)}</p>
          </div>

          {/* Show QR if available */}
          {to.qr_image_url ? (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">สแกน QR เพื่อโอนเงิน</p>
              <img src={to.qr_image_url} alt="QR" className="w-48 h-48 mx-auto rounded-xl border object-contain" />
              <p className="text-xs font-medium">{to.display_name}</p>
            </div>
          ) : to.promptpay_value ? (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl text-center">
              <p className="text-xs text-muted-foreground mb-1">PromptPay</p>
              <p className="font-bold text-lg">{to.promptpay_value}</p>
              <button onClick={() => { navigator.clipboard.writeText(to.promptpay_value!); toast.success("คัดลอกแล้ว") }}
                className="mt-2 text-xs text-brand-500 flex items-center gap-1 mx-auto">
                <Copy className="w-3 h-3" /> คัดลอกเบอร์
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center">ไม่มีข้อมูล PromptPay — ติดต่อผู้รับโดยตรง</p>
          )}

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">หมายเหตุ (ไม่บังคับ)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="โอนแล้วนะ..."
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
            <button onClick={handlePay} disabled={saving}
              className="flex-1 h-10 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} ฉันโอนแล้ว ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Itinerary panel ────────────────────────────────────────────────────────── */
type ItineraryItem = {
  id: string; sort_order: number; type: string; title: string
  location: string | null; notes: string | null; amount: number | null
  time_from: string | null; time_to: string | null
}
type ItineraryDay = { id: string; dayNumber: number; date: string | null; title: string | null; items: ItineraryItem[] }

const ITEM_TYPE_META: Record<string, { label: string; icon: typeof MapPin; color: string }> = {
  activity:  { label: "กิจกรรม",   icon: Pin,         color: "text-violet-600 bg-violet-50 dark:bg-violet-500/10" },
  meal:      { label: "มื้ออาหาร", icon: Utensils,    color: "text-orange-600 bg-orange-50 dark:bg-orange-500/10" },
  transport: { label: "เดินทาง",   icon: Car,         color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10" },
  hotel:     { label: "ที่พัก",    icon: Hotel,       color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10" },
  booking:   { label: "การจอง",    icon: Ticket,      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" },
  other:     { label: "อื่นๆ",     icon: MapPin,      color: "text-muted-foreground bg-muted" },
}

function ItineraryPanel({ tripId }: { tripId: string }) {
  const [days, setDays] = useState<ItineraryDay[] | null>(null)
  const [showAddDay, setShowAddDay] = useState(false)
  const [addItemDayId, setAddItemDayId] = useState<string | null>(null)

  const load = () => {
    fetch(`/api/trips/${tripId}/itinerary`)
      .then(r => r.json())
      .then(d => setDays(d.days ?? []))
      .catch(() => setDays([]))
  }
  useEffect(load, [tripId])

  const removeDay = async (dayId: string) => {
    if (!confirm("ลบวันนี้ทั้งวัน พร้อมกิจกรรมทั้งหมดในนั้น?")) return
    await fetch(`/api/trips/${tripId}/itinerary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_day", dayId }),
    })
    load()
  }

  const removeItem = async (itemId: string) => {
    await fetch(`/api/trips/${tripId}/itinerary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_item", itemId }),
    })
    load()
  }

  if (days === null) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  return (
    <div className="space-y-4">
      {days.length === 0 && (
        <div className="rounded-xl border bg-card py-12 text-center">
          <Calendar className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="font-medium">ยังไม่มีแผนการเดินทาง</p>
          <p className="text-[12.5px] text-muted-foreground mt-1">เพิ่มวันแล้วใส่กิจกรรม ร้านอาหาร ที่พัก ทีละวันได้เลย</p>
        </div>
      )}

      {days.map(day => (
        <div key={day.id} className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
            <div>
              <p className="font-semibold text-sm">{day.title || `วันที่ ${day.dayNumber}`}</p>
              {day.date && <p className="text-[11.5px] text-muted-foreground">{fmtDate(day.date)}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setAddItemDayId(day.id)}
                className="h-7 px-2.5 rounded-[7px] bg-brand-500 hover:bg-brand-600 text-white text-[11.5px] font-medium flex items-center gap-1">
                <Plus className="w-3 h-3" /> กิจกรรม
              </button>
              <button onClick={() => removeDay(day.id)} className="h-7 w-7 rounded-[7px] hover:bg-muted flex items-center justify-center text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {day.items.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground px-4 py-4 text-center">ยังไม่มีกิจกรรมในวันนี้</p>
          ) : (
            <div className="divide-y">
              {day.items.map(item => {
                const meta = ITEM_TYPE_META[item.type] ?? ITEM_TYPE_META.other
                const Icon = meta.icon
                return (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-3 group">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", meta.color)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{item.title}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground mt-0.5">
                        {(item.time_from || item.time_to) && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.time_from?.slice(0, 5)}{item.time_to ? `–${item.time_to.slice(0, 5)}` : ""}</span>
                        )}
                        {item.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location}</span>}
                        {item.amount != null && <span>{fmtTHB(item.amount)}</span>}
                      </div>
                      {item.notes && <p className="text-[11.5px] text-muted-foreground mt-1">{item.notes}</p>}
                    </div>
                    <button onClick={() => removeItem(item.id)}
                      className="h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}

      <button onClick={() => setShowAddDay(true)}
        className="w-full h-11 rounded-xl border border-dashed text-sm font-medium text-muted-foreground hover:text-foreground hover:border-brand-500 transition-colors flex items-center justify-center gap-1.5">
        <Plus className="w-4 h-4" /> เพิ่มวัน
      </button>

      {showAddDay && (
        <AddDayModal tripId={tripId} onClose={() => setShowAddDay(false)} onDone={() => { setShowAddDay(false); load() }} />
      )}
      {addItemDayId && (
        <AddItineraryItemModal tripId={tripId} dayId={addItemDayId}
          onClose={() => setAddItemDayId(null)} onDone={() => { setAddItemDayId(null); load() }} />
      )}
    </div>
  )
}

function AddDayModal({ tripId, onClose, onDone }: { tripId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("")
  const [date,  setDate]  = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_day", title: title || undefined, date: date || undefined }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "เพิ่มวันไม่สำเร็จ")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">เพิ่มวัน</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อวัน (ไม่บังคับ)</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น วันแรก, ไปเกียวโต"
            className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">วันที่ (ไม่บังคับ)</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} เพิ่ม
          </button>
        </div>
      </div>
    </div>
  )
}

function AddItineraryItemModal({ tripId, dayId, onClose, onDone }: {
  tripId: string; dayId: string; onClose: () => void; onDone: () => void
}) {
  const [type, setType] = useState("activity")
  const [title, setTitle] = useState("")
  const [location, setLocation] = useState("")
  const [timeFrom, setTimeFrom] = useState("")
  const [timeTo, setTimeTo] = useState("")
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim()) { toast.error("กรอกชื่อกิจกรรม"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_item", dayId, type, title,
          location: location || undefined, notes: notes || undefined,
          amount: amount ? Number(amount) : undefined,
          timeFrom: timeFrom || undefined, timeTo: timeTo || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "เพิ่มกิจกรรมไม่สำเร็จ")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-semibold">เพิ่มกิจกรรม</h3>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1.5">ประเภท</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(ITEM_TYPE_META).map(([k, meta]) => {
                const Icon = meta.icon
                return (
                  <button key={k} onClick={() => setType(k)}
                    className={cn("h-16 rounded-[10px] border flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                      type === k ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-600" : "hover:bg-muted/50")}>
                    <Icon className="w-4 h-4" /> {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อ *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น วัดอาซากุสะ, ร้านราเมงอิจิรัน"
              className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">สถานที่ (ไม่บังคับ)</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="ที่อยู่หรือชื่อสถานที่"
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">เวลาเริ่ม</label>
              <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}
                className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">เวลาสิ้นสุด</label>
              <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)}
                className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ค่าใช้จ่ายโดยประมาณ (ไม่บังคับ)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
            <p className="text-[11px] text-muted-foreground mt-1">แค่บันทึกไว้ดู ไม่ได้เข้าไปในยอดหารบิลอัตโนมัติ — เพิ่มเป็นรายจ่ายจริงได้ที่แท็บ &quot;รายจ่าย&quot;</p>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">โน้ต (ไม่บังคับ)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="..."
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
            <button onClick={submit} disabled={saving}
              className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} เพิ่ม
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Pre-order panel ────────────────────────────────────────────────────────── */
type PreorderItemRow = { id: string; participant_id: string; name: string; price: number; qty: number; note: string | null }
type PreorderSession = {
  id: string; title: string; kind: "food" | "shopping"; status: "open" | "closed" | "cancelled"
  created_at: string; closed_at: string | null
  paid_by: { id: string; display_name: string } | null
  preorder_items: PreorderItemRow[]
}

function PreorderPanel({ tripId, participants }: { tripId: string; participants: Participant[] }) {
  const [sessions, setSessions] = useState<PreorderSession[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  const load = () => {
    fetch(`/api/trips/${tripId}/preorder`)
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
  }
  useEffect(load, [tripId])

  if (sessions === null) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  const openSession = sessions.find(s => s.id === openSessionId)
  if (openSession) {
    return (
      <PreorderSessionDetail
        tripId={tripId} sessionId={openSession.id} participants={participants}
        onBack={() => { setOpenSessionId(null); load() }}
      />
    )
  }

  const KIND_LABEL = { food: "🍽️ สั่งอาหาร", shopping: "🛍️ ซื้อของ/Pre-order" }
  const STATUS_BADGE: Record<PreorderSession["status"], string> = {
    open: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10",
    closed: "bg-muted text-muted-foreground",
    cancelled: "bg-red-50 text-red-600 dark:bg-red-500/10",
  }
  const STATUS_LABEL: Record<PreorderSession["status"], string> = { open: "เปิดรับออเดอร์", closed: "ปิดแล้ว", cancelled: "ยกเลิก" }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/5 dark:to-orange-500/5 p-4">
        <p className="text-sm font-medium mb-1">สั่งอาหารหรือซื้อของเป็นกลุ่ม</p>
        <p className="text-[12.5px] text-muted-foreground mb-3">แต่ละคนเพิ่มรายการของตัวเอง ระบบรวมยอดให้อัตโนมัติเมื่อปิดรับออเดอร์ — ไม่ต้องนั่งคิดเองว่าใครสั่งอะไร</p>
        <button onClick={() => setShowNew(true)}
          className="h-9 px-4 rounded-[9px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> เปิดรับออเดอร์ใหม่
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">ยังไม่มีรอบสั่งของ</div>
      ) : sessions.map(s => {
        const total = s.preorder_items.reduce((sum, it) => sum + Number(it.price) * it.qty, 0)
        const orderersCount = new Set(s.preorder_items.map(it => it.participant_id)).size
        return (
          <button key={s.id} onClick={() => setOpenSessionId(s.id)}
            className="w-full rounded-xl border bg-card p-4 flex items-center gap-3 text-left hover:bg-muted/20 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate">{s.title}</p>
                <span className={cn("text-[10.5px] font-medium px-2 py-0.5 rounded-full shrink-0", STATUS_BADGE[s.status])}>{STATUS_LABEL[s.status]}</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                {KIND_LABEL[s.kind]} · {orderersCount} คนสั่ง · {fmtTHB(total)}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground -rotate-90 shrink-0" />
          </button>
        )
      })}

      {showNew && (
        <NewPreorderSessionModal tripId={tripId} onClose={() => setShowNew(false)}
          onDone={(id) => { setShowNew(false); load(); setOpenSessionId(id) }} />
      )}
    </div>
  )
}

function NewPreorderSessionModal({ tripId, onClose, onDone }: {
  tripId: string; onClose: () => void; onDone: (sessionId: string) => void
}) {
  const [title, setTitle] = useState("")
  const [kind,  setKind]  = useState<"food" | "shopping">("food")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim()) { toast.error("ตั้งชื่อรอบสั่งของก่อน"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/preorder`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      onDone(d.sessionId)
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "เปิดรับออเดอร์ไม่สำเร็จ")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">เปิดรับออเดอร์ใหม่</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-muted-foreground block mb-1.5">ประเภท</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setKind("food")}
              className={cn("h-10 rounded-[8px] border text-sm font-medium flex items-center justify-center gap-1.5",
                kind === "food" ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-600" : "hover:bg-muted/50")}>
              <Utensils className="w-4 h-4" /> สั่งอาหาร
            </button>
            <button onClick={() => setKind("shopping")}
              className={cn("h-10 rounded-[8px] border text-sm font-medium flex items-center justify-center gap-1.5",
                kind === "shopping" ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-600" : "hover:bg-muted/50")}>
              <ShoppingBag className="w-4 h-4" /> ซื้อของ
            </button>
          </div>
        </div>
        <div>
          <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อรอบ *</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder={kind === "food" ? "เช่น สั่งข้าวเที่ยง" : "เช่น สั่งของออนไลน์รอบนี้"}
            className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} เปิดรับออเดอร์
          </button>
        </div>
      </div>
    </div>
  )
}

function PreorderSessionDetail({ tripId, sessionId, participants, onBack }: {
  tripId: string; sessionId: string; participants: Participant[]; onBack: () => void
}) {
  const [data, setData] = useState<{
    session: { id: string; status: string; kind: string }
    items: (PreorderItemRow & { trip_participants: { id: string; display_name: string } })[]
    participants: { id: string; display_name: string }[]
  } | null>(null)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [itemName, setItemName] = useState("")
  const [itemPrice, setItemPrice] = useState("")
  const [itemQty, setItemQty] = useState("1")
  const [closing, setClosing] = useState(false)
  const [paidById, setPaidById] = useState(participants.find(p => p.is_host)?.id ?? participants[0]?.id ?? "")

  const load = () => {
    fetch(`/api/trips/preorder/${sessionId}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
  }
  useEffect(load, [sessionId])

  if (!data) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  const isOpen = data.session.status === "open"
  const byParticipant = new Map<string, typeof data.items>()
  for (const it of data.items) {
    const arr = byParticipant.get(it.participant_id) ?? []
    arr.push(it); byParticipant.set(it.participant_id, arr)
  }
  const grandTotal = data.items.reduce((s, it) => s + Number(it.price) * it.qty, 0)

  const addItem = async () => {
    if (!addingFor || !itemName.trim() || !itemPrice) { toast.error("กรอกชื่อของและราคา"); return }
    await fetch(`/api/trips/preorder/${sessionId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_item", participantId: addingFor, name: itemName, price: Number(itemPrice), qty: Number(itemQty) || 1 }),
    })
    setItemName(""); setItemPrice(""); setItemQty("1")
    load()
  }

  const removeItem = async (itemId: string) => {
    await fetch(`/api/trips/preorder/${sessionId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_item", itemId }),
    })
    load()
  }

  const closeSession = async () => {
    if (!confirm(`ปิดรับออเดอร์และสร้างรายจ่าย ${fmtTHB(grandTotal)}?`)) return
    setClosing(true)
    try {
      const res = await fetch(`/api/trips/preorder/${sessionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", paidById }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error)
      toast.success("ปิดรับออเดอร์แล้ว — สร้างรายจ่ายเรียบร้อย ดูได้ที่แท็บ \"รายจ่าย\"")
      onBack()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "ปิดรับออเดอร์ไม่สำเร็จ")
    } finally { setClosing(false) }
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> กลับไปดูรายการรอบสั่งของ
      </button>

      {!isOpen && (
        <div className="rounded-xl border bg-muted/30 p-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Lock className="w-3.5 h-3.5" /> รอบนี้{data.session.status === "closed" ? "ปิดแล้ว — กลายเป็นรายจ่ายในระบบแล้ว" : "ถูกยกเลิก"}
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {data.participants.map(p => {
          const items = byParticipant.get(p.id) ?? []
          const subtotal = items.reduce((s, it) => s + Number(it.price) * it.qty, 0)
          return (
            <div key={p.id} className="border-b last:border-b-0">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                <span className="text-[13px] font-medium">{p.display_name}</span>
                <span className="text-[12.5px] font-semibold text-muted-foreground">{items.length > 0 ? fmtTHB(subtotal) : "—"}</span>
              </div>
              {items.map(it => (
                <div key={it.id} className="flex items-center gap-2 px-4 py-2 text-[13px] group">
                  <span className="flex-1 min-w-0 truncate">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                  <span className="text-muted-foreground shrink-0">{fmtTHB(Number(it.price) * it.qty)}</span>
                  {isOpen && (
                    <button onClick={() => removeItem(it.id)}
                      className="h-5 w-5 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              {isOpen && (
                addingFor === p.id ? (
                  <div className="px-4 pb-3 pt-1 flex gap-1.5">
                    <input autoFocus value={itemName} onChange={e => setItemName(e.target.value)} placeholder="ชื่อของ"
                      className="flex-1 h-8 rounded-[7px] border bg-background px-2 text-[12.5px] outline-none focus:border-brand-500 min-w-0" />
                    <input type="number" value={itemPrice} onChange={e => setItemPrice(e.target.value)} placeholder="ราคา"
                      className="w-16 h-8 rounded-[7px] border bg-background px-1.5 text-[12.5px] outline-none focus:border-brand-500" />
                    <input type="number" value={itemQty} onChange={e => setItemQty(e.target.value)} placeholder="จำนวน"
                      className="w-12 h-8 rounded-[7px] border bg-background px-1.5 text-[12.5px] outline-none focus:border-brand-500" />
                    <button onClick={addItem} className="h-8 w-8 rounded-[7px] bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setAddingFor(null)} className="h-8 w-8 rounded-[7px] hover:bg-muted flex items-center justify-center text-muted-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button onClick={() => setAddingFor(p.id)} className="w-full px-4 py-2 text-left text-[12.5px] text-brand-500 hover:bg-muted/30 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> เพิ่มของที่ {p.display_name} สั่ง
                  </button>
                )
              )}
            </div>
          )
        })}
        <div className="flex items-center justify-between px-4 py-3 bg-brand-50 dark:bg-brand-500/10">
          <span className="text-sm font-semibold">ยอดรวมทั้งหมด</span>
          <span className="text-[17px] font-black text-brand-600">{fmtTHB(grandTotal)}</span>
        </div>
      </div>

      {isOpen && data.items.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ใครออกเงินจ่ายไปก่อน</label>
            <select value={paidById} onChange={e => setPaidById(e.target.value)}
              className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500">
              {participants.map(p => <option key={p.id} value={p.id}>{p.display_name}{p.is_host ? " (เจ้าภาพ)" : ""}</option>)}
            </select>
          </div>
          <button onClick={closeSession} disabled={closing}
            className="w-full h-10 rounded-[10px] bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {closing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} ปิดรับออเดอร์ · สร้างรายจ่าย {fmtTHB(grandTotal)}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">แต่ละคนจะต้องจ่ายเท่ากับยอดที่ตัวเองสั่งพอดี</p>
        </div>
      )}
    </div>
  )
}

/* ─── Recurring expenses panel ──────────────────────────────────────────────── */
type RecurringTemplate = {
  id: string; title: string; amount: number; category: string | null
  interval_unit: IntervalUnit; next_run_date: string; end_date: string | null
  is_active: boolean; last_generated_at: string | null
  trip_participants: { id: string; display_name: string } | null
}

function RecurringPanel({ tripId }: { tripId: string }) {
  const [templates, setTemplates] = useState<RecurringTemplate[] | null>(null)

  const load = () => {
    fetch(`/api/trips/recurring?journeyId=${tripId}`)
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
  }
  useEffect(load, [tripId])

  const toggleActive = async (t: RecurringTemplate) => {
    await fetch(`/api/trips/recurring/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !t.is_active }),
    })
    load()
  }

  const remove = async (t: RecurringTemplate) => {
    if (!confirm(`ลบ "${t.title}" ออกจากรายจ่ายประจำ? (รายจ่ายที่สร้างไปแล้วจะไม่หายไป)`)) return
    await fetch(`/api/trips/recurring/${t.id}`, { method: "DELETE" })
    load()
  }

  if (templates === null) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-12 text-center">
        <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="font-medium">ยังไม่มีรายจ่ายประจำ</p>
        <p className="text-[12.5px] text-muted-foreground mt-1">เปิด &quot;ทำเป็นรายจ่ายประจำ&quot; ตอนเพิ่มรายจ่ายเพื่อตั้งค่าใช้จ่ายที่เกิดซ้ำ เช่น ค่าเช่า ค่าเน็ต</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {templates.map(t => (
        <div key={t.id} className={cn("rounded-xl border bg-card p-4 flex items-center gap-3", !t.is_active && "opacity-50")}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10"><MoneyIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-label={MONEY_CATEGORY.labelTh} /></span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{t.title}</p>
            <p className="text-[11.5px] text-muted-foreground">
              {fmtTHB(t.amount)} · {INTERVAL_LABEL[t.interval_unit]} · จ่ายก่อนโดย {t.trip_participants?.display_name ?? "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t.is_active ? `รอบถัดไป ${fmtDate(t.next_run_date)}` : "หยุดชั่วคราว"}
              {t.end_date ? ` · สิ้นสุด ${fmtDate(t.end_date)}` : ""}
            </p>
          </div>
          <button onClick={() => toggleActive(t)}
            className="h-8 px-3 rounded-[8px] border text-xs font-medium hover:bg-muted/50 whitespace-nowrap">
            {t.is_active ? "หยุดชั่วคราว" : "เปิดใช้อีกครั้ง"}
          </button>
          <button onClick={() => remove(t)} className="h-8 w-8 rounded-[8px] hover:bg-muted/50 flex items-center justify-center text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ─── Main ────────────────────────────────────────────────────────────────────── */
export function TripDetailClient({ trip, expenses, payments, settlement, orgId }: {
  trip: any; expenses: Expense[]; payments: Payment[]; settlement: Settlement[]; orgId: string
}) {
  const router = useRouter()
  const [showAdd,    setShowAdd]    = useState(false)
  const [payModal,   setPayModal]   = useState<{ from: Participant; to: Participant; amount: number } | null>(null)
  const [expandedExp, setExpandedExp] = useState<string | null>(null)
  const [tab,        setTab]        = useState<"expenses"|"settlement"|"payments"|"recurring"|"itinerary"|"preorder"|"members">("expenses")

  const participants: Participant[] = trip.trip_participants ?? []
  const baseCurrency = trip.base_currency ?? "THB"
  // amount_base_currency (post-conversion) — summing raw `amount` would mix
  // currencies together on a trip with e.g. both JPY and THB expenses.
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount_base_currency ?? e.amount), 0)
  const totalPaid     = participants.reduce((s, p) => s + Number(p.amount_paid), 0)
  const totalOwed     = participants.reduce((s, p) => s + Number(p.amount_owed), 0)
  const isSettled     = settlement.length === 0 && totalExpenses > 0

  // Points at the multi-expense LIFF trip page (liff/trips/[token]), not the
  // older single-bill liff/join/[token] flow — that one resolves tokens
  // against split_bills, which this trip (a life_journeys row) isn't in.
  const shareUrl = trip.share_token
    ? (process.env.NEXT_PUBLIC_LIFF_ID
        ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}/liff/trips/${trip.share_token}`
        : `${typeof window !== "undefined" ? window.location.origin : ""}/liff/trips/${trip.share_token}`)
    : null

  const pMap = Object.fromEntries(participants.map(p => [p.id, p]))

  const confirmPayment = async (paymentId: string) => {
    await fetch(`/api/trips/${trip.id}/pay`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, action: "confirm" }),
    })
    toast.success("ยืนยันแล้ว ✓")
    window.location.reload()
  }

  return (
    <div className="p-4 sm:page animate-fade-in">
      {/* Back + Header */}
      <button onClick={() => router.push("/trips")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> กลับ
      </button>

      <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-500/5 dark:to-indigo-500/5 p-5 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/80 dark:bg-white/10 flex items-center justify-center text-2xl shadow-sm">
              {trip.cover_emoji}
            </div>
            <div>
              <h2 className="text-xl font-bold">{trip.title}</h2>
              <p className="text-sm text-muted-foreground">
                {trip.venue ?? trip.destination ?? ""} · {participants.length} คน
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {shareUrl && (
              <button onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("คัดลอกลิงก์เชิญแล้ว") }}
                className="h-8 px-3 rounded-[8px] border bg-white/80 dark:bg-white/10 text-xs font-medium flex items-center gap-1.5 hover:bg-white transition-colors">
                <Copy className="w-3 h-3" /> เชิญเพื่อน
              </button>
            )}
            <button onClick={() => setShowAdd(true)}
              className="h-8 px-3 rounded-[8px] bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium flex items-center gap-1.5 transition-colors">
              <Plus className="w-3 h-3" /> เพิ่มรายจ่าย
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: "รายจ่ายรวม", value: fmtTHB(totalExpenses), color: "text-foreground" },
            { label: "จ่ายแล้ว",    value: fmtTHB(totalPaid),    color: "text-emerald-600" },
            { label: "ยังค้าง",      value: fmtTHB(Math.max(0, totalOwed - totalPaid)), color: "text-amber-600" },
          ].map(s => (
            <div key={s.label} className="text-center bg-white/60 dark:bg-white/5 rounded-xl p-2.5">
              <p className={cn("text-lg font-black", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs — scrolls horizontally instead of wrapping, so it stays a single
          clean row even with 7 tabs on a small screen. */}
      <div className="flex gap-0.5 border-b mb-4 overflow-x-auto">
        {[
          { id: "expenses",   label: `รายจ่าย (${expenses.length})` },
          { id: "itinerary",  label: "แผนการเดินทาง" },
          { id: "members",    label: "สมาชิก" },
          { id: "preorder",   label: "สั่งของ" },
          { id: "settlement", label: `สรุปการจ่าย ${isSettled ? "✅" : `(${settlement.length})`}` },
          { id: "payments",   label: `ประวัติโอน (${payments.length})` },
          { id: "recurring",  label: "รายจ่ายประจำ" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={cn("px-4 h-10 text-[13px] font-medium border-b-2 -mb-px transition whitespace-nowrap shrink-0",
              tab === t.id ? "border-brand-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "itinerary" && <ItineraryPanel tripId={trip.id} />}
      {tab === "members"   && <TripMembersPanel tripId={trip.id} />}
      {tab === "preorder"  && <PreorderPanel tripId={trip.id} participants={participants} />}
      {tab === "recurring" && <RecurringPanel tripId={trip.id} />}

      {/* Expenses tab */}
      {tab === "expenses" && (
        <div className="space-y-2">
          {expenses.length === 0 ? (
            <div className="rounded-xl border bg-card py-12 text-center">
              <p className="text-3xl mb-2">🧾</p>
              <p className="font-medium">ยังไม่มีรายจ่าย</p>
              <button onClick={() => setShowAdd(true)} className="mt-3 text-sm text-brand-500">+ เพิ่มรายจ่าย</button>
            </div>
          ) : expenses.map(e => (
            <div key={e.id} className="rounded-xl border bg-card overflow-hidden">
              <button onClick={() => setExpandedExp(expandedExp === e.id ? null : e.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/20">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10"><MoneyIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-label={MONEY_CATEGORY.labelTh} /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{(e.trip_participants as any)?.display_name} จ่าย · {fmtDate(e.expense_date)}</p>
                </div>
                <div className="text-right shrink-0">
                  {e.currency && e.currency !== baseCurrency ? (
                    <>
                      <p className="font-bold">{fmtCcy(e.amount, e.currency)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        ≈ {fmtTHB(e.amount_base_currency ?? e.amount)}{e.rate_is_manual ? " · เรทเอง" : ""}
                      </p>
                    </>
                  ) : (
                    <p className="font-bold">{fmtTHB(e.amount)}</p>
                  )}
                </div>
                {expandedExp === e.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {expandedExp === e.id && (
                <div className="border-t px-4 py-3 bg-muted/10">
                  <p className="text-xs text-muted-foreground mb-2">แบ่งกัน {SPLIT_MODE_DISPLAY[e.split_mode] ?? e.split_mode}</p>
                  <div className="space-y-1">
                    {(e.trip_expense_items ?? []).length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          รายการย่อย
                        </p>
                        <div className="rounded-lg border">
                          {[...(e.trip_expense_items ?? [])]
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map(li => (
                              <div key={li.id}
                                className="flex items-baseline gap-2 border-b px-2.5 py-1.5 last:border-0">
                                <span className="min-w-0 flex-1 truncate text-xs">{li.description}</span>
                                {li.quantity != null && li.unit_price != null && (
                                  <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                                    {li.quantity} × {li.unit_price.toLocaleString("th-TH")}
                                  </span>
                                )}
                                <span className="shrink-0 text-xs font-semibold tabular-nums">
                                  {fmtCcy(li.amount, e.currency ?? baseCurrency)}
                                </span>
                              </div>
                            ))}
                        </div>
                        {/* Reported, not enforced — a service charge or discount
                            legitimately sits outside the itemised lines. */}
                        {(() => {
                          const sum = (e.trip_expense_items ?? []).reduce((t, li) => t + Number(li.amount || 0), 0)
                          if (Math.abs(sum - e.amount) <= 0.01) return null
                          return (
                            <p className="mt-1 text-[10.5px] text-amber-600 dark:text-amber-400">
                              รายการย่อยรวม {fmtCcy(sum, e.currency ?? baseCurrency)} · ยอดที่จ่าย {fmtCcy(e.amount, e.currency ?? baseCurrency)}
                              {" "}(ส่วนต่างอาจเป็นค่าบริการหรือส่วนลด)
                            </p>
                          )
                        })()}
                      </div>
                    )}

                    {(e.expense_splits ?? []).map(s => {
                      const p = pMap[s.participant_id]
                      return (
                        <div key={s.participant_id} className="flex items-center justify-between text-xs">
                          <span className={s.is_paid ? "line-through text-muted-foreground" : ""}>{p?.display_name ?? "—"}</span>
                          <span className={cn("font-semibold", s.is_paid ? "text-emerald-600" : "text-foreground")}>{fmtTHB(s.amount)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Settlement tab */}
      {tab === "settlement" && (
        <div className="space-y-3">
          {isSettled ? (
            <div className="rounded-xl border bg-card py-12 text-center">
              <div className="text-4xl mb-2">🎉</div>
              <p className="font-bold text-lg text-emerald-600">เคลียร์แล้วทุกคน!</p>
              <p className="text-sm text-muted-foreground mt-1">ทุกรายการถูกชำระครบแล้ว</p>
            </div>
          ) : settlement.length === 0 && totalExpenses === 0 ? (
            <div className="rounded-xl border bg-card py-10 text-center text-muted-foreground text-sm">ยังไม่มีข้อมูล</div>
          ) : (
            <>
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>ด้านล่างคือการโอนที่น้อยที่สุดเพื่อเคลียร์หนี้ทั้งหมด — กดที่รายการเพื่อเริ่มจ่าย</span>
              </div>
              {settlement.map((s, i) => {
                const from = participants.find(p => p.id === s.from_id)
                const to   = participants.find(p => p.id === s.to_id)
                const alreadyPaid = payments.some(p => p.from_participant === s.from_id && p.to_participant === s.to_id && p.status === "confirmed")
                return (
                  <button key={i} onClick={() => from && to && setPayModal({ from, to, amount: s.amount })}
                    disabled={alreadyPaid}
                    className={cn("w-full rounded-xl border bg-card p-4 text-left hover:shadow-sm transition-all",
                      alreadyPaid ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/20")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold">
                          {s.from_name[0]}
                        </div>
                        <span className="font-medium">{s.from_name}</span>
                        <span className="text-muted-foreground">→</span>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center text-xs font-bold">
                          {s.to_name[0]}
                        </div>
                        <span className="font-medium">{s.to_name}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-brand-600">{fmtTHB(s.amount)}</p>
                        {alreadyPaid
                          ? <span className="text-[10px] text-emerald-600">ยืนยันแล้ว ✓</span>
                          : <span className="text-[10px] text-muted-foreground">แตะเพื่อจ่าย</span>}
                      </div>
                    </div>
                    {/* Show QR hint */}
                    {to?.qr_image_url && !alreadyPaid && (
                      <p className="text-[11px] text-brand-500 mt-1.5 flex items-center gap-1"><QrCode className="w-3 h-3" /> มี QR PromptPay</p>
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* Payments history tab */}
      {tab === "payments" && (
        <div className="space-y-2">
          {payments.length === 0 ? (
            <div className="rounded-xl border bg-card py-10 text-center text-muted-foreground text-sm">ยังไม่มีประวัติการโอน</div>
          ) : payments.map(p => {
            const from = pMap[p.from_participant]
            const to   = pMap[p.to_participant]
            return (
              <div key={p.id} className="rounded-xl border bg-card p-4 flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                  p.status === "confirmed" ? "bg-emerald-100 dark:bg-emerald-500/20" : p.status === "disputed" ? "bg-rose-100 dark:bg-rose-500/20" : "bg-amber-100 dark:bg-amber-500/20")}>
                  {p.status === "confirmed" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : p.status === "disputed" ? <X className="w-4 h-4 text-rose-600" /> : <Clock className="w-4 h-4 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{from?.display_name ?? "—"} → {to?.display_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(p.paid_at)} · {p.status === "confirmed" ? "ยืนยันแล้ว" : p.status === "disputed" ? "มีข้อพิพาท" : "รอยืนยัน"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold">{fmtTHB(p.amount)}</p>
                  {p.status === "pending" && to?.display_name && (
                    <button onClick={() => confirmPayment(p.id)}
                      className="text-[10px] text-emerald-600 hover:underline mt-0.5 block">ยืนยันรับ</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAdd && <AddExpenseModal tripId={trip.id} baseCurrency={trip.base_currency ?? "THB"} participants={participants} onClose={() => setShowAdd(false)} onAdd={() => {}} />}
      {payModal && (
        <PaymentModal tripId={trip.id} from={payModal.from} to={payModal.to} amount={payModal.amount}
          onClose={() => setPayModal(null)} onPaid={() => setPayModal(null)} />
      )}
    </div>
  )
}
