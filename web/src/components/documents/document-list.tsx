"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import Link                    from "next/link"
import { useRouter }           from "next/navigation"
import { createClient }        from "@/lib/supabase/client"
import { toast }               from "sonner"
import {
  Search, Calendar, Filter, LayoutGrid, Table2,
  Eye, MoreHorizontal, Check, Send, Globe, Mail,
  Inbox, RefreshCw, Trash2, Loader2, X,
} from "lucide-react"
import { cn }                  from "@/lib/utils"
import { formatThb, formatDate } from "@/lib/utils"

const STATUS_TABS = [
  { id: "all",       th: "ทั้งหมด" },
  { id: "reviewing", th: "รอตรวจสอบ" },
  { id: "approved",  th: "อนุมัติแล้ว" },
  { id: "pushed",    th: "ส่งเข้าบัญชี" },
  { id: "failed",    th: "ล้มเหลว" },
] as const

const THUMB_MAP: Record<string, string> = {
  "7-eleven": "🧾", "seven": "🧾", "ซีพี": "🧾",
  "grab": "🚖",
  "amazon web services": "☁️", "aws": "☁️",
  "การไฟฟ้า": "💡", "mea": "💡",
  "ais": "📶",
  "truemove": "📱", "true": "📱",
  "starbucks": "☕",
  "ptt": "⛽",
  "การประปา": "💧", "mwa": "💧",
  "figma": "🎨",
  "lazada": "📦",
  "mk ": "🍲", "mk r": "🍲",
  "tops": "🛒",
  "studio 7": "📱", "istudio": "📱",
  "property": "🏢", "พร็อพ": "🏢",
  "central": "💳",
  "somtam": "🍜", "ส้มตำ": "🍜",
}

