"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Users, Receipt, SplitSquareHorizontal,
  Plus, Trash2, X, Check, ChevronRight, Copy,
  Clock, CheckCircle2, FileText, Link, Loader2,
  ExternalLink, AlertCircle, RefreshCw,
  ArrowRight, TrendingUp, TrendingDown, Minus, Wallet,
} from "lucide-react"

/* ─── Types ───────────────────────────────────────────────────────────────── */
export type Participant = {
  id:            string
  name:          string
  email:         string | null
  amount:        number
  paid_at:       string | null
  line_user_id?: string | null
  is_non_line?:  boolean
}

export type SplitBill = {
  id:                 string
  title:              string
  total_amount:       number
  vat_amount?:        number
  note:               string | null
  status?:            string
  share_token?:       string | null
  line_group_id?:     string | null
  created_at:         string
  document_id:        string | null
  split_participants: Participant[]
}

type LineItem = { id: string; description: string; amount: number; quantity: number }
type ItemClaim = { line_item_id: string; participant_id: string | null; claimer_name: string | null }

export interface SplitClientProps {
  orgId: string
  bills: SplitBill[]
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const fmtTHB = (n: number) =>
  "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })
}

// Use LIFF URL if configured (opens inside LINE app with auto-identify)
// Otherwise falls back to regular web URL
function getShareUrl(token: string): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (liffId && typeof window !== "undefined") {
    return `https://liff.line.me/${liffId}/liff/join/${token}?type=split`
  }
  const base = typeof window !== "undefined" ? window.location.origin : "https://dev.slippyai.app"
  return `${base}/split/join/${token}`
}

