"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * LIFF page for the multi-payer trip expense system — opens inside LINE.
 * Mirrors the dashboard's (app)/trips/[id] experience (per-expense payer +
 * split method, net settlement with minimal transfers) but driven by LINE
 * identity instead of a Supabase session — see
 * api/liff/trips/[token]/route.ts for the backing endpoint.
 */

import { useEffect, useState, useCallback } from "react"
import QRCode from "qrcode"
import { buildPromptPayPayload } from "@/lib/promptpay"
import {
  Loader2, Plus, Check, X, AlertCircle, ChevronDown, ChevronUp, QrCode,
  ArrowLeft, ShoppingBag, Utensils, Lock,
} from "lucide-react"

interface Participant {
  id: string; displayName: string; isHost: boolean
  amountOwed: number; amountPaid: number
  promptpayType: string | null; promptpayValue: string | null; qrImageUrl: string | null
  isMe: boolean
}
interface ExpenseSplit { participantId: string; amount: number; isPaid: boolean }
interface Expense {
  id: string; title: string; amount: number; category: string | null
  splitMode: string; note: string | null; expenseDate: string
  paidById: string; paidByName: string; splits: ExpenseSplit[]
}
interface Settlement { fromId: string; fromName: string; toId: string; toName: string; amount: number }
interface PreorderItem { id: string; participantId: string; participantName: string; name: string; price: number; qty: number }
interface PreorderSession {
  id: string; title: string; kind: "food" | "shopping"; status: "open" | "closed" | "cancelled"
  paidById: string | null; items: PreorderItem[]
}
interface TripDetail {
  id: string; title: string; coverEmoji: string | null; destination: string | null; venue: string | null
  status: string; shareToken: string
  participants: Participant[]; expenses: Expense[]; settlement: Settlement[]
  preorderSessions: PreorderSession[]
}

const fmtTHB = (n: number) => "฿" + Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 })
const fmtDate = (d: string) => new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
const CAT_EMOJI: Record<string, string> = { food: "🍽️", transport: "🚗", accommodation: "🏨", activity: "🎯", other: "💰" }
const SPLIT_MODE_LABEL: Record<string, string> = {
  equal: "หารเท่ากัน", individual: "ระบุจำนวนเอง", percent: "ระบุเปอร์เซ็นต์", shares: "ตามจำนวนหุ้น",
}