function getThumb(name: string | null): string {
  if (!name) return "🧾"
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(THUMB_MAP)) {
    if (lower.includes(key.toLowerCase())) return icon
  }
  return "🧾"
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; th: string }> = {
    pending:    { cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",           th: "รอดำเนินการ" },
    processing: { cls: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",               th: "กำลังประมวลผล" },
    reviewing:  { cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",           th: "รอตรวจสอบ" },
    approved:   { cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",   th: "อนุมัติแล้ว" },
    pushed:     { cls: "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",       th: "ส่งเข้าบัญชี" },
    failed:     { cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",               th: "ล้มเหลว" },
    rejected:   { cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",           th: "ปฏิเสธ" },
  }
  const s = map[status] ?? map.pending
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.th}
    </span>
  )
}

function SourceIcon({ source }: { source: string }) {
  if (source === "line")  return <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />LINE</span>
  if (source === "email") return <span className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 dark:text-blue-400"><Mail className="w-2.5 h-2.5" />Email</span>
  return <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Globe className="w-2.5 h-2.5" />Web</span>
}

interface Doc {
  id:                 string
  vendor_name:        string | null
  total_amount:       number | null
  vat_amount?:        number | null
  status:             string
  doc_date:           string | null
  doc_type?:          string | null
  doc_category?:      string | null
  expense_category?:  string | null
  overall_confidence: number | null
  is_duplicate?:      boolean
  source:             string
  created_at?:        string
  doc_number?:        string | null
}

/**
 * Doc-type groups behind the dashboard's "เข้าถึงเอกสารได้อย่างรวดเร็ว" cards.
 * The DB stores fine-grained doc_type values; the dashboard links in the
 * user-facing grouping (`?type=receipt` etc.), so map it back here.
 */
const TYPE_GROUPS: Record<string, { th: string; types: string[] }> = {
  receipt:     { th: "บิล / ใบเสร็จ", types: ["receipt", "expense"] },
  invoice:     { th: "ใบแจ้งหนี้",    types: ["invoice", "tax_invoice"] },
  credit_note: { th: "ใบลดหนี้",      types: ["credit_note"] },
}

export function DocumentList({
  documents: initialDocs, orgId, initialVendorFilter,
  initialStatus, initialType, initialCategory,
}: {
  documents: Doc[]
  orgId?: string
  initialVendorFilter?: string
  initialStatus?: string
  initialType?: string
  initialCategory?: string
}) {
  const router = useRouter()
  const [aiResults,   setAiResults]   = useState<Doc[] | null>(null)
  const [aiSearching, setAiSearching] = useState(false)

  // ── Stable Supabase client ref — createBrowserClient returns a singleton but
  //    calling it in the component body still produces a new JS reference each
  //    render, making useEffect deps unstable. useRef guarantees one instance.
  const sbRef = useRef(createClient())
  const supabase = sbRef.current

  const [documents, setDocuments] = useState(initialDocs)
  const [status,   setStatus]   = useState(
    STATUS_TABS.some(t => t.id === initialStatus) ? initialStatus! : "all",
  )
  // Deep-link filters from the dashboard's quick-access / folder cards.
  // Both are dismissible chips rather than sticky state, so the list behaves
  // exactly as before once cleared.
  const [typeGroup, setTypeGroup] = useState(
    initialType && TYPE_GROUPS[initialType] ? initialType : null,
  )
  const [category,  setCategory]  = useState(initialCategory?.trim() || null)

  // ── Realtime ────────────────────────────────────────────────────────────────
  const [connStatus,    setConnStatus]    = useState<"connecting" | "live" | "error">("connecting")
  const [liveActivity,  setLiveActivity]  = useState<{ id: string; type: "new" | "updated" } | null>(null)
  const [reconnectKey,  setReconnectKey]  = useState(0)
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollInterval    = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryCount      = useRef(0)   // exponential backoff: 0→3s, 1→6s, 2→12s, 3→20s

  // fetchDoc is stable because sbRef.current never changes
  const fetchDoc = useCallback(async (id: string) => {
    const { data } = await sbRef.current
      .from("documents")
      .select("id, vendor_name, total_amount, vat_amount, status, created_at, source, overall_confidence, doc_date, doc_type, doc_number, doc_category, expense_category")
      .eq("id", id)
      .single()
    return data
  }, [])

  // Refresh all docs from DB (used as fallback when realtime is offline)
  const refreshDocs = useCallback(async () => {
    if (!orgId) return
    const { data } = await sbRef.current
      .from("documents")
      .select("id, vendor_name, total_amount, vat_amount, status, created_at, source, overall_confidence, doc_date, doc_type, doc_number, doc_category, expense_category")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100)
    if (data) setDocuments(data as Doc[])
  }, [orgId])

  // Manual reconnect: increment key → useEffect re-runs → new channel
  const handleReconnect = useCallback(() => {
    retryCount.current = 0   // reset backoff on manual reconnect
    setConnStatus("connecting")
    setReconnectKey(k => k + 1)
  }, [])

  useEffect(() => {
    if (!orgId) return

    // Clear any pending auto-reconnect timer
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)

    const channel = supabase
      .channel(`docs-list:${orgId}:${reconnectKey}`)
      .on(
        "postgres_changes",
        // ── ไม่ใช้ server-side filter เพราะต้องการ REPLICA IDENTITY FULL ──
        // กรองฝั่ง client แทน (ปลอดภัยเพราะ RLS ใน fetchDoc จัดการแล้ว)
        { event: "*", schema: "public", table: "documents" },
        async (payload) => {
          // Client-side org filter — กรองเฉพาะ doc ของ org นี้
          const rowOrgId = (payload.new as any)?.organization_id
                        ?? (payload.old as any)?.organization_id
          if (rowOrgId && rowOrgId !== orgId) return   // ไม่ใช่ของ org นี้

          if (payload.eventType === "INSERT") {
            const docId = (payload.new as any).id as string
            const doc = await fetchDoc(docId)
            if (!doc) return
            setDocuments(prev => prev.find(d => d.id === doc.id) ? prev : [doc as Doc, ...prev])
            setLiveActivity({ id: doc.id, type: "new" })
            setTimeout(() => setLiveActivity(null), 4000)
            toast.success(
              `📄 เอกสารใหม่: ${(doc as any).vendor_name ?? "ไม่ระบุผู้ขาย"}`,
              { description: "เข้ามาในระบบแล้ว", duration: 4000 }
            )
          } else if (payload.eventType === "UPDATE") {
            const docId = (payload.new as any).id as string
            const doc = await fetchDoc(docId)
            if (!doc) return
            setDocuments(prev => prev.map(d => d.id === doc.id ? doc as Doc : d))
            setLiveActivity({ id: doc.id, type: "updated" })
            setTimeout(() => setLiveActivity(null), 4000)
            const newStatus = (doc as any).status as string
            const STATUS_LABEL: Record<string, string> = {
              reviewing: "รอตรวจสอบ", approved: "อนุมัติแล้ว ✅",
              pushed: "ส่งเข้าบัญชีแล้ว ✅", failed: "ล้มเหลว ❌", processing: "กำลังประมวลผล…",
            }
            if (STATUS_LABEL[newStatus]) toast(`⚡ ${(doc as any).vendor_name ?? "เอกสาร"} — ${STATUS_LABEL[newStatus]}`, { duration: 3500 })
          } else if (payload.eventType === "DELETE") {
            const delId = (payload.old as any)?.id
            if (delId) setDocuments(prev => prev.filter(d => d.id !== delId))
          }
        }
      )
      .subscribe((subStatus, err) => {
        if (subStatus === "SUBSCRIBED") {
          setConnStatus("live")
          retryCount.current = 0   // reset backoff on success
          if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null }
          console.log("[realtime] ✅ connected")

        } else if (subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT") {
          setConnStatus("error")
          console.warn("[realtime]", subStatus, err?.message ?? "")

          // Start polling as fallback so data still updates
          if (!pollInterval.current) pollInterval.current = setInterval(refreshDocs, 8_000)

          // Exponential backoff: 3s → 6s → 12s → 20s → 20s (cap)
          const delay = Math.min(3000 * Math.pow(2, retryCount.current), 20_000)
          retryCount.current = Math.min(retryCount.current + 1, 4)
          console.log(`[realtime] retry in ${delay / 1000}s (attempt ${retryCount.current})`)
          reconnectTimer.current = setTimeout(() => {
            setConnStatus("connecting")
            setReconnectKey(k => k + 1)
          }, delay)
        }
      })

    return () => {
      supabase.removeChannel(channel)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [orgId, reconnectKey])  // reconnectKey forces re-subscribe

  // Cleanup poll on unmount
  useEffect(() => () => {
    if (pollInterval.current) clearInterval(pollInterval.current)
  }, [])
  const [search,   setSearch]   = useState(initialVendorFilter ?? "")

  const handleAiSearch = useCallback(async () => {
    if (!search.trim() || !orgId) return
    setAiSearching(true)
    try {
      const res = await fetch("/api/documents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search.trim(), orgId }),
      })
      const { documents: found } = await res.json()
      setAiResults(found ?? [])
    } catch { toast.error("ค้นหาไม่สำเร็จ") }
    finally  { setAiSearching(false) }
  }, [search, orgId])
  const [view,     setView]     = useState<"table" | "card">("table")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [acting,      setActing]      = useState<Record<string, "retry" | "delete" | null>>({})
  const [bulkDeleting, setBulkDeleting] = useState(false)

  async function handleRetry(id: string) {
    setActing(a => ({ ...a, [id]: "retry" }))
    setDocuments(ds => ds.map(d => d.id === id ? { ...d, status: "processing" } : d))
    try {
      await fetch(`/api/documents/${id}/process`, { method: "POST" })
    } catch {
      toast.error("ลองอีกครั้งไม่สำเร็จ")
    } finally {
      setActing(a => ({ ...a, [id]: null }))
    }
  }

  async function handleBulkRetry() {
    const ids = [...selected].filter(id => {
      const doc = documents.find(d => d.id === id)
      return doc?.status === "failed" || doc?.status === "pending" ||
        (doc?.status === "reviewing" && (doc.overall_confidence ?? 1) < 0.3)
    })
    if (!ids.length) { toast.error("ไม่มีเอกสารที่ล้มเหลวในรายการที่เลือก"); return }
    setDocuments(ds => ds.map(d => ids.includes(d.id) ? { ...d, status: "processing" } : d))
    await Promise.all(ids.map(id => fetch(`/api/documents/${id}/process`, { method: "POST" })))
    toast.success(`🔄 ส่งประมวลผลใหม่ ${ids.length} รายการแล้ว`)
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (!confirm(`ลบ ${ids.length} รายการที่เลือก?`)) return
    setBulkDeleting(true)
    try {
      await Promise.all(ids.map(id => fetch(`/api/documents/${id}`, { method: "DELETE" })))
      setDocuments(ds => ds.filter(d => !ids.includes(d.id)))
      setSelected(new Set())
      router.refresh()
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("ลบเอกสารนี้ออกจากระบบ?")) return
    setActing(a => ({ ...a, [id]: "delete" }))
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" })
      if (res.ok) {
        setDocuments(ds => ds.filter(d => d.id !== id))
        router.refresh()
      }
    } finally {
      setActing(a => ({ ...a, [id]: null }))
    }
  }

  const filtered = useMemo(() => {
    // Use AI search results if available
    const base = aiResults ?? documents
    return base.filter(d => {
      if (status !== "all" && d.status !== status) return false
      if (typeGroup && !TYPE_GROUPS[typeGroup].types.includes(d.doc_type ?? "")) return false
      if (category && (d.expense_category ?? "") !== category) return false
      if (!aiResults && search) {
        const q = search.toLowerCase()
        if (!(d.vendor_name ?? "").toLowerCase().includes(q) &&
            !(d.doc_number ?? "").toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [documents, status, typeGroup, category, search, aiResults])

  // Status-tab counts respect the deep-link chips so the numbers match the rows.
  const scoped = useMemo(() => documents.filter(d => {
    if (typeGroup && !TYPE_GROUPS[typeGroup].types.includes(d.doc_type ?? "")) return false
    if (category && (d.expense_category ?? "") !== category) return false
    return true
  }), [documents, typeGroup, category])

  const counts = useMemo(() => STATUS_TABS.reduce((acc, t) => {
    acc[t.id] = t.id === "all" ? scoped.length : scoped.filter(d => d.status === t.id).length
    return acc
  }, {} as Record<string, number>), [scoped])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const allSelected = filtered.length > 0 && filtered.every(d => selected.has(d.id))

  return (
    <div className="space-y-4">
      {/* Realtime live indicator */}
      {liveActivity && (
        <div className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl text-sm font-medium animate-in slide-in-from-bottom-2 duration-300",
          liveActivity.type === "new"
            ? "bg-brand-500 text-white shadow-brand-500/30"
            : "bg-emerald-500 text-white shadow-emerald-500/30"
        )}>
          <span className="h-2 w-2 rounded-full bg-white animate-ping" />
          {liveActivity.type === "new" ? "📄 เอกสารใหม่เข้ามา" : "⚡ สถานะอัปเดตแล้ว"}
        </div>
      )}

      {/* Tab nav */}
      <div className="flex items-center gap-0.5 border-b border-border -mt-1 overflow-x-auto">
        {/* Live connection badge */}
        {orgId && connStatus !== "error" && (
          <div className={cn(
            "ml-auto flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium",
            connStatus === "live"       && "text-emerald-600 dark:text-emerald-400",
            connStatus === "connecting" && "text-muted-foreground",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              connStatus === "live"       && "bg-emerald-500 animate-pulse",
              connStatus === "connecting" && "bg-muted-foreground animate-pulse",
            )} />
            {connStatus === "live" ? "Live" : "กำลังเชื่อมต่อ…"}
          </div>
        )}

        {/* Offline — show reconnect button */}
        {orgId && connStatus === "error" && (
          <button
            type="button"
            onClick={handleReconnect}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
              text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10
              transition-colors border border-rose-200 dark:border-rose-800/50"
            title="คลิกเพื่อเชื่อมต่อ Realtime ใหม่"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            ออฟไลน์ — กดเพื่อเชื่อมต่อใหม่
          </button>
        )}
        {STATUS_TABS.map(tab => {
          const active = status === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              className={cn(
                "px-3.5 h-10 text-[13.5px] font-medium border-b-2 -mb-px transition whitespace-nowrap shrink-0",
                active
                  ? "border-brand-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.th}
              <span className={cn(
                "ml-2 inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[11px]",
                active ? "bg-brand-500/15 text-brand-600 dark:text-brand-300" : "bg-muted text-muted-foreground"
              )}>
                {counts[tab.id]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Deep-link filter chips (from the dashboard cards) */}
      {(typeGroup || category) && (
        <div className="flex flex-wrap items-center gap-2">
          {typeGroup && (
            <button
              onClick={() => setTypeGroup(null)}
              className="flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full text-[12px] font-medium
                bg-brand-500/10 text-brand-600 dark:text-brand-300 hover:bg-brand-500/15 transition-colors"
            >
              ประเภท: {TYPE_GROUPS[typeGroup].th}
              <X className="w-3 h-3" />
            </button>
          )}
          {category && (
            <button
              onClick={() => setCategory(null)}
              className="flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full text-[12px] font-medium
                bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-500/15 transition-colors"
            >
              หมวดหมู่: {category}
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative group">
          {aiSearching
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500 animate-spin pointer-events-none" />
            : <Search  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />}
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setAiResults(null) }}
            onKeyDown={e => { if (e.key === "Enter" && search.trim() && orgId) handleAiSearch() }}
            placeholder="✨ ค้นหา เช่น 'HomePro เดือนที่แล้ว', 'VAT ขอคืนได้'..."
            className="w-full h-10 rounded-[10px] border border-border bg-card text-sm text-foreground
              pl-10 pr-24 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 placeholder:text-muted-foreground/60 transition"
          />
          {search && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {!aiSearching && (
                <button onClick={handleAiSearch} disabled={!orgId}
                  className="h-6 px-2 rounded-[6px] bg-brand-500 hover:bg-brand-600 text-white text-[10px] font-medium transition-colors">
                  AI ค้นหา
                </button>
              )}
              <button onClick={() => { setSearch(""); setAiResults(null) }}
                className="h-6 w-6 rounded-[6px] hover:bg-muted flex items-center justify-center text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        {aiResults && (
          <div className="w-full -mt-1 px-1">
            <p className="text-[11px] text-brand-500 font-medium">
              ✨ AI พบ {aiResults.length} รายการ สำหรับ "{search}"
              <button onClick={() => { setAiResults(null); setSearch("") }} className="ml-2 text-muted-foreground hover:text-foreground">ล้างผล</button>
            </p>
          </div>
        )}
        <button className="h-10 px-4 rounded-[10px] border border-border bg-card text-sm font-medium text-foreground
          hover:bg-muted transition inline-flex items-center gap-2 shrink-0">
          <Calendar className="w-4 h-4" /> พ.ค. 2026
        </button>
        <button className="h-10 px-4 rounded-[10px] border border-border bg-card text-sm font-medium text-foreground
          hover:bg-muted transition inline-flex items-center gap-2 shrink-0">
          <Filter className="w-4 h-4" /> ตัวกรอง
        </button>
        <div className="inline-flex p-0.5 bg-muted rounded-[10px] shrink-0">
          <button
            onClick={() => setView("table")}
            className={cn("h-8 px-2.5 rounded-[8px] text-xs font-medium flex items-center gap-1.5 transition",
              view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
          >
            <Table2 className="w-3.5 h-3.5" /> ตาราง
          </button>
          <button
            onClick={() => setView("card")}
            className={cn("h-8 px-2.5 rounded-[8px] text-xs font-medium flex items-center gap-1.5 transition",
              view === "card" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> การ์ด
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (() => {
        const selectedDocs = [...selected].map(id => documents.find(d => d.id === id)).filter(Boolean) as Doc[]
        const failedCount  = selectedDocs.filter(d =>
          d.status === "failed" || d.status === "pending" ||
          (d.status === "reviewing" && (d.overall_confidence ?? 1) < 0.3)
        ).length
        return (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 dark:bg-brand-500/10 rounded-[10px] border border-brand-200 dark:border-brand-500/20 flex-wrap">
            <span className="text-sm font-semibold text-foreground shrink-0">{selected.size} รายการที่เลือก</span>
            <div className="h-4 w-px bg-border mx-1 shrink-0" />

            {/* Retry — only when failed docs selected */}
            {failedCount > 0 && (
              <button
                onClick={handleBulkRetry}
                className="h-8 px-3 rounded-[8px] border border-indigo-200 dark:border-indigo-500/30 bg-card text-xs font-medium
                  text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10
                  transition inline-flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                ลองอีกครั้ง {failedCount > 0 && `(${failedCount})`}
              </button>
            )}

            <button className="h-8 px-3 rounded-[8px] border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition inline-flex items-center gap-1.5 shrink-0">
              <Check className="w-3.5 h-3.5" /> อนุมัติ
            </button>
            <button className="h-8 px-3 rounded-[8px] border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition inline-flex items-center gap-1.5 shrink-0">
              <Send className="w-3.5 h-3.5" /> ส่งเข้าบัญชี
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="h-8 px-3 rounded-[8px] border border-rose-200 dark:border-rose-500/30 bg-card text-xs font-medium
                text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10
                transition inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              ลบ
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground transition shrink-0"
            >
              ยกเลิก
            </button>
          </div>
        )
      })()}

      {/* Table view */}
      {view === "table" && filtered.length > 0 && (
        <div className="bg-card border border-border rounded-[12px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="pl-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={e => setSelected(e.target.checked ? new Set(filtered.map(d => d.id)) : new Set())}
                      className="h-4 w-4 rounded border-border accent-brand-500"
                    />
                  </th>
                  <th className="py-3 font-medium">ผู้ขาย / ไฟล์</th>
                  <th className="py-3 font-medium hidden md:table-cell">หมวดหมู่</th>
                  <th className="py-3 font-medium text-right">ยอดเงิน</th>
                  <th className="py-3 font-medium text-right hidden sm:table-cell">VAT</th>
                  <th className="py-3 font-medium">สถานะ</th>
                  <th className="py-3 font-medium hidden sm:table-cell">วันที่</th>
                  <th className="py-3 pr-4 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(doc => (
                  <tr key={doc.id} className={cn(
                    "hover:bg-muted/40 transition group",
                    liveActivity?.id === doc.id && "bg-brand-50/50 dark:bg-brand-500/5"
                  )}>
                    <td className="pl-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        className="h-4 w-4 rounded border-border accent-brand-500"
                      />
                    </td>
                    <td className="py-3">
                      <Link href={`/documents/${doc.id}/review`} className="flex items-center gap-2.5 min-w-0">
                        <span className="h-9 w-9 rounded-[8px] bg-muted text-lg flex items-center justify-center shrink-0">
                          {getThumb(doc.vendor_name)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium text-foreground truncate max-w-[180px]">
                            {doc.vendor_name ?? "—"}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <span className="truncate max-w-[120px]">{doc.doc_number ?? doc.id.slice(0, 8)}</span>
                            <span>·</span>
                            <SourceIcon source={doc.source} />
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="py-3 text-[12.5px] text-muted-foreground hidden md:table-cell">
                      {doc.doc_category ?? doc.doc_type ?? "—"}
                    </td>
                    <td className="py-3 text-right font-semibold text-foreground tabular-nums whitespace-nowrap">
                      {doc.total_amount != null ? formatThb(doc.total_amount) : "—"}
                    </td>
                    <td className="py-3 text-right text-[12.5px] text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">
                      {doc.vat_amount != null ? formatThb(doc.vat_amount) : "—"}
                    </td>
                    <td className="py-3"><StatusBadge status={doc.status} /></td>
                    <td className="py-3 text-[12.5px] text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                      {doc.doc_date ? formatDate(doc.doc_date) : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* Show retry when: failed, pending, OR reviewing with very low confidence */}
                        {(doc.status === "failed" || doc.status === "pending" ||
                          (doc.status === "reviewing" && (doc.overall_confidence ?? 1) < 0.3)) ? (
                          // Show retry always visible
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); handleRetry(doc.id) }}
                              disabled={!!acting[doc.id]}
                              title="ลองอีกครั้ง"
                              className="h-7 w-7 rounded-[6px] bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20
                                flex items-center justify-center text-indigo-600 dark:text-indigo-400 disabled:opacity-50 transition"
                            >
                              {acting[doc.id] === "retry"
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <RefreshCw className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(doc.id) }}
                              disabled={!!acting[doc.id]}
                              title="ลบเอกสาร"
                              className="h-7 w-7 rounded-[6px] hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center justify-center text-rose-400 disabled:opacity-50 transition"
                            >
                              {acting[doc.id] === "delete"
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        ) : (
                          // Normal: hover to reveal
                          <div className="opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1">
                            <Link
                              href={`/documents/${doc.id}/review`}
                              className="h-7 w-7 rounded-[6px] hover:bg-muted flex items-center justify-center text-muted-foreground"
                              onClick={e => e.stopPropagation()}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Link>
                            <button className="h-7 w-7 rounded-[6px] hover:bg-muted flex items-center justify-center text-muted-foreground">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Card view */}
      {view === "card" && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(doc => {
            const canRetry = doc.status === "failed" || doc.status === "pending"
            const CardWrapper = canRetry ? "div" : Link as any
            const wrapperProps = canRetry
              ? {}
              : { href: `/documents/${doc.id}/review` }

            return (
              <CardWrapper
                key={doc.id}
                {...wrapperProps}
                className={cn(
                  "bg-card border rounded-[12px] p-4 transition block",
                  canRetry
                    ? "border-rose-200 dark:border-rose-500/30"
                    : "border-border cursor-pointer hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600"
                )}
              >
                <div className={cn(
                  "aspect-[4/3] rounded-[10px] bg-muted flex items-center justify-center text-5xl mb-3 relative",
                  canRetry && "opacity-50"
                )}>
                  {getThumb(doc.vendor_name)}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-foreground truncate">
                      {doc.vendor_name ?? "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {doc.doc_number ?? doc.id.slice(0, 8)}
                    </div>
                  </div>
                  <StatusBadge status={doc.status} />
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-end justify-between">
                  <div>
                    <div className="text-[16px] font-bold text-foreground tabular-nums">
                      {doc.total_amount != null ? formatThb(doc.total_amount) : "—"}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground tabular-nums">
                      VAT {doc.vat_amount != null ? formatThb(doc.vat_amount) : "—"}
                    </div>
                  </div>
                  <div className="text-right text-[10.5px] text-muted-foreground">
                    <div>{doc.doc_date ? formatDate(doc.doc_date) : "—"}</div>
                    <div className="mt-1"><SourceIcon source={doc.source} /></div>
                  </div>
                </div>
                {canRetry && (
                  <div className="mt-3 pt-3 border-t border-rose-100 dark:border-rose-500/20 flex gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleRetry(doc.id) }}
                      disabled={!!acting[doc.id]}
                      className="flex-1 h-8 rounded-[8px] border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-brand-50 dark:hover:bg-brand-500/10 disabled:opacity-50 transition"
                    >
                      {acting[doc.id] === "retry"
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      Retry
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(doc.id) }}
                      disabled={!!acting[doc.id]}
                      className="h-8 w-8 rounded-[8px] border border-rose-200 dark:border-rose-500/30 text-rose-500 flex items-center justify-center hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50 transition"
                    >
                      {acting[doc.id] === "delete"
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </CardWrapper>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="bg-card border border-border rounded-[12px] p-16 text-center">
          <div className="inline-flex h-16 w-16 rounded-full bg-muted items-center justify-center mb-4">
            <Inbox className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">ไม่พบเอกสารตามเงื่อนไข</h3>
          <p className="text-sm text-muted-foreground mt-1">ลองเปลี่ยน Filter หรือคำค้นหา</p>
        </div>
      )}
    </div>
  )
}