/* ─── Confirm Delete Modal ────────────────────────────────────────────────── */
function ConfirmDeleteModal({ title, message, onConfirm, onCancel, loading }: {
  title:     string
  message:   string
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-rose-500" />
          </div>
          <h3 className="text-[16px] font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
            ยกเลิก
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 h-10 rounded-[10px] bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {loading ? "กำลังลบ..." : "ลบ"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Bill card ───────────────────────────────────────────────────────────── */
function BillCard({ bill, onMarkPaid, onDelete, onRemoveParticipant, onRefresh }: {
  bill:                SplitBill
  onMarkPaid:          (billId: string, participantId: string, paid: boolean) => void
  onDelete:            (billId: string) => void
  onRemoveParticipant: (billId: string, participantId: string) => void
  onRefresh:           (billId: string) => void
}) {
  const [expanded,      setExpanded]      = useState(false)
  const [lineItems,     setLineItems]     = useState<LineItem[]>([])
  const [claims,        setClaims]        = useState<ItemClaim[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [shareToken,    setShareToken]    = useState(bill.share_token ?? null)
  const [assigning,     setAssigning]     = useState<string | null>(null)

  // Delete confirmation state
  const [confirmDelete,     setConfirmDelete]     = useState(false)
  const [deletingBill,      setDeletingBill]      = useState(false)
  const [confirmDelParticipant, setConfirmDelParticipant] = useState<string | null>(null)  // participantId
  const [deletingParticipant,   setDeletingParticipant]   = useState(false)

  const total   = bill.split_participants.length
  const settled = bill.split_participants.filter(p => p.paid_at).length
  const pending = total - settled
  const pctDone = total > 0 ? (settled / total) * 100 : 0
  const shareUrl = shareToken ? getShareUrl(shareToken) : null
  const allPaid  = total > 0 && pending === 0

  // Load detail (line items + fresh share token) on expand
  useEffect(() => {
    if (!expanded || lineItems.length > 0) return
    setLoadingDetail(true)
    fetch(`/api/split/${bill.id}`)
      .then(r => r.json())
      .then(({ bill: detail, lineItems: items }) => {
        if (detail?.share_token) setShareToken(detail.share_token)
        setLineItems(items ?? [])
        // Extract claims from items
        setClaims((items ?? [])
          .filter((i: any) => i.claimed_by)
          .map((i: any) => ({ line_item_id: i.id, ...i.claimed_by }))
        )
      })
      .catch(() => {})
      .finally(() => setLoadingDetail(false))
  }, [expanded, bill.id, lineItems.length])

  const handleAssignItem = async (lineItemId: string, participantId: string) => {
    setAssigning(lineItemId)
    try {
      await fetch(`/api/split/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_item", lineItemId, participantId }),
      })
      const p = bill.split_participants.find(pp => pp.id === participantId)
      setClaims(prev => [
        ...prev.filter(c => c.line_item_id !== lineItemId),
        { line_item_id: lineItemId, participant_id: participantId, claimer_name: p?.name ?? null },
      ])
      toast.success("กำหนดผู้รับผิดชอบแล้ว")
    } catch {
      toast.error("เกิดข้อผิดพลาด")
    } finally {
      setAssigning(null)
    }
  }

  const copyLink = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl)
    toast.success("คัดลอกลิงก์แล้ว ✓")
  }

  const handleConfirmDeleteBill = async () => {
    setDeletingBill(true)
    await new Promise(r => setTimeout(r, 300))  // tiny delay for UX
    onDelete(bill.id)
    // modal closes automatically as card unmounts
  }

  const handleConfirmDeleteParticipant = async () => {
    if (!confirmDelParticipant) return
    setDeletingParticipant(true)
    try {
      const res = await fetch(`/api/split/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_participant", participantId: confirmDelParticipant }),
      })
      if (!res.ok) throw new Error()
      onRemoveParticipant(bill.id, confirmDelParticipant)
      toast.success("ลบผู้เข้าร่วมแล้ว")
    } catch {
      toast.error("ลบไม่สำเร็จ")
    } finally {
      setDeletingParticipant(false)
      setConfirmDelParticipant(null)
    }
  }

  const participantToDelete = bill.split_participants.find(p => p.id === confirmDelParticipant)

  return (
    <>
    {/* Confirm delete bill */}
    {confirmDelete && (
      <ConfirmDeleteModal
        title="ลบบิลนี้?"
        message={`"${bill.title}" และข้อมูลผู้เข้าร่วมทั้งหมดจะถูกลบถาวร ไม่สามารถกู้คืนได้`}
        loading={deletingBill}
        onConfirm={handleConfirmDeleteBill}
        onCancel={() => setConfirmDelete(false)}
      />
    )}

    {/* Confirm delete participant */}
    {confirmDelParticipant && (
      <ConfirmDeleteModal
        title="นำออกจากบิล?"
        message={`"${participantToDelete?.name}" จะถูกนำออกจากบิล "${bill.title}" และยอดจะถูกคำนวณใหม่`}
        loading={deletingParticipant}
        onConfirm={handleConfirmDeleteParticipant}
        onCancel={() => setConfirmDelParticipant(null)}
      />
    )}

    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0",
          allPaid ? "bg-emerald-500/10" : "bg-muted"
        )}>
          {allPaid ? "✅" : "🧾"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{bill.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{total} คน · {fmtDate(bill.created_at)}</p>
          {total > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden w-[100px]">
                <div className={cn("h-full rounded-full transition-all", allPaid ? "bg-emerald-500" : "bg-brand-500")}
                  style={{ width: `${pctDone}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{settled}/{total} จ่ายแล้ว</span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold text-sm">{fmtTHB(Number(bill.total_amount))}</p>
          {pending > 0
            ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 font-medium">ค้าง {pending} คน</span>
            : total > 0
            ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 font-medium">ครบแล้ว ✓</span>
            : null}
        </div>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-90")} />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t">
          {loadingDetail && (
            <div className="py-4 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Note */}
          {bill.note && (
            <div className="px-5 py-2.5 text-xs text-muted-foreground bg-muted/30 italic border-b">{bill.note}</div>
          )}

          {/* Participants */}
          <div className="divide-y divide-border">
            {bill.split_participants.map(p => (
              <div key={p.id} className="group/row flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {p.name[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.email && <p className="text-xs text-muted-foreground truncate">{p.email}</p>}
                  {p.line_user_id && <span className="text-[10px] text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full">LINE</span>}
                </div>
                <p className="text-sm font-semibold shrink-0">{fmtTHB(Number(p.amount))}</p>
                {/* Mark paid button */}
                <button
                  onClick={() => onMarkPaid(bill.id, p.id, !p.paid_at)}
                  title={p.paid_at ? "ยกเลิกการจ่าย" : "ทำเครื่องหมายว่าจ่ายแล้ว"}
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center transition-colors shrink-0",
                    p.paid_at ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {p.paid_at ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </button>
                {/* Remove participant — แสดงเมื่อ hover */}
                <button
                  onClick={() => setConfirmDelParticipant(p.id)}
                  title="นำออกจากบิล"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground
                    hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors
                    opacity-0 group-hover/row:opacity-100 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {bill.split_participants.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">ยังไม่มีผู้เข้าร่วม</div>
            )}
          </div>

          {/* Line items from document */}
          {lineItems.length > 0 && (
            <div className="border-t px-5 py-4">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                🧾 รายการสินค้า — กดเพื่อกำหนดผู้รับผิดชอบ
              </p>
              <div className="space-y-2">
                {lineItems.map(item => {
                  const claim       = claims.find(c => c.line_item_id === item.id)
                  const claimerName = claim?.claimer_name ??
                    bill.split_participants.find(p => p.id === claim?.participant_id)?.name
                  const isClaimed   = !!claim?.participant_id

                  return (
                    <div key={item.id}
                      className="flex items-center gap-3 py-2 border rounded-lg px-3 group/item">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.description}</p>
                        <p className="text-xs text-muted-foreground">{fmtTHB(item.amount)}</p>
                      </div>

                      {/* Assigned: show name badge + dropdown to change */}
                      {isClaimed ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10.5px] bg-brand-50 text-brand-600
                            dark:bg-brand-500/10 dark:text-brand-400
                            px-2 py-0.5 rounded-full font-semibold">
                            {claimerName}
                          </span>
                          <select
                            value={claim?.participant_id ?? ""}
                            onChange={e => e.target.value
                              ? handleAssignItem(item.id, e.target.value)
                              : handleAssignItem(item.id, "")}
                            disabled={assigning === item.id}
                            className="h-6 rounded-md border bg-muted text-[11px] px-1.5 text-foreground
                              opacity-0 group-hover/item:opacity-100 transition-opacity w-24">
                            <option value="">หารเท่า</option>
                            {bill.split_participants.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        /* Not claimed → show "หารเท่า" badge + dropdown on hover */
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10.5px] bg-emerald-50 text-emerald-600
                            dark:bg-emerald-500/10 dark:text-emerald-400
                            px-2 py-0.5 rounded-full font-semibold
                            group-hover/item:opacity-0 transition-opacity">
                            ✦ หารเท่า
                          </span>
                          <select
                            defaultValue=""
                            onChange={e => e.target.value && handleAssignItem(item.id, e.target.value)}
                            disabled={assigning === item.id}
                            className="h-7 rounded-lg border bg-muted text-xs px-2 text-foreground
                              absolute opacity-0 group-hover/item:opacity-100 group-hover/item:static
                              transition-all">
                            <option value="">หารเท่า (ทุกคน)</option>
                            {bill.split_participants.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Share link */}
          <div className="border-t px-5 py-4 bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Link className="w-3 h-3" /> ลิงก์สำหรับแชร์ (เพื่อนที่ไม่มี LINE ใช้ได้)
            </p>
            {shareUrl ? (
              <div className="flex gap-2">
                <input
                  readOnly value={shareUrl}
                  className="flex-1 h-8 text-xs rounded-lg border px-2.5 bg-background font-mono truncate"
                />
                <button onClick={copyLink}
                  className="h-8 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5">
                  <Copy className="w-3 h-3" /> คัดลอก
                </button>
                <a href={shareUrl} target="_blank" rel="noreferrer"
                  className="h-8 px-2.5 rounded-lg border bg-background hover:bg-muted text-muted-foreground transition-colors inline-flex items-center">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">กำลังโหลดลิงก์...</p>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-3 flex items-center justify-between bg-muted/10">
            <button onClick={() => onRefresh(bill.id)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-3 h-3" /> รีเฟรช
            </button>
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-rose-500 hover:text-rose-600 transition-colors">
              <Trash2 className="w-3 h-3" /> ลบบิล
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

/* ─── Create Bill Modal ───────────────────────────────────────────────────── */
type ParticipantInput = { name: string; email: string; amount: string }
type DocOption = { id: string; vendor_name: string | null; total_amount: number | null; doc_date: string | null; document_line_items: any[] }

function CreateBillModal({ orgId, onClose, onCreate }: {
  orgId:    string
  onClose:  () => void
  onCreate: (bill: SplitBill) => void
}) {
  const [mode,   setMode]   = useState<"manual" | "from_doc">("manual")
  const [title,  setTitle]  = useState("")
  const [total,  setTotal]  = useState("")
  const [note,   setNote]   = useState("")
  const [people, setPeople] = useState<ParticipantInput[]>([
    { name: "", email: "", amount: "" },
    { name: "", email: "", amount: "" },
  ])
  const [loading, setLoading]   = useState(false)

  // From document mode
  const [docs,        setDocs]       = useState<DocOption[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<DocOption | null>(null)

  // Load docs when switching to from_doc
  useEffect(() => {
    if (mode !== "from_doc" || docs.length > 0) return
    setDocsLoading(true)
    fetch(`/api/split/documents?orgId=${orgId}`)
      .then(r => r.json())
      .then(({ documents }) => setDocs(documents ?? []))
      .catch(() => toast.error("โหลดเอกสารไม่สำเร็จ"))
      .finally(() => setDocsLoading(false))
  }, [mode, orgId, docs.length])

  // When doc selected, auto-fill from its data
  const handleSelectDoc = (doc: DocOption) => {
    setSelectedDoc(doc)
    setTitle(doc.vendor_name ?? "หารบิล")
    setTotal(String(doc.total_amount ?? 0))
    // Pre-fill participants — max 5 คน (ผู้ใช้เพิ่มเองได้ภายหลัง)
    const items = doc.document_line_items ?? []
    if (items.length > 0) {
      const initCount = Math.min(items.length, 5)
      setPeople(Array.from({ length: initCount }, () => ({ name: "", email: "", amount: "" })))
    }
  }

  const addPerson = () => setPeople(p => [...p, { name: "", email: "", amount: "" }])
  const removePerson = (i: number) => setPeople(p => p.filter((_, idx) => idx !== i))

  const splitEvenly = () => {
    const n = people.length
    if (!n || !total) return
    const each = (Number(total) / n).toFixed(2)
    setPeople(p => p.map(pp => ({ ...pp, amount: each })))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validPeople = people.filter(p => p.name.trim())
    if (!validPeople.length) { toast.error("กรอกชื่อผู้เข้าร่วมอย่างน้อย 1 คน"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          title:       title.trim() || "บิลหารค่าใช้จ่าย",
          totalAmount: Number(total),
          note:        note.trim() || undefined,
          documentId:  selectedDoc?.id,
          participants: validPeople.map(p => ({
            name:   p.name.trim(),
            email:  p.email.trim() || undefined,
            amount: Number(p.amount) || 0,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const newBill: SplitBill = {
        id:           data.billId,
        title:        title.trim() || "บิลหารค่าใช้จ่าย",
        total_amount: Number(total),
        note:         note.trim() || null,
        status:       "open",
        share_token:  data.shareToken,
        created_at:   new Date().toISOString(),
        document_id:  selectedDoc?.id ?? null,
        split_participants: validPeople.map((p, i) => ({
          id:      `temp-${i}`,
          name:    p.name.trim(),
          email:   p.email.trim() || null,
          amount:  Number(p.amount) || 0,
          paid_at: null,
        })),
      }
      onCreate(newBill)
      toast.success("สร้างบิลเรียบร้อย 🎉")
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? "เกิดข้อผิดพลาด")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-[17px] font-semibold">สร้างบิลใหม่</h3>
              <p className="text-xs text-muted-foreground mt-0.5">แชร์ค่าใช้จ่ายกับผู้เข้าร่วม</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 bg-muted p-1 rounded-[10px] mb-5">
            {([
              { id: "manual",   label: "✏️ กรอกเอง" },
              { id: "from_doc", label: "📄 จากเอกสาร" },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setMode(t.id)}
                className={cn("flex-1 h-8 rounded-[7px] text-sm font-medium transition-colors",
                  mode === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* From document mode */}
            {mode === "from_doc" && (
              <div>
                <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">เลือกเอกสาร</label>
                {docsLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...
                  </div>
                ) : docs.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">ไม่พบเอกสารที่มีรายการสินค้า</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {docs.map(doc => (
                      <button key={doc.id} type="button"
                        onClick={() => handleSelectDoc(doc)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] border text-left transition-colors",
                          selectedDoc?.id === doc.id
                            ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                            : "border-border hover:bg-muted/50"
                        )}>
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.vendor_name ?? "ไม่ระบุร้าน"}</p>
                          <p className="text-xs text-muted-foreground">{doc.doc_date ?? "—"} · {doc.document_line_items.length} รายการ</p>
                        </div>
                        <p className="text-sm font-semibold shrink-0">฿{doc.total_amount?.toLocaleString()}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedDoc && (
                  <div className="mt-3 p-3 rounded-[10px] bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/30">
                    <p className="text-xs font-medium text-brand-700 dark:text-brand-300">
                      ✓ เลือก: {selectedDoc.vendor_name} — ฿{selectedDoc.total_amount?.toLocaleString()}
                    </p>
                    <p className="text-xs text-brand-600 dark:text-brand-400 mt-0.5">
                      {selectedDoc.document_line_items.length} รายการ · ตั้งชื่อบิลและเพิ่มผู้ร่วมด้านล่าง
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Bill title */}
            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">ชื่อบิล *</label>
              <input required value={title} onChange={e => setTitle(e.target.value)}
                placeholder="เช่น อาหารเย็น, ทริปเที่ยว"
                className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
            </div>

            {/* Total amount */}
            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">ยอดรวม (บาท) *</label>
              <input required type="number" min="0" step="0.01" value={total} onChange={e => setTotal(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
            </div>

            {/* Note */}
            <div>
              <label className="block text-[11.5px] font-medium text-muted-foreground mb-1">หมายเหตุ</label>
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder="เพิ่มรายละเอียด (ไม่บังคับ)"
                className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
            </div>

            {/* Participants */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11.5px] font-medium text-muted-foreground">ผู้เข้าร่วม</label>
                <div className="flex gap-2">
                  <button type="button" onClick={splitEvenly}
                    className="text-[11px] text-brand-500 hover:text-brand-600 font-medium">หารเท่ากัน</button>
                  <button type="button" onClick={addPerson}
                    className="h-6 px-2 rounded-[6px] bg-muted text-xs font-medium inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" /> เพิ่ม
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {people.map((p, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input value={p.name} onChange={e => setPeople(prev => prev.map((pp, j) => j === i ? { ...pp, name: e.target.value } : pp))}
                      placeholder={`คนที่ ${i + 1}`}
                      className="flex-1 h-9 rounded-[8px] border bg-background px-2.5 text-sm outline-none focus:border-brand-500" />
                    <input value={p.amount} type="number" min="0" step="0.01"
                      onChange={e => setPeople(prev => prev.map((pp, j) => j === i ? { ...pp, amount: e.target.value } : pp))}
                      placeholder="฿"
                      className="w-24 h-9 rounded-[8px] border bg-background px-2.5 text-sm outline-none focus:border-brand-500" />
                    {people.length > 1 && (
                      <button type="button" onClick={() => removePerson(i)}
                        className="h-9 w-9 rounded-[8px] hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted transition-colors">
                ยกเลิก
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {loading ? "กำลังสร้าง..." : "สร้างบิล"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ─── Balance helpers ─────────────────────────────────────────────────────── */
type PersonBalance = { name: string; net: number /* positive = owed to them, negative = they owe */ }
type Settlement    = { from: string; to: string; amount: number }

function computeBalances(bills: SplitBill[]): PersonBalance[] {
  // key = line_user_id when available, otherwise name (normalised lowercase)
  const netMap:  Record<string, number> = {}
  const nameMap: Record<string, string> = {}  // key → display name

  for (const bill of bills) {
    for (const p of bill.split_participants) {
      const key  = (p.line_user_id ?? p.name.trim().toLowerCase())
      const name = p.name.trim()
      if (!netMap[key]) { netMap[key] = 0; nameMap[key] = name }
      if (!p.paid_at) netMap[key] -= Number(p.amount)
      else            netMap[key] += Number(p.amount)
    }
  }
  return Object.entries(netMap)
    .filter(([, n]) => Math.abs(n) >= 1)
    .map(([key, net]) => ({ name: nameMap[key], net }))
    .sort((a, b) => b.net - a.net)
}

function simplifyDebts(balances: PersonBalance[]): Settlement[] {
  const creditors = balances.filter(b => b.net > 0).map(b => ({ ...b }))
  const debtors   = balances.filter(b => b.net < 0).map(b => ({ ...b }))
  const result: Settlement[] = []
  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci], d = debtors[di]
    const amount = Math.min(c.net, -d.net)
    result.push({ from: d.name, to: c.name, amount: Math.round(amount) })
    c.net -= amount
    d.net += amount
    if (Math.abs(c.net) < 1) ci++
    if (Math.abs(d.net) < 1) di++
  }
  return result
}

/* ─── Balance overview card ───────────────────────────────────────────────── */
function BalanceCard({ bills }: { bills: SplitBill[] }) {
  const [showSettle, setShowSettle] = useState(false)
  const balances    = computeBalances(bills)
  const settlements = simplifyDebts(balances)

  if (balances.length === 0) return null

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-brand-500" />
            <span className="text-sm font-semibold">ยอดคงค้างสุทธิ</span>
          </div>
          {settlements.length > 0 && (
            <button onClick={() => setShowSettle(true)}
              className="h-7 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors">
              ชำระหนี้
            </button>
          )}
        </div>
        <div className="divide-y divide-border">
          {balances.map(b => (
            <div key={b.name} className="flex items-center gap-3 px-5 py-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {b.name[0]?.toUpperCase() ?? "?"}
              </div>
              <span className="flex-1 text-sm font-medium">{b.name}</span>
              <div className="flex items-center gap-1.5">
                {b.net > 0
                  ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  : <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
                <span className={cn("text-sm font-bold",
                  b.net > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {b.net > 0 ? "+" : ""}{fmtTHB(Math.abs(b.net))}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {b.net > 0 ? "ถูกติดหนี้" : "ติดหนี้"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showSettle && (
        <SettleUpModal settlements={settlements} onClose={() => setShowSettle(false)} />
      )}
    </>
  )
}

/* ─── Settle Up Modal ─────────────────────────────────────────────────────── */
function SettleUpModal({ settlements, onClose }: { settlements: Settlement[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-[17px] font-semibold">ชำระหนี้ให้เสร็จสิ้น</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                ทำ {settlements.length} รายการเพื่อปิดหนี้ทั้งหมด
              </p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {settlements.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 rounded-[10px] bg-muted/50 border">
                <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center text-xs font-bold text-rose-600 dark:text-rose-400 shrink-0">
                  {s.from[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{s.from}</p>
                  <p className="text-xs text-muted-foreground">จ่ายให้ {s.to}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-brand-500">{fmtTHB(s.amount)}</p>
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {s.to[0]?.toUpperCase()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground text-center mt-4">
            คำนวณด้วยอัลกอริทึมลดจำนวนรายการให้น้อยที่สุด
          </p>
          <button onClick={onClose}
            className="w-full mt-3 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors">
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main SplitClient ───────────────────────────────────────────────────── */
export function SplitClient({ orgId, bills: initialBills }: SplitClientProps) {
  const [bills,     setBills]     = useState<SplitBill[]>(initialBills)
  const [showModal, setShowModal] = useState(false)
  const sbRef = useRef(createClient())

  // Realtime subscription
  useEffect(() => {
    const sb = sbRef.current
    const channel = sb.channel(`split:${orgId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "split_participants",
      }, async (payload) => {
        const billId = (payload.new as any)?.split_bill_id ?? (payload.old as any)?.split_bill_id
        if (!billId) return
        // Re-fetch the affected bill
        const { data } = await sb.from("split_bills")
          .select("id, title, total_amount, vat_amount, note, status, share_token, document_id, created_at, split_participants(id, name, email, amount, paid_at, line_user_id, is_non_line)")
          .eq("id", billId).single()
        if (data) setBills(prev => prev.map(b => b.id === billId ? (data as SplitBill) : b))
      })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [orgId])

  const handleMarkPaid = async (billId: string, participantId: string, paid: boolean) => {
    // Optimistic
    setBills(prev => prev.map(b => b.id !== billId ? b : {
      ...b,
      split_participants: b.split_participants.map(p =>
        p.id !== participantId ? p : { ...p, paid_at: paid ? new Date().toISOString() : null }
      ),
    }))
    try {
      await fetch(`/api/split/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: paid ? "mark_paid" : "mark_unpaid", participantId }),
      })
    } catch {
      // Revert
      setBills(prev => prev.map(b => b.id !== billId ? b : {
        ...b,
        split_participants: b.split_participants.map(p =>
          p.id !== participantId ? p : { ...p, paid_at: paid ? null : new Date().toISOString() }
        ),
      }))
      toast.error("อัปเดตไม่สำเร็จ")
    }
  }

  const handleDelete = async (billId: string) => {
    setBills(prev => prev.filter(b => b.id !== billId))
    await fetch(`/api/split/${billId}`, { method: "DELETE" }).catch(() => {})
    toast.success("ลบบิลแล้ว")
  }

  const handleRemoveParticipant = (billId: string, participantId: string) => {
    setBills(prev => prev.map(b => {
      if (b.id !== billId) return b
      const remaining = b.split_participants.filter(p => p.id !== participantId)
      // Recalculate even split for remaining participants
      const totalAmt = b.total_amount
      const n = remaining.length
      const evenAmt = n > 0 ? +(totalAmt / n).toFixed(2) : 0
      return {
        ...b,
        split_participants: remaining.map(p => ({ ...p, amount: evenAmt })),
      }
    }))
  }

  const handleRefresh = useCallback(async (billId: string) => {
    const { data } = await sbRef.current
      .from("split_bills")
      .select("id, title, total_amount, vat_amount, note, status, share_token, document_id, created_at, split_participants(id, name, email, amount, paid_at, line_user_id, is_non_line)")
      .eq("id", billId).single()
    if (data) setBills(prev => prev.map(b => b.id === billId ? (data as SplitBill) : b))
  }, [])

  const handleCreate = (newBill: SplitBill) => setBills(prev => [newBill, ...prev])

  const activeBills    = bills.filter(b => b.status !== "finalized")
  const pendingPeople  = bills.flatMap(b => b.split_participants).filter(p => !p.paid_at).length
  const pendingAmount  = bills.flatMap(b => b.split_participants).filter(p => !p.paid_at).reduce((s, p) => s + Number(p.amount), 0)

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <SplitSquareHorizontal className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold">หารบิล</h2>
            <p className="text-muted-foreground text-sm">แชร์ค่าใช้จ่ายกับเพื่อนง่ายๆ</p>
          </div>
        </div>
        <button onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> สร้างบิลใหม่
        </button>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: "บิลที่ค้างอยู่", value: activeBills.length.toString(), icon: Receipt, color: "text-brand-500", bg: "bg-brand-500/10" },
          { label: "คนค้างจ่าย",    value: pendingPeople.toString(),        icon: Users,   color: "text-amber-500", bg: "bg-amber-500/10" },
          { label: "ยอดรอรับ",      value: fmtTHB(pendingAmount),           icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
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

      {/* Balance Overview */}
      {bills.length > 0 && <BalanceCard bills={bills} />}

      {/* Bills list */}
      {bills.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-16 px-8 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <SplitSquareHorizontal className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="font-medium">ยังไม่มีบิล</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">กดปุ่ม "สร้างบิลใหม่" เพื่อแชร์ค่าใช้จ่ายกับเพื่อนหรือทีม</p>
          <button onClick={() => setShowModal(true)}
            className="mt-5 h-9 px-5 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors">
            สร้างบิลแรก
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">บิลทั้งหมด ({bills.length})</h3>
          {bills.map(bill => (
            <BillCard key={bill.id} bill={bill}
              onMarkPaid={handleMarkPaid}
              onDelete={handleDelete}
              onRemoveParticipant={handleRemoveParticipant}
              onRefresh={handleRefresh}
            />
          ))}
        </div>
      )}

      {showModal && (
        <CreateBillModal orgId={orgId} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}