export default function LiffTripPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ userId: string; displayName: string } | null>(null)
  const [trip, setTrip] = useState<TripDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"expenses" | "settlement" | "preorder">("expenses")
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [payModal, setPayModal] = useState<{ from: Participant; to: Participant; amount: number } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  const load = useCallback(async (t: string, lineUserId: string) => {
    const res = await fetch(`/api/liff/trips/${t}?lineUserId=${lineUserId}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? "โหลดข้อมูลไม่สำเร็จ"); return }
    setTrip(data.trip)
  }, [])

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const { initLiff, getLiffProfile } = await import("@/lib/liff")
        const ok = await initLiff()
        if (!ok) { setError("เปิดใช้งาน LIFF ไม่สำเร็จ"); setLoading(false); return }
        const p = await getLiffProfile()
        if (!p) return // getLiffProfile triggers a redirect to login when needed
        setProfile(p)
        await load(token, p.userId)
      } catch (err) {
        setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด")
      } finally {
        setLoading(false)
      }
    })()
  }, [token, load])

  const refresh = () => { if (token && profile) load(token, profile.userId) }

  const joinTrip = async () => {
    if (!token || !profile) return
    setJoining(true)
    try {
      const res = await fetch(`/api/liff/trips/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", lineUserId: profile.userId, displayName: profile.displayName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "เข้าร่วมไม่สำเร็จ"); return }
      setTrip(data.trip)
    } finally { setJoining(false) }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-rose-600">{error}</div>
  }
  if (!trip || !profile) return null

  const me = trip.participants.find(p => p.isMe)
  const pMap = Object.fromEntries(trip.participants.map(p => [p.id, p]))
  const totalExpenses = trip.expenses.reduce((s, e) => s + e.amount, 0)
  const isSettled = trip.settlement.length === 0 && totalExpenses > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 p-4 pb-10">
      <div className="max-w-md mx-auto space-y-4">
        {/* Header */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center text-2xl shrink-0">
              {trip.coverEmoji ?? "✈️"}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-[16px] truncate">{trip.title}</h1>
              <p className="text-xs text-muted-foreground">
                {trip.venue ?? trip.destination ?? ""} · {trip.participants.length} คน
              </p>
            </div>
          </div>

          {!me && (
            <button onClick={joinTrip} disabled={joining}
              className="mt-3 w-full h-10 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {joining && <Loader2 className="w-4 h-4 animate-spin" />} เข้าร่วมทริปนี้
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/60 dark:bg-slate-800/60 rounded-xl p-1">
          {[
            { id: "expenses" as const, label: `รายจ่าย (${trip.expenses.length})` },
            { id: "preorder" as const, label: "สั่งของ" },
            { id: "settlement" as const, label: `สรุปยอด ${isSettled ? "✅" : `(${trip.settlement.length})`}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 h-9 rounded-lg text-[13px] font-medium transition-colors ${tab === t.id ? "bg-white dark:bg-slate-700 shadow-sm" : "text-muted-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "expenses" && (
          <div className="space-y-2">
            {me && (
              <button onClick={() => setShowAdd(true)}
                className="w-full h-10 rounded-xl border-2 border-dashed border-violet-300 text-violet-600 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-violet-50/50">
                <Plus className="w-4 h-4" /> เพิ่มรายจ่าย
              </button>
            )}
            {trip.expenses.length === 0 ? (
              <div className="rounded-xl border bg-white dark:bg-slate-800 py-10 text-center text-sm text-muted-foreground">ยังไม่มีรายจ่าย</div>
            ) : trip.expenses.map(e => (
              <div key={e.id} className="rounded-xl border bg-white dark:bg-slate-800 overflow-hidden">
                <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="text-lg">{CAT_EMOJI[e.category ?? "other"] ?? "💰"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{e.paidByName} จ่าย · {fmtDate(e.expenseDate)}</p>
                  </div>
                  <p className="font-bold shrink-0 text-sm">{fmtTHB(e.amount)}</p>
                  {expandedId === e.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
                {expandedId === e.id && (
                  <div className="border-t px-4 py-3 bg-muted/20 space-y-1">
                    <p className="text-xs text-muted-foreground mb-1.5">{SPLIT_MODE_LABEL[e.splitMode] ?? e.splitMode}</p>
                    {e.splits.map(s => (
                      <div key={s.participantId} className="flex items-center justify-between text-xs">
                        <span className={s.isPaid ? "line-through text-muted-foreground" : ""}>{pMap[s.participantId]?.displayName ?? "—"}</span>
                        <span className="font-semibold">{fmtTHB(s.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "preorder" && (
          openSessionId ? (
            <PreorderSessionView
              token={token!} sessionId={openSessionId} myLineUserId={profile.userId}
              me={me} participants={trip.participants}
              onBack={() => { setOpenSessionId(null); refresh() }}
            />
          ) : (
            <PreorderList
              sessions={trip.preorderSessions} me={me} pMap={pMap}
              token={token!} myLineUserId={profile.userId}
              onOpen={(id) => setOpenSessionId(id)}
              onCreated={(id) => { refresh(); setOpenSessionId(id) }}
            />
          )
        )}

        {tab === "settlement" && (
          <div className="space-y-2">
            {isSettled ? (
              <div className="rounded-xl border bg-white dark:bg-slate-800 py-10 text-center">
                <div className="text-3xl mb-1.5">🎉</div>
                <p className="font-bold text-emerald-600">เคลียร์แล้วทุกคน!</p>
              </div>
            ) : trip.settlement.length === 0 ? (
              <div className="rounded-xl border bg-white dark:bg-slate-800 py-10 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</div>
            ) : (
              <>
                <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>นี่คือยอดโอนที่น้อยที่สุดเพื่อเคลียร์หนี้ทั้งหมด — ไม่ต้องโอนไปโอนมาหลายรอบ</span>
                </div>
                {trip.settlement.map((s, i) => {
                  const from = pMap[s.fromId]; const to = pMap[s.toId]
                  const canPay = me && me.id === s.fromId
                  return (
                    <button key={i} disabled={!canPay} onClick={() => from && to && setPayModal({ from, to, amount: s.amount })}
                      className={`w-full rounded-xl border bg-white dark:bg-slate-800 p-3.5 text-left ${canPay ? "hover:shadow-sm" : "opacity-70"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{s.fromName} → {s.toName}</span>
                        <span className="font-bold text-violet-600 text-sm">{fmtTHB(s.amount)}</span>
                      </div>
                      {canPay && <p className="text-[11px] text-violet-500 mt-1">แตะเพื่อจ่าย</p>}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      {showAdd && me && (
        <AddExpenseModal
          token={token!} participants={trip.participants} myId={me.id} myLineUserId={profile.userId}
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); refresh() }}
        />
      )}
      {payModal && (
        <PayModal participant={payModal} onClose={() => setPayModal(null)}
          onPaid={async (note) => {
            await fetch(`/api/liff/trips/${token}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "recordPayment", lineUserId: profile.userId,
                fromParticipantId: payModal.from.id, toParticipantId: payModal.to.id,
                payAmount: payModal.amount, payNote: note,
              }),
            })
            setPayModal(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/* ─── Add expense modal ──────────────────────────────────────────────────── */
type SplitMode = "equal" | "individual" | "percent" | "shares"

function AddExpenseModal({ token, participants, myId, myLineUserId, onClose, onDone }: {
  token: string; participants: Participant[]; myId: string; myLineUserId: string
  onClose: () => void; onDone: () => void
}) {
  const [title, setTitle] = useState("")
  const [amount, setAmount] = useState("")
  const [paidBy, setPaidBy] = useState(myId)
  const [category, setCategory] = useState("food")
  const [splitMode, setSplitMode] = useState<SplitMode>("equal")
  const [included, setIncluded] = useState<Set<string>>(new Set(participants.map(p => p.id)))
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  const includedList = participants.filter(p => included.has(p.id))
  const toggle = (id: string) => setIncluded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleAdd = async () => {
    if (!title.trim() || !amount) { setErr("กรอกชื่อรายการและจำนวนเงิน"); return }
    if (includedList.length === 0) { setErr("เลือกคนที่ร่วมจ่ายอย่างน้อย 1 คน"); return }
    setSaving(true); setErr("")
    try {
      const split_values = splitMode === "equal"
        ? {} : Object.fromEntries(includedList.map(p => [p.id, Number(values[p.id]) || 0]))
      const res = await fetch(`/api/liff/trips/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addExpense", lineUserId: myLineUserId,
          title, amount: Number(amount), category, paidById: paidBy,
          splitMode, splitWith: includedList.map(p => p.id), splitValues: split_values,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? "เกิดข้อผิดพลาด"); setSaving(false); return }
      onDone()
    } catch {
      setErr("เกิดข้อผิดพลาด")
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm max-h-[88vh] overflow-y-auto">
        <div className="p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[15px]">เพิ่มรายจ่าย</h3>
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="รายการ เช่น ค่าอาหาร"
            className="w-full h-10 rounded-lg border px-3 text-sm bg-background" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="จำนวน (บาท)"
              className="h-9 rounded-lg border px-2.5 text-sm bg-background" />
            <select value={category} onChange={e => setCategory(e.target.value)} className="h-9 rounded-lg border px-2 text-sm bg-background">
              {Object.keys(CAT_EMOJI).map(k => <option key={k} value={k}>{CAT_EMOJI[k]} {k}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">บิลนี้ใครออกก่อน</p>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)} className="w-full h-9 rounded-lg border px-2 text-sm bg-background">
              {participants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(SPLIT_MODE_LABEL) as SplitMode[]).map(m => (
              <button key={m} onClick={() => setSplitMode(m)}
                className={`h-8 rounded-lg border text-xs font-medium ${splitMode === m ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600" : ""}`}>
                {SPLIT_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="space-y-1 max-h-[180px] overflow-y-auto rounded-lg border p-2">
            {participants.map(p => {
              const isIn = included.has(p.id)
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <button onClick={() => toggle(p.id)}
                    className={`h-6 w-6 rounded-md border flex items-center justify-center shrink-0 ${isIn ? "bg-violet-500 border-violet-500 text-white" : ""}`}>
                    {isIn && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <span className={`flex-1 text-sm ${!isIn ? "text-muted-foreground" : ""}`}>{p.displayName}</span>
                  {isIn && splitMode !== "equal" && (
                    <input type="number" value={values[p.id] ?? ""} onChange={e => setValues(v => ({ ...v, [p.id]: e.target.value }))}
                      placeholder={splitMode === "individual" ? "บาท" : splitMode === "percent" ? "%" : "หุ้น"}
                      className="w-16 h-7 rounded border px-1.5 text-xs text-right bg-background" />
                  )}
                </div>
              )
            })}
          </div>
          <button onClick={handleAdd} disabled={saving}
            className="w-full h-10 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} เพิ่มรายการ
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Pay modal ──────────────────────────────────────────────────────────── */
function PayModal({ participant, onClose, onPaid }: {
  participant: { from: Participant; to: Participant; amount: number }
  onClose: () => void; onPaid: (note: string) => void
}) {
  const [note, setNote] = useState("")
  const [qr, setQr] = useState<string | null>(null)
  const { from, to, amount } = participant

  useEffect(() => {
    if (!to.promptpayValue) { setQr(null); return }
    QRCode.toDataURL(buildPromptPayPayload(to.promptpayValue, amount), { margin: 1, width: 220 })
      .then(setQr).catch(() => setQr(null))
  }, [to.promptpayValue, amount])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3.5 text-center">
        <h3 className="font-semibold text-[15px]">จ่ายเงิน</h3>
        <p className="text-sm text-muted-foreground">{from.displayName} → {to.displayName}</p>
        <p className="text-3xl font-black text-violet-600">{fmtTHB(amount)}</p>
        {to.qrImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={to.qrImageUrl} alt="QR" className="w-44 h-44 mx-auto rounded-xl border object-contain" />
        ) : qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="PromptPay QR" className="w-44 h-44 mx-auto" />
        ) : (
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><QrCode className="w-3.5 h-3.5" /> ไม่มี QR — ติดต่อผู้รับโดยตรง</p>
        )}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)"
          className="w-full h-9 rounded-lg border px-2.5 text-sm bg-background" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border text-sm font-medium">ยกเลิก</button>
          <button onClick={() => onPaid(note)} className="flex-1 h-10 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold">
            ฉันโอนแล้ว ✓
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Pre-order — self-service list (everyone types their own items) ──────── */
const PREORDER_STATUS_LABEL: Record<PreorderSession["status"], string> = {
  open: "เปิดรับออเดอร์", closed: "ปิดแล้ว", cancelled: "ยกเลิก",
}
const PREORDER_STATUS_STYLE: Record<PreorderSession["status"], string> = {
  open: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-rose-50 text-rose-600 dark:bg-rose-500/10",
}

function PreorderList({ sessions, me, pMap, token, myLineUserId, onOpen, onCreated }: {
  sessions: PreorderSession[]; me: Participant | undefined; pMap: Record<string, Participant>
  token: string; myLineUserId: string
  onOpen: (id: string) => void; onCreated: (id: string) => void
}) {
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/5 dark:to-orange-500/5 p-4 border">
        <p className="text-sm font-medium mb-1">สั่งอาหารหรือซื้อของเป็นกลุ่ม</p>
        <p className="text-[11.5px] text-muted-foreground mb-3">ทุกคนพิมพ์ของตัวเองเข้าไปเอง ไม่ต้องมีใครจดแทน — กลุ่มไลน์จะแจ้งเตือนทุกครั้งที่มีคนเพิ่ม/ลบรายการ</p>
        {me && (
          <button onClick={() => setShowNew(true)}
            className="h-9 px-4 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> เปิดรับออเดอร์ใหม่
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 py-10 text-center text-sm text-muted-foreground">ยังไม่มีรอบสั่งของ</div>
      ) : sessions.map(s => {
        const total = s.items.reduce((sum, it) => sum + it.price * it.qty, 0)
        const orderers = new Set(s.items.map(it => it.participantId)).size
        return (
          <button key={s.id} onClick={() => onOpen(s.id)}
            className="w-full rounded-xl border bg-white dark:bg-slate-800 p-3.5 flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
              {s.kind === "shopping" ? <ShoppingBag className="w-4 h-4 text-orange-600" /> : <Utensils className="w-4 h-4 text-orange-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm truncate">{s.title}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${PREORDER_STATUS_STYLE[s.status]}`}>{PREORDER_STATUS_LABEL[s.status]}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{orderers} คนสั่ง · {fmtTHB(total)}</p>
            </div>
          </button>
        )
      })}

      {showNew && (
        <NewPreorderModal token={token} myLineUserId={myLineUserId}
          onClose={() => setShowNew(false)}
          onDone={(id) => { setShowNew(false); onCreated(id) }} />
      )}
    </div>
  )
}

function NewPreorderModal({ token, myLineUserId, onClose, onDone }: {
  token: string; myLineUserId: string; onClose: () => void; onDone: (sessionId: string) => void
}) {
  const [title, setTitle] = useState("")
  const [kind, setKind] = useState<"food" | "shopping">("food")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  const submit = async () => {
    if (!title.trim()) { setErr("ตั้งชื่อรอบสั่งของก่อน"); return }
    setSaving(true); setErr("")
    try {
      const res = await fetch(`/api/liff/trips/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "openPreorder", lineUserId: myLineUserId, title, kind }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? "เปิดรับออเดอร์ไม่สำเร็จ"); setSaving(false); return }
      const newest = (data.trip.preorderSessions as PreorderSession[])[0]
      onDone(newest.id)
    } catch {
      setErr("เกิดข้อผิดพลาด"); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[15px]">เปิดรับออเดอร์ใหม่</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setKind("food")}
            className={`h-10 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${kind === "food" ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600" : ""}`}>
            <Utensils className="w-4 h-4" /> สั่งอาหาร
          </button>
          <button onClick={() => setKind("shopping")}
            className={`h-10 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${kind === "shopping" ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600" : ""}`}>
            <ShoppingBag className="w-4 h-4" /> ซื้อของ
          </button>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder={kind === "food" ? "เช่น สั่งข้าวเที่ยง" : "เช่น สั่งของออนไลน์รอบนี้"}
          className="w-full h-10 rounded-lg border px-3 text-sm bg-background" />
        <button onClick={submit} disabled={saving}
          className="w-full h-10 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} เปิดรับออเดอร์
        </button>
      </div>
    </div>
  )
}

function PreorderSessionView({ token, sessionId, myLineUserId, me, participants, onBack }: {
  token: string; sessionId: string; myLineUserId: string
  me: Participant | undefined; participants: Participant[]; onBack: () => void
}) {
  const [session, setSession] = useState<PreorderSession | null>(null)
  const [adding, setAdding] = useState(false)
  const [itemName, setItemName] = useState("")
  const [itemPrice, setItemPrice] = useState("")
  const [itemQty, setItemQty] = useState("1")
  const [paidById, setPaidById] = useState(me?.id ?? participants.find(p => p.isHost)?.id ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const load = useCallback(async () => {
    const res = await fetch(`/api/liff/trips/${token}?lineUserId=${myLineUserId}`)
    const data = await res.json()
    const found = (data.trip?.preorderSessions as PreorderSession[] | undefined)?.find(s => s.id === sessionId)
    setSession(found ?? null)
  }, [token, myLineUserId, sessionId])
  useEffect(() => { load() }, [load])

  if (!session) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  const isOpen = session.status === "open"
  const byParticipant = new Map<string, PreorderItem[]>()
  for (const it of session.items) {
    const arr = byParticipant.get(it.participantId) ?? []
    arr.push(it); byParticipant.set(it.participantId, arr)
  }
  const grandTotal = session.items.reduce((s, it) => s + it.price * it.qty, 0)

  const addMyItem = async () => {
    if (!itemName.trim() || !itemPrice) { setErr("กรอกชื่อของและราคา"); return }
    setBusy(true); setErr("")
    await fetch(`/api/liff/trips/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addPreorderItem", lineUserId: myLineUserId, sessionId,
        itemName, price: Number(itemPrice), qty: Number(itemQty) || 1,
      }),
    })
    setItemName(""); setItemPrice(""); setItemQty("1"); setAdding(false); setBusy(false)
    load()
  }

  const removeMyItem = async (itemId: string) => {
    await fetch(`/api/liff/trips/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removePreorderItem", lineUserId: myLineUserId, itemId }),
    })
    load()
  }

  const closeSession = async () => {
    if (!confirm(`ปิดรับออเดอร์และสร้างรายจ่าย ${fmtTHB(grandTotal)}?`)) return
    setBusy(true); setErr("")
    const res = await fetch(`/api/liff/trips/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "closePreorder", lineUserId: myLineUserId, sessionId, paidById }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? "ปิดรับออเดอร์ไม่สำเร็จ"); return }
    onBack()
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> กลับ
      </button>

      {!isOpen && (
        <div className="rounded-xl border bg-white/60 dark:bg-slate-800/60 p-3 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Lock className="w-3.5 h-3.5" /> รอบนี้{session.status === "closed" ? "ปิดแล้ว — กลายเป็นรายจ่ายในทริปแล้ว" : "ถูกยกเลิก"}
        </div>
      )}
      {err && <p className="text-xs text-rose-600 px-1">{err}</p>}

      <div className="rounded-xl border bg-white dark:bg-slate-800 overflow-hidden">
        {participants.map(p => {
          const items = byParticipant.get(p.id) ?? []
          const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0)
          const isMine = me?.id === p.id
          return (
            <div key={p.id} className="border-b last:border-b-0">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
                <span className="text-[13px] font-medium">{p.displayName}{isMine ? " (คุณ)" : ""}</span>
                <span className="text-[12px] font-semibold text-muted-foreground">{items.length > 0 ? fmtTHB(subtotal) : "—"}</span>
              </div>
              {items.map(it => (
                <div key={it.id} className="flex items-center gap-2 px-4 py-1.5 text-[13px]">
                  <span className="flex-1 min-w-0 truncate">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                  <span className="text-muted-foreground shrink-0">{fmtTHB(it.price * it.qty)}</span>
                  {isOpen && isMine && (
                    <button onClick={() => removeMyItem(it.id)} className="text-muted-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
              {isOpen && isMine && (
                adding ? (
                  <div className="px-4 pb-2.5 pt-1 flex gap-1.5">
                    <input autoFocus value={itemName} onChange={e => setItemName(e.target.value)} placeholder="ชื่อของ"
                      className="flex-1 h-8 rounded-md border px-2 text-xs bg-background min-w-0" />
                    <input type="number" value={itemPrice} onChange={e => setItemPrice(e.target.value)} placeholder="ราคา"
                      className="w-14 h-8 rounded-md border px-1.5 text-xs bg-background" />
                    <input type="number" value={itemQty} onChange={e => setItemQty(e.target.value)} placeholder="จน."
                      className="w-11 h-8 rounded-md border px-1.5 text-xs bg-background" />
                    <button onClick={addMyItem} disabled={busy} className="h-8 w-8 rounded-md bg-violet-500 text-white flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setAdding(false)} className="h-8 w-8 rounded-md border flex items-center justify-center shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} className="w-full px-4 py-2 text-left text-[12px] text-violet-500 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> เพิ่มของที่ฉันสั่ง
                  </button>
                )
              )}
            </div>
          )
        })}
        <div className="flex items-center justify-between px-4 py-3 bg-violet-50 dark:bg-violet-500/10">
          <span className="text-sm font-semibold">ยอดรวม</span>
          <span className="text-lg font-black text-violet-600">{fmtTHB(grandTotal)}</span>
        </div>
      </div>

      {isOpen && session.items.length > 0 && me && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 p-4 space-y-2.5">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">ใครออกเงินจ่ายไปก่อน</p>
            <select value={paidById} onChange={e => setPaidById(e.target.value)} className="w-full h-9 rounded-lg border px-2 text-sm bg-background">
              {participants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </div>
          <button onClick={closeSession} disabled={busy}
            className="w-full h-10 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} ปิดรับออเดอร์ · สร้างรายจ่าย {fmtTHB(grandTotal)}
          </button>
        </div>
      )}
    </div>
  )
}
