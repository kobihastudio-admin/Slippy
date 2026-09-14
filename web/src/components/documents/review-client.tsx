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
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAppLoading } from "@/lib/loading"
import { toast } from "sonner"
import { formatThb, formatDate } from "@/lib/utils"
import { readAmountShape, recalcTotals } from "@/lib/vat"
import {
  ChevronLeft, ZoomIn, ZoomOut, RotateCw, Download,
  AlertTriangle, Sparkles, Plus, X, Save, Check, Send,
  BadgeCheck, BadgeX, Info, AlertCircle, Maximize2,
  Building2, FileText, ShoppingBag, Receipt,
  CalendarDays, Hash, Phone, MapPin, Tag, Loader2,
  Bug, ChevronDown, ChevronRight as ChevronRightIcon, Copy,
  ExternalLink, UserCheck, UserPlus, Copy as CopyIcon, RefreshCw, Trash2,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
interface LineItem {
  description: string
  quantity:    number
  unit_price:  number
  amount:      number
}

interface DuplicateOriginal {
  id:           string
  vendor_name:  string | null
  doc_date:     string | null
  total_amount: number | null
  doc_number:   string | null
}

interface ReviewClientProps {
  doc:               any
  fileUrl:           string
  integrations:      { id: string; provider: string }[]
  userRole:          string
  duplicateOriginal: DuplicateOriginal | null
}

type DocCategory =
  | "tax_invoice_full" | "tax_invoice_simplified" | "receipt_with_tax"
  | "receipt" | "consumer_receipt" | "invoice" | "credit_note" | "other"

// ─── Format config per document category ─────────────────────────────────────
interface FormatConfig {
  docNumberLabel:      string
  vendorSectionLabel:  string
  showVendorTaxId:     boolean
  showVendorAddress:   boolean
  showVendorPhone:     boolean
  showDueDate:         boolean
  showPlatformBanner:  boolean
  lineItemsStyle:      "table" | "simple" | "none"
  showSubtotalLine:    boolean
  showDiscountLine:    boolean
  showDeliveryLine:    boolean
  showVatLine:         boolean
  showWhtLine:         boolean
  totalLabel:          string
}

const FORMAT: Record<DocCategory, FormatConfig> = {
  tax_invoice_full: {
    docNumberLabel:     "เลขที่ใบกำกับภาษี",
    vendorSectionLabel: "ข้อมูลผู้ขาย",
    showVendorTaxId:    true,
    showVendorAddress:  true,
    showVendorPhone:    true,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "table",
    showSubtotalLine:   true,
    showDiscountLine:   true,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        true,
    totalLabel:         "ยอดรวมสุทธิ",
  },
  receipt_with_tax: {
    docNumberLabel:     "เลขที่ใบเสร็จ / ใบกำกับ",
    vendorSectionLabel: "ข้อมูลร้านค้า",
    showVendorTaxId:    true,
    showVendorAddress:  true,
    showVendorPhone:    true,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "table",
    showSubtotalLine:   true,
    showDiscountLine:   true,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        true,
    totalLabel:         "ยอดรวมสุทธิ",
  },
  tax_invoice_simplified: {
    docNumberLabel:     "เลขที่ใบเสร็จ",
    vendorSectionLabel: "ข้อมูลร้านค้า",
    showVendorTaxId:    true,
    showVendorAddress:  false,
    showVendorPhone:    true,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "table",
    showSubtotalLine:   false,
    showDiscountLine:   true,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        false,
    totalLabel:         "ยอดรวม (รวม VAT)",
  },
  consumer_receipt: {
    docNumberLabel:     "หมายเลขคำสั่งซื้อ",
    vendorSectionLabel: "แพลตฟอร์ม / ร้านค้า",
    showVendorTaxId:    false,
    showVendorAddress:  false,
    showVendorPhone:    false,
    showDueDate:        false,
    showPlatformBanner: true,
    lineItemsStyle:     "simple",
    showSubtotalLine:   true,
    showDiscountLine:   true,
    showDeliveryLine:   true,
    showVatLine:        false,
    showWhtLine:        false,
    totalLabel:         "ยอดที่ชำระ",
  },
  receipt: {
    docNumberLabel:     "เลขที่ใบเสร็จ",
    vendorSectionLabel: "ข้อมูลร้านค้า",
    showVendorTaxId:    false,
    showVendorAddress:  false,
    showVendorPhone:    true,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "simple",
    showSubtotalLine:   false,
    showDiscountLine:   true,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        false,
    totalLabel:         "ยอดรวม",
  },
  invoice: {
    docNumberLabel:     "เลขที่ใบแจ้งหนี้",
    vendorSectionLabel: "ข้อมูลผู้ออกเอกสาร",
    showVendorTaxId:    true,
    showVendorAddress:  true,
    showVendorPhone:    true,
    showDueDate:        true,
    showPlatformBanner: false,
    lineItemsStyle:     "table",
    showSubtotalLine:   true,
    showDiscountLine:   true,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        true,
    totalLabel:         "ยอดรวมสุทธิ",
  },
  credit_note: {
    docNumberLabel:     "เลขที่ใบลดหนี้",
    vendorSectionLabel: "ข้อมูลผู้ออกเอกสาร",
    showVendorTaxId:    true,
    showVendorAddress:  false,
    showVendorPhone:    false,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "table",
    showSubtotalLine:   true,
    showDiscountLine:   false,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        false,
    totalLabel:         "ยอดลดหนี้สุทธิ",
  },
  other: {
    docNumberLabel:     "เลขที่เอกสาร",
    vendorSectionLabel: "ข้อมูลผู้ขาย / ผู้ให้บริการ",
    showVendorTaxId:    true,
    showVendorAddress:  false,
    showVendorPhone:    false,
    showDueDate:        false,
    showPlatformBanner: false,
    lineItemsStyle:     "simple",
    showSubtotalLine:   false,
    showDiscountLine:   false,
    showDeliveryLine:   false,
    showVatLine:        true,
    showWhtLine:        false,
    totalLabel:         "ยอดรวม",
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const THUMB_MAP: [string, string][] = [
  ["grab", "🚖"], ["aws", "☁️"], ["amazon", "☁️"], ["google", "☁️"],
  ["microsoft", "☁️"], ["azure", "☁️"], ["7-eleven", "🧾"], ["7eleven", "🧾"],
  ["starbucks", "☕"], ["makro", "🛒"], ["lotus", "🛒"], ["big c", "🛒"],
  ["shell", "⛽"], ["ptt", "⛽"], ["bangchak", "⛽"], ["esso", "⛽"],
  ["ais", "📶"], ["true", "📶"], ["dtac", "📶"],
  ["figma", "🎨"], ["slack", "🎨"], ["notion", "🎨"],
  ["mea", "💡"], ["pea", "💡"], ["mwa", "💧"],
  ["line man", "🛵"], ["lineman", "🛵"], ["robinhood", "🛵"], ["foodpanda", "🛵"],
  ["shopee", "🛍️"], ["lazada", "🛍️"],
]
function getThumb(name: string): string {
  const lower = (name ?? "").toLowerCase()
  for (const [key, emoji] of THUMB_MAP) if (lower.includes(key)) return emoji
  return "🧾"
}

const PROVIDER_LABEL: Record<string, string> = {
  flowaccount: "FlowAccount",
  peak:        "PEAK",
  express:     "Express",
  webhook:     "Webhook",
}

// ─── Lightbox with zoom + pan ─────────────────────────────────────────────────
function Lightbox({ src, isPdf, initialRot = 0, onClose }: { src: string; isPdf: boolean; initialRot?: number; onClose: () => void }) {
  const [scale,   setScale]   = useState(1)
  const [offset,  setOffset]  = useState({ x: 0, y: 0 })
  const [lbRot,   setLbRot]   = useState(initialRot)   // rotation inside lightbox
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const lastPinch = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset zoom
  const resetZoom = () => { setScale(1); setOffset({ x: 0, y: 0 }) }

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "0" && e.metaKey) { e.preventDefault(); resetZoom() }
      if (e.key === "+" || e.key === "=") setScale(s => Math.min(8, +(s + 0.25).toFixed(2)))
      if (e.key === "-") setScale(s => { const n = Math.max(1, +(s - 0.25).toFixed(2)); if (n === 1) setOffset({ x: 0, y: 0 }); return n })
      if (e.key === "r") setLbRot(r => (r + 90) % 360)
      if (e.key === "R") setLbRot(r => (r - 90 + 360) % 360)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Mouse wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.ctrlKey ? e.deltaY * 0.01 : e.deltaY * 0.002
    setScale(s => {
      const next = Math.max(1, Math.min(8, +(s - delta).toFixed(2)))
      if (next === 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }

  // Mouse drag to pan
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart.current) return
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    })
  }
  const onMouseUp = () => { setIsDragging(false); dragStart.current = null }

  // Touch pinch-to-zoom
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinch.current = Math.hypot(dx, dy)
    } else if (e.touches.length === 1 && scale > 1) {
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: offset.x, oy: offset.y }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 2 && lastPinch.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const ratio = dist / lastPinch.current
      setScale(s => Math.max(1, Math.min(8, +(s * ratio).toFixed(2))))
      lastPinch.current = dist
    } else if (e.touches.length === 1 && dragStart.current) {
      setOffset({
        x: dragStart.current.ox + (e.touches[0].clientX - dragStart.current.x),
        y: dragStart.current.oy + (e.touches[0].clientY - dragStart.current.y),
      })
    }
  }
  const onTouchEnd = () => { lastPinch.current = null; dragStart.current = null }

  const isZoomed = scale > 1

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
      onClick={!isZoomed ? onClose : undefined}
    >
      {/* Close button */}
      <button type="button" onClick={onClose}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20
          text-white flex items-center justify-center transition-colors z-10">
        <X className="w-5 h-5" />
      </button>

      {/* Zoom controls */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
        <div className="flex items-center gap-1 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur-sm">
          <button type="button" onClick={() => setScale(s => { const n = Math.max(1, +(s - 0.25).toFixed(2)); if (n===1) setOffset({x:0,y:0}); return n })}
            className="h-6 w-6 rounded-full hover:bg-white/20 text-white flex items-center justify-center text-lg leading-none transition">
            −
          </button>
          <button type="button" onClick={resetZoom}
            className="px-2 text-xs text-white/80 tabular-nums min-w-[44px] text-center hover:text-white transition">
            {Math.round(scale * 100)}%
          </button>
          <button type="button" onClick={() => setScale(s => Math.min(8, +(s + 0.25).toFixed(2)))}
            className="h-6 w-6 rounded-full hover:bg-white/20 text-white flex items-center justify-center text-lg leading-none transition">
            +
          </button>
        </div>
        {isZoomed && (
          <button type="button" onClick={resetZoom}
            className="bg-black/50 rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white backdrop-blur-sm transition">
            รีเซ็ต
          </button>
        )}
        {/* Rotate buttons */}
        <div className="flex items-center gap-1 bg-black/50 rounded-full px-2 py-1 backdrop-blur-sm">
          <button type="button" onClick={() => setLbRot(r => (r - 90 + 360) % 360)}
            className="h-6 w-6 rounded-full hover:bg-white/20 text-white flex items-center justify-center transition"
            title="หมุนซ้าย (R)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
          </button>
          <span className="text-[10px] text-white/50 tabular-nums min-w-[28px] text-center">{lbRot}°</span>
          <button type="button" onClick={() => setLbRot(r => (r + 90) % 360)}
            className="h-6 w-6 rounded-full hover:bg-white/20 text-white flex items-center justify-center transition"
            title="หมุนขวา (r)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ cursor: isZoomed ? (isDragging ? "grabbing" : "grab") : "zoom-in" }}
        onClick={e => { if (isZoomed) e.stopPropagation(); else if (!isZoomed) { setScale(2); e.stopPropagation() } }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {isPdf ? (
          <iframe
            src={src}
            title="เอกสารต้นฉบับ"
            className="rounded-xl shadow-2xl bg-white"
            style={{ width: "min(900px, 95vw)", height: "92vh" }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <img
            src={src}
            alt="เอกสารต้นฉบับ"
            draggable={false}
            className="select-none rounded-lg shadow-2xl"
            style={{
              maxWidth:  lbRot % 180 === 0 ? "95vw" : "92vh",
              maxHeight: lbRot % 180 === 0 ? "92vh" : "95vw",
              objectFit: "contain",
              transform: `rotate(${lbRot}deg) scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
              transition: isDragging ? "none" : "transform 0.2s ease",
              transformOrigin: "center center",
            }}
          />
        )}
      </div>

      {/* Hint */}
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/30 select-none whitespace-nowrap">
        {isZoomed ? "ลากเพื่อเลื่อน · Scroll เพื่อ zoom · Esc ปิด" : "Scroll หรือคลิกเพื่อ zoom · Esc ปิด"}
      </p>
    </div>
  )
}

// ─── Processing stages labels ─────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  preprocessing: "กำลังดาวน์โหลดและแปลงไฟล์...",
  extracting:    "AI กำลังอ่านและวิเคราะห์เอกสาร...",
  validating:    "กำลังตรวจสอบความถูกต้อง...",
  saving:        "กำลังบันทึกข้อมูล...",
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ReviewClient({ doc, fileUrl, integrations, userRole, duplicateOriginal }: ReviewClientProps) {
  const router        = useRouter()
  const supabase      = createClient()
  const { withLoading } = useAppLoading()
  const canEdit  = ["owner", "admin", "accountant"].includes(userRole)

  // ── Processing state tracking ─────────────────────────────────────────────────
  const isProcessing = doc.status === "processing" || doc.status === "pending"
  const [procStage,   setProcStage]   = useState<string>(doc.processing_stage ?? "")
  const [procPct,     setProcPct]     = useState<number>(Number(doc.processing_percent ?? 0))
  const [pollFailed,  setPollFailed]  = useState(false)

  // ── Auto-refresh while pipeline is running ────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) return

    let attempts = 0
    const MAX_ATTEMPTS = 60  // 3 min timeout at 3s interval

    const interval = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval)
        setPollFailed(true)
        return
      }

      const { data } = await supabase
        .from("documents")
        .select("status, processing_stage, processing_percent")
        .eq("id", doc.id)
        .single()

      if (!data) return

      // Update progress indicators
      if (data.processing_stage)   setProcStage(data.processing_stage)
      if (data.processing_percent) setProcPct(Number(data.processing_percent))

      // Terminal statuses → refresh the whole page to get real data
      if (["reviewing", "approved", "failed", "rejected"].includes(data.status)) {
        clearInterval(interval)
        router.refresh()
      }
    }, 3000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Viewer state ─────────────────────────────────────────────────────────────
  const [zoom,      setZoom]      = useState(1)
  const initialRot                = (doc.display_rotation as number | undefined) ?? 0
  const [rot,       setRot]       = useState(initialRot)
  const [savedRot,  setSavedRot]  = useState(initialRot)
  const [savingRot, setSavingRot] = useState(false)
  const [lightbox,  setLightbox]  = useState(false)

  // ── Refs for pinch-to-zoom (non-passive touchmove needed) ────────────────────
  const viewerRef = useRef<HTMLDivElement>(null)
  const pinchRef  = useRef<{ dist: number; zoom: number } | null>(null)
  const zoomRef   = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  useEffect(() => {
    const el = viewerRef.current
    if (!el) return

    const getD = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]]
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2)
        pinchRef.current = { dist: getD(e), zoom: zoomRef.current }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return
      e.preventDefault()                      // block page scroll while pinching
      const scale = getD(e) / pinchRef.current.dist
      setZoom(+(Math.min(3, Math.max(0.3, pinchRef.current.zoom * scale)).toFixed(2)))
    }
    const onEnd = () => { pinchRef.current = null }

    el.addEventListener("touchstart", onStart, { passive: true })
    el.addEventListener("touchmove",  onMove,  { passive: false })  // must be non-passive
    el.addEventListener("touchend",   onEnd)
    return () => {
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchmove",  onMove)
      el.removeEventListener("touchend",   onEnd)
    }
  }, [])   // empty deps — reads zoom via ref

  // ── Save rotation to DB ───────────────────────────────────────────────────────
  const handleSaveRotation = async () => {
    setSavingRot(true)
    const { error } = await supabase
      .from("documents")
      .update({ display_rotation: rot })
      .eq("id", doc.id)
    if (error) {
      // Column may not exist yet — show migration hint
      toast.error("บันทึกไม่สำเร็จ: " + (error.message.includes("column") ? "กรุณา apply migration 023 ก่อน" : error.message))
    } else {
      setSavedRot(rot)
      toast.success("บันทึกการหมุนแล้ว ✓")
    }
    setSavingRot(false)
  }

  // ── Raw AI response — declared before form/items so initializers can fall back ─
  const rawAI = useMemo(() => {
    try {
      const r = doc.ai_raw_response
      return typeof r === "string" ? JSON.parse(r) : (r ?? null)
    } catch { return null }
  }, [doc.ai_raw_response])

  // ── Form state — DB columns preferred; rawAI used as fallback ─────────────────
  const [form, setFormRaw] = useState(() => ({
    vendor_name:     doc.vendor_name    ?? rawAI?.vendor_name    ?? "",
    vendor_tax_id:   doc.vendor_tax_id  ?? rawAI?.vendor_tax_id  ?? "",
    vendor_address:  doc.vendor_address ?? rawAI?.vendor_address ?? "",
    vendor_phone:    doc.vendor_phone   ?? rawAI?.vendor_phone   ?? "",
    doc_date:       (doc.doc_date ?? rawAI?.doc_date)?.slice(0, 10) ?? "",
    due_date:       (doc.due_date ?? rawAI?.due_date)?.slice(0, 10) ?? "",
    doc_number:      doc.doc_number     ?? rawAI?.doc_number     ?? "",
    subtotal:        Number(doc.subtotal        ?? rawAI?.subtotal        ?? 0),
    discount_amount: Number(doc.discount_amount ?? rawAI?.discount_amount ?? 0),
    delivery_fee:    Number(doc.delivery_fee    ?? rawAI?.delivery_fee    ?? 0),
    vat_amount:      Number(doc.vat_amount      ?? rawAI?.vat_amount      ?? 0),
    wht_amount:      Number(doc.wht_amount      ?? rawAI?.wht_amount      ?? 0),
    total_amount:    Number(doc.total_amount    ?? rawAI?.total_amount    ?? 0),
    notes:           doc.notes          ?? "",      // AI reasoning log — read-only
    review_note:     doc.review_note    ?? "",      // user editable note
    integration_id:  integrations[0]?.id ?? "",
  }))
  // setForm wrapper — marks dirty whenever form changes
  const setForm = useCallback((fn: (f: any) => any) => {
    setFormRaw(fn)
    setIsDirty(true)
  }, [])

  // ── Line items — DB preferred; rawAI fallback if DB has none ─────────────────
  const [items, setItems] = useState<LineItem[]>(() => {
    const dbItems: any[] = doc.document_line_items ?? []
    if (dbItems.length) {
      return dbItems
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(it => ({
          description: it.description ?? "",
          quantity:    Number(it.quantity   ?? 1),
          unit_price:  Number(it.unit_price ?? 0),
          amount:      Number(it.amount     ?? 0),
        }))
    }
    return (rawAI?.line_items ?? []).map((it: any) => ({
      description: it.description ?? "",
      quantity:    Number(it.quantity   ?? 1),
      unit_price:  Number(it.unit_price ?? 0),
      amount:      Number(it.amount     ?? 0),
    }))
  })

  /**
   * How this receipt states its money — read once, from the document as it
   * loaded, and never re-derived. See lib/vat.ts: deriving it again after an
   * edit reads the convention off figures this screen just wrote, which is what
   * turned a correctly-read ฿856 Jones Salad bill into ฿915.92.
   */
  const amountShape = useRef(
    readAmountShape(
      {
        subtotal:        Number(doc.subtotal        ?? rawAI?.subtotal        ?? 0),
        vat_amount:      Number(doc.vat_amount      ?? rawAI?.vat_amount      ?? 0),
        total_amount:    Number(doc.total_amount    ?? rawAI?.total_amount    ?? 0),
        discount_amount: Number(doc.discount_amount ?? rawAI?.discount_amount ?? 0),
        delivery_fee:    Number(doc.delivery_fee    ?? rawAI?.delivery_fee    ?? 0),
        wht_amount:      Number(doc.wht_amount      ?? rawAI?.wht_amount      ?? 0),
      },
      items.reduce((s, it) => s + (it.amount ?? 0), 0),
    ),
  ).current

  const [saving,  setSaving]  = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [debug,   setDebug]   = useState(false)

  // ── Human Learning: บันทึก corrections เปรียบเทียบ AI vs user ──────────────────
  const saveCorrections = useCallback(async () => {
    try {
      // ค่าที่ AI อ่านได้ครั้งแรก (จาก ai_raw_response หรือ initial DB values)
      const ai = rawAI ?? {}
      const corrections = [
        { field: "vendor_name",    aiValue: ai.vendor_name    ?? doc.vendor_name,    correctedValue: form.vendor_name    },
        { field: "vendor_tax_id",  aiValue: ai.vendor_tax_id  ?? doc.vendor_tax_id,  correctedValue: form.vendor_tax_id  },
        { field: "doc_number",     aiValue: ai.doc_number     ?? doc.doc_number,     correctedValue: form.doc_number     },
        { field: "doc_date",       aiValue: ai.doc_date       ?? doc.doc_date,       correctedValue: form.doc_date       },
        { field: "total_amount",   aiValue: String(ai.total_amount   ?? doc.total_amount   ?? ""), correctedValue: String(form.total_amount)   },
        { field: "subtotal",       aiValue: String(ai.subtotal       ?? doc.subtotal       ?? ""), correctedValue: String(form.subtotal)       },
        { field: "vat_amount",     aiValue: String(ai.vat_amount     ?? doc.vat_amount     ?? ""), correctedValue: String(form.vat_amount)     },
        { field: "discount_amount",aiValue: String(ai.discount_amount ?? doc.discount_amount ?? ""), correctedValue: String(form.discount_amount) },
      ].map(c => ({
        ...c,
        aiValue:         c.aiValue        != null ? String(c.aiValue)        : null,
        correctedValue:  c.correctedValue != null ? String(c.correctedValue) : null,
      }))

      // Line-item descriptions — compare AI's original reading (rawAI.line_items)
      // against what the user edited (items), index-by-index. Catches misread
      // Thai menu names on thermal receipts (e.g. "ตับบำรุง" → "ต้มยำกุ้ง").
      const aiLineItems: any[] = ai.line_items ?? []
      const lineItemCorrections = items
        .map((it, i) => ({
          field:          "line_items.description",
          aiValue:        aiLineItems[i]?.description ?? null,
          correctedValue: it.description,
        }))
        .filter(c => c.aiValue && c.correctedValue && c.aiValue !== c.correctedValue)

      corrections.push(...lineItemCorrections)

      // fire-and-forget — ไม่บล็อก save
      fetch(`/api/documents/${doc.id}/corrections`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corrections,
          vendorName:      form.vendor_name      || null,
          docCategory:     doc.doc_category      || null,
          confidenceScore: doc.overall_confidence ?? null,
        }),
      }).catch(() => {/* silent */})
    } catch { /* never block */ }
  }, [doc, form, rawAI])

  // ── Doc meta ──────────────────────────────────────────────────────────────────
  const conf      = Number(doc.overall_confidence ?? 0)
  const confPct   = Math.round(conf * 100)
  const confTone  = conf >= 0.9 ? "emerald" : conf >= 0.7 ? "amber" : "rose"
  const confLabel = conf >= 0.9 ? "แม่นยำสูง" : conf >= 0.7 ? "ตรวจสอบก่อน" : "ความถูกต้องต่ำ"

  const isFailed  = doc.status === "failed"
  const isPdf     = doc.file_type === "pdf"
  const thumb     = getThumb(form.vendor_name || doc.vendor_name || "")

  // DocCategory — DB column preferred, fall back to rawAI (handles pre-migration state)
  const docCategory = (doc.doc_category ?? rawAI?.doc_category ?? "other") as DocCategory
  const fmt         = FORMAT[docCategory] ?? FORMAT.other

  // Classification flags — DB preferred, fall back to rawAI
  const vatClaimable     = doc.vat_claimable     ?? rawAI?.vat_claimable     ?? false
  const expenseClaimable = (doc.expense_claimable ?? rawAI?.expense_claimable) !== false
  const businessUseNote  = doc.business_use_note || rawAI?.business_use_note || ""
  const platformRef      = doc.platform_ref      || rawAI?.platform_ref      || null
  const customerName     = doc.customer_name     || rawAI?.customer_name     || null
  const staffName        = doc.staff_name        || rawAI?.staff_name        || null

  // platform_name is editable — add to form state
  const [platformName, setPlatformName] = useState<string>(
    doc.platform_name || rawAI?.platform_name || ""
  )

  const isFullTaxInvoice = docCategory === "tax_invoice_full" || docCategory === "receipt_with_tax"
  const isConsumer       = docCategory === "consumer_receipt"

  // ── Extraction issues ─────────────────────────────────────────────────────────
  const extractionIssues: string[] = useMemo(() => {
    try {
      const raw = typeof doc.ai_raw_response === "string"
        ? JSON.parse(doc.ai_raw_response)
        : (doc.ai_raw_response ?? {})
      return Array.isArray(raw.extraction_issues) ? raw.extraction_issues : []
    } catch { return [] }
  }, [doc.ai_raw_response])

  const failedReasons = extractionIssues.length > 0
    ? extractionIssues
    : doc.notes ? [doc.notes] : ["ไม่สามารถอ่านข้อมูลจากเอกสารนี้ได้"]

  // ── Validation warnings ───────────────────────────────────────────────────────
  const warnings = useMemo(() => {
    const w: { tone: string; text: string }[] = []
    if (!isConsumer && form.vat_amount > 0) {
      const expectedVat = +(form.subtotal * 0.07).toFixed(2)
      if (Math.abs(expectedVat - form.vat_amount) > 0.5)
        w.push({ tone: "amber", text: `VAT คำนวณไม่ตรง (คาด ${formatThb(expectedVat)})` })
    }
    if (form.doc_date && new Date(form.doc_date) > new Date())
      w.push({ tone: "rose", text: "วันที่ในเอกสารเป็นอนาคต" })
    if (isFullTaxInvoice && (!form.doc_number || form.doc_number === "-"))
      w.push({ tone: "amber", text: "ไม่พบเลขที่ใบกำกับภาษี — กรุณาตรวจสอบและกรอกเพิ่มเติม" })
    return w
  }, [form, isFullTaxInvoice, isConsumer])

  // ── Actions ───────────────────────────────────────────────────────────────────

  /** Send LINE notification — logs errors visibly instead of silently swallowing */
  const notifyLine = async (action: string) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/notify-line`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.error(`[notify-line] ${action} failed:`, body?.error ?? res.status)
      }
    } catch (e) {
      console.error(`[notify-line] ${action} network error:`, e)
    }
  }

  const collectLineItemPayload = () =>
    items.map((it, i) => ({
      document_id:  doc.id,
      description:  it.description,
      quantity:     it.quantity,
      unit_price:   it.unit_price,
      amount:       it.amount,
      sort_order:   i,
    }))

  const handleSaveDraft = async () => {
    setSaving(true)
    saveCorrections()   // fire-and-forget: บันทึก human corrections สำหรับ AI learning
    try {
      await supabase.from("documents").update({
        vendor_name:     form.vendor_name,
        vendor_tax_id:   form.vendor_tax_id   || null,
        vendor_address:  form.vendor_address  || null,
        vendor_phone:    form.vendor_phone    || null,
        platform_name:   platformName         || null,
        doc_date:        form.doc_date        || null,
        due_date:        form.due_date        || null,
        doc_number:      form.doc_number      || null,
        subtotal:        form.subtotal,
        discount_amount: form.discount_amount,
        delivery_fee:    form.delivery_fee,
        vat_amount:      form.vat_amount,
        wht_amount:      form.wht_amount,
        total_amount:    form.total_amount,
        notes:           form.notes           || null,
        review_note:     form.review_note     || null,
        updated_at:      new Date().toISOString(),
      }).eq("id", doc.id)

      await supabase.from("document_line_items").delete().eq("document_id", doc.id)
      if (items.length) await supabase.from("document_line_items").insert(collectLineItemPayload())
      // Notify LINE
      await notifyLine("draft_saved")
      setIsDirty(false)
      toast.success("บันทึกการเปลี่ยนแปลงเรียบร้อย ✓")
    } catch {
      toast.error("บันทึกไม่สำเร็จ กรุณาลองใหม่")
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (andPush: boolean) => {
    setSaving(true)
    saveCorrections()   // fire-and-forget: บันทึก human corrections สำหรับ AI learning
    await withLoading(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from("documents").update({
        vendor_name:     form.vendor_name,
        vendor_tax_id:   form.vendor_tax_id   || null,
        vendor_address:  form.vendor_address  || null,
        vendor_phone:    form.vendor_phone    || null,
        platform_name:   platformName         || null,
        doc_date:        form.doc_date        || null,
        due_date:        form.due_date        || null,
        doc_number:      form.doc_number      || null,
        subtotal:        form.subtotal,
        discount_amount: form.discount_amount,
        delivery_fee:    form.delivery_fee,
        vat_amount:      form.vat_amount,
        wht_amount:      form.wht_amount,
        total_amount:    form.total_amount,
        notes:           form.notes           || null,
        review_note:     form.review_note     || null,
        status:          "approved",
        reviewed_by:     user!.id,
        reviewed_at:     new Date().toISOString(),
      }).eq("id", doc.id)

      await supabase.from("document_line_items").delete().eq("document_id", doc.id)
      if (items.length) await supabase.from("document_line_items").insert(collectLineItemPayload())

      if (andPush && form.integration_id) {
        await fetch(`/api/documents/${doc.id}/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ integrationId: form.integration_id }),
        })
        toast.success(`ส่งเข้า ${PROVIDER_LABEL[integrations.find(i => i.id === form.integration_id)?.provider ?? ""] ?? "ระบบบัญชี"} แล้ว`)
      } else {
        toast.success("อนุมัติเรียบร้อย")
      }

      // Trigger Life Graph population (fire-and-forget)
      // Core principle (CLAUDE.md): every approved document enriches the Life Graph
      fetch(`/api/life/populate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ documentId: doc.id }),
      }).catch(() => {})

      // Await notify BEFORE navigation — router.push() cancels pending fetches
      await notifyLine(andPush ? "approved_pushed" : "approved")

      router.push("/documents")
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่")
      setSaving(false)
    }
    }, andPush ? "กำลังส่งเข้าระบบบัญชี..." : "กำลังอนุมัติเอกสาร...")
  }

  const handleReject = async () => {
    setSaving(true)
    await withLoading(async () => {
      await supabase.from("documents").update({ status: "rejected" }).eq("id", doc.id)
      // Await notify BEFORE navigation — router.push() cancels pending fetches
      await notifyLine("rejected")
      toast.error("ปฏิเสธเอกสารแล้ว")
      router.push("/documents")
    }, "กำลังปฏิเสธเอกสาร...")
  }

  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      // Notify LINE first (before refresh which may cancel the fetch)
      await notifyLine("retrying")
      const res = await fetch(`/api/documents/${doc.id}/process`, { method: "POST" })
      if (!res.ok) throw new Error("Process API error")
      router.refresh()
    } catch {
      toast.error("ลองอีกครั้งไม่สำเร็จ กรุณาลองใหม่")
      setRetrying(false)
    }
  }

  const handleDeleteDoc = async () => {
    if (!confirm("ลบเอกสารนี้ออกจากระบบ?")) return
    setDeleting(true)
    try {
      // Notify LINE before delete (document still exists at this point)
      await notifyLine("deleted")
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("ลบเอกสารแล้ว")
      router.push("/documents")
    } catch {
      toast.error("ลบไม่สำเร็จ กรุณาลองใหม่")
      setDeleting(false)
    }
  }

  const updateItem = (i: number, key: keyof LineItem, val: string | number) => {
    const next = [...items]
    const updated = { ...next[i], [key]: key === "description" ? val : Number(val) }

    // Auto-recalculate amount = quantity × unit_price when either changes
    if (key === "quantity" || key === "unit_price") {
      updated.amount = +(updated.quantity * updated.unit_price).toFixed(2)
    }
    next[i] = updated
    setItems(next)
    setIsDirty(true)

    // Sync totals back to form (subtotal = sum of amounts, recalc VAT + total).
    // recalcTotals keeps the receipt's own VAT convention — see lib/vat.ts.
    const newItemSum = +next.reduce((s, it) => s + (it.amount ?? 0), 0).toFixed(2)
    setFormRaw((f: any) => ({ ...f, ...recalcTotals(f, newItemSum, amountShape) }))
  }

  // ── Remove item — recalculate totals ─────────────────────────────────────────
  const removeItem = (i: number) => {
    setItems((prev: LineItem[]) => {
      const next = prev.filter((_, j) => j !== i)
      const newItemSum = +next.reduce((s, it) => s + (it.amount ?? 0), 0).toFixed(2)
      setFormRaw((f: any) => ({ ...f, ...recalcTotals(f, newItemSum, amountShape) }))
      setIsDirty(true)
      return next
    })
  }

  // ── Status badge ──────────────────────────────────────────────────────────────
  const statusMeta = {
    approved:  { label: "อนุมัติแล้ว",       cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300", dot: "bg-emerald-500" },
    rejected:  { label: "ปฏิเสธแล้ว",        cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",             dot: "bg-rose-500"    },
    failed:    { label: "อ่านไม่ได้",         cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",             dot: "bg-rose-500"    },
    pushed:    { label: "ส่งแล้ว",            cls: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",         dot: "bg-brand-500"   },
    reviewing: { label: "รอตรวจสอบ",         cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",         dot: "bg-amber-500"   },
    processing:{ label: "กำลังประมวลผล",     cls: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",                 dot: "bg-sky-500"     },
  }
  const sm = statusMeta[doc.status as keyof typeof statusMeta] ?? statusMeta.reviewing

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Processing overlay — shown while pipeline is running ─────────────────────
  if (isProcessing && !pollFailed) {
    return (
      <div className="flex flex-col h-[calc(100vh-57px)]">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 lg:px-7 py-3 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="h-9 px-3 rounded-[8px] hover:bg-muted text-sm font-medium
              inline-flex items-center gap-1.5 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> กลับ
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-[8px] bg-muted text-lg flex items-center justify-center shrink-0">
              {getThumb(doc.vendor_name ?? "")}
            </span>
            <div>
              <p className="text-sm font-semibold">{doc.vendor_name || "เอกสาร"}</p>
              <p className="text-[11px] text-muted-foreground">กำลังประมวลผล...</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium
              bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
              กำลังประมวลผล
            </span>
            <button
              type="button"
              onClick={() => setDebug(d => !d)}
              title="ดูข้อมูล AI Debug"
              className={`h-8 w-8 rounded-[8px] flex items-center justify-center transition-colors shrink-0 ${
                debug
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bug className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Processing body — DebugPanel or spinner */}
        {debug ? (
          <div className="flex-1 overflow-y-auto">
            <DebugPanel doc={doc} rawAI={rawAI} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/20">
            <div className="w-full max-w-sm mx-auto px-6 text-center space-y-6">
              {/* Spinner */}
              <div className="relative mx-auto w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-border" />
                <div className="absolute inset-0 rounded-full border-4 border-t-brand-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-brand-500" />
                </div>
              </div>

              {/* Stage label */}
              <div>
                <p className="text-base font-semibold text-foreground mb-1">
                  {STAGE_LABEL[procStage] ?? "AI กำลังอ่านและวิเคราะห์เอกสาร..."}
                </p>
                <p className="text-sm text-muted-foreground">
                  กรุณารอสักครู่ ระบบจะโหลดข้อมูลให้อัตโนมัติ
                </p>
              </div>

              {/* Progress bar */}
              {procPct > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>ความคืบหน้า</span>
                    <span>{procPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all duration-500"
                      style={{ width: `${procPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Steps */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { key: "preprocessing", label: "ดาวน์โหลด" },
                  { key: "extracting",    label: "AI อ่าน" },
                  { key: "validating",    label: "ตรวจสอบ" },
                  { key: "saving",        label: "บันทึก" },
                ].map((step, i) => {
                  const stages  = ["preprocessing", "extracting", "validating", "saving"]
                  const curIdx  = stages.indexOf(procStage)
                  const stepIdx = stages.indexOf(step.key)
                  const isDone   = curIdx > stepIdx
                  const isActive = curIdx === stepIdx
                  return (
                    <div key={step.key} className="flex flex-col items-center gap-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                        isDone   ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" :
                        isActive ? "bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 animate-pulse" :
                                   "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight text-center">
                        {step.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* ── Lightbox overlay ──────────────────────────────────────────────────── */}
      {lightbox && (
        <Lightbox src={fileUrl} isPdf={isPdf} initialRot={rot} onClose={() => setLightbox(false)} />
      )}

      <div className="flex flex-col h-[calc(100vh-57px)]">

        {/* ── Sub-toolbar ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 lg:px-7 py-3 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
          <button
            type="button"
            onClick={() => router.push("/documents")}
            className="h-9 px-3 rounded-[8px] hover:bg-muted text-sm font-medium
              inline-flex items-center gap-1.5 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> กลับ
          </button>
          <div className="h-5 w-px bg-border" />

          {/* Doc identity — min-w-0 lets it shrink so right-side buttons stay visible */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="h-9 w-9 rounded-[8px] bg-muted text-lg flex items-center justify-center shrink-0">
              {thumb}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate leading-none">
                {doc.vendor_name || "เอกสาร"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {form.doc_date ? formatDate(form.doc_date) : "—"}
                {form.doc_number ? ` · ${form.doc_number}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <DocCategoryBadge category={docCategory} />
            <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${sm.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sm.dot}`} />
              {sm.label}
            </span>
            {conf > 0 && (
              <span className={`hidden lg:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                confTone === "emerald" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : confTone === "amber" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
              }`}>
                {confPct}% · {confLabel}
              </span>
            )}
            {/* Debug toggle — always visible, shrink-0 prevents it from being pushed off */}
            <button
              type="button"
              onClick={() => setDebug(d => !d)}
              title="ดูข้อมูล AI Debug"
              className={`h-8 w-8 rounded-[8px] flex items-center justify-center transition-colors shrink-0 ${
                debug
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bug className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────────── */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1.8fr] min-h-0">

          {/* ── Left: Document image/PDF ─────────────────────────────────────────── */}
          <div className="flex flex-col border-r border-border bg-muted/30 min-h-0">
            {/* Viewer toolbar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-card shrink-0">
              <button type="button" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(1)))}
                className={toolBtnCls} title="ย่อ">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setZoom(1)}
                className="h-7 px-2.5 rounded-[6px] text-xs font-medium text-muted-foreground
                  hover:bg-muted transition-colors tabular-nums min-w-[48px] text-center">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}
                className={toolBtnCls} title="ขยาย">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <div className="h-4 w-px bg-border mx-1" />

              {/* Rotate */}
              <button type="button" onClick={() => setRot(r => (r + 90) % 360)}
                className={toolBtnCls} title="หมุน 90°">
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              {/* Save rotation — แสดงเมื่อมีการเปลี่ยนแปลง */}
              {rot !== savedRot && (
                <button
                  type="button"
                  onClick={handleSaveRotation}
                  disabled={savingRot}
                  title="บันทึกการหมุน"
                  className="h-7 px-2 rounded-[6px] text-[11px] font-semibold
                    bg-brand-500 hover:bg-brand-600 text-white transition-colors
                    inline-flex items-center gap-1 disabled:opacity-60 shrink-0"
                >
                  {savingRot
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Save    className="w-3 h-3" />}
                  บันทึก
                </button>
              )}

              <button type="button" onClick={() => setLightbox(true)}
                className={toolBtnCls} title="ดูรูปต้นฉบับ">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1" />
              <a href={fileUrl} download target="_blank" rel="noreferrer"
                className={toolBtnCls} title="ดาวน์โหลดไฟล์">
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Preview area — ref รับ pinch-to-zoom events */}
            <div
              ref={viewerRef}
              className="flex-1 overflow-auto relative bg-muted/20"
              style={{ touchAction: "pan-x pan-y" }}
            >
              {isFailed ? (
                /* ── Beautiful error state — replaces broken image ─────────────── */
                <div className="h-full min-h-[400px] flex items-center justify-center p-8">
                  <div className="max-w-[360px] w-full text-center space-y-5">

                    {/* Icon ring */}
                    <div className="relative mx-auto w-24 h-24">
                      <div className="absolute inset-0 rounded-full bg-rose-100 dark:bg-rose-500/10" />
                      <div className="absolute inset-3 rounded-full bg-rose-200/60 dark:bg-rose-500/20" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <AlertCircle className="w-10 h-10 text-rose-500 dark:text-rose-400" />
                      </div>
                    </div>

                    {/* Title */}
                    <div>
                      <h3 className="text-[17px] font-bold text-foreground">อ่านเอกสารไม่สำเร็จ</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        AI ไม่สามารถวิเคราะห์เอกสารนี้ได้
                      </p>
                    </div>

                    {/* Error detail card */}
                    <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200
                      dark:border-rose-800/50 rounded-xl p-4 text-left space-y-1.5">
                      {failedReasons.map((r, i) => (
                        <p key={i} className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400">
                          <span className="shrink-0 mt-0.5 font-bold">•</span>
                          <span className="break-all">{r}</span>
                        </p>
                      ))}
                    </div>

                    {/* Tip */}
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200
                      dark:border-amber-800/40 rounded-xl px-4 py-3 text-left">
                      <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                        <span className="font-semibold">💡 วิธีแก้:</span>{" "}
                        ถ่ายรูปในที่มีแสงเพียงพอ วางเอกสารให้ตรง
                        ไม่มีสิ่งบดบัง แล้วกด &ldquo;ลองอีกครั้ง&rdquo;
                        หรืออัปโหลดไฟล์ใหม่
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleDeleteDoc}
                        disabled={deleting || retrying}
                        className="flex-1 h-11 rounded-[10px] border border-rose-200 dark:border-rose-500/30
                          bg-card text-sm font-medium text-rose-600 dark:text-rose-400
                          hover:bg-rose-50 dark:hover:bg-rose-500/10 transition
                          inline-flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {deleting
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2  className="w-4 h-4" />}
                        ลบเอกสาร
                      </button>
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={retrying || deleting}
                        className="flex-1 h-11 rounded-[10px] bg-brand-500 hover:bg-brand-600
                          text-white text-sm font-semibold shadow-sm shadow-brand-500/30 transition
                          inline-flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {retrying
                          ? <Loader2   className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                        {retrying ? "กำลังประมวลผล…" : "ลองอีกครั้ง"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Normal document preview ────────────────────────────────────── */
                <div className="flex justify-center items-center min-h-full p-6 overflow-auto">
                  {/* outer wrapper ขนาดแปรผันตาม rotation — swap w/h เมื่อ 90°/270° */}
                  <div
                    className="relative group flex items-center justify-center"
                    style={{
                      // เมื่อหมุน 90/270 → สลับ inline-size ให้ container พอดี
                      width:  (rot % 180 === 90) ? "auto" : undefined,
                      height: (rot % 180 === 90) ? "auto" : undefined,
                    }}
                  >
                    {/* Image with zoom+rotate — origin always center */}
                    <div
                      style={{
                        transform: `rotate(${rot}deg) scale(${zoom})`,
                        transformOrigin: "center center",
                        transition: "transform 0.2s ease",
                        display: "block",
                      }}
                      onClick={() => setLightbox(true)}
                      className="cursor-zoom-in"
                      title="คลิกเพื่อดูรูปต้นฉบับ"
                    >
                      {isPdf ? (
                        <iframe
                          src={fileUrl}
                          title="เอกสาร"
                          className="rounded-lg shadow-xl border border-border bg-white pointer-events-none"
                          style={{ width: 660, height: 900 }}
                        />
                      ) : (
                        <img
                          src={fileUrl}
                          alt="เอกสาร"
                          draggable={false}
                          className="max-w-[660px] w-full rounded-lg shadow-xl border border-border
                            hover:shadow-2xl transition-shadow duration-200"
                        />
                      )}
                    </div>

                    {/* Rotate overlay — appears on hover at center of image */}
                    <div className="absolute inset-0 flex items-center justify-center
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      pointer-events-none">
                      <div className="flex items-center gap-2 pointer-events-auto"
                        onClick={e => e.stopPropagation()}>
                        {/* Rotate CCW */}
                        <button
                          type="button"
                          onClick={() => setRot(r => (r - 90 + 360) % 360)}
                          className="h-10 w-10 rounded-full bg-black/60 hover:bg-black/80
                            text-white flex items-center justify-center backdrop-blur-sm
                            transition-all hover:scale-110 shadow-lg"
                          title="หมุนซ้าย 90°"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
                          </svg>
                        </button>

                        {/* Save button — only when rotation changed */}
                        {rot !== savedRot && (
                          <button
                            type="button"
                            onClick={handleSaveRotation}
                            disabled={savingRot}
                            className="h-9 px-3 rounded-full bg-brand-600 hover:bg-brand-700
                              text-white text-xs font-semibold flex items-center gap-1.5
                              backdrop-blur-sm transition-all shadow-lg disabled:opacity-60"
                            title="บันทึกการหมุน"
                          >
                            {savingRot ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                            บันทึก
                          </button>
                        )}

                        {/* Rotate CW */}
                        <button
                          type="button"
                          onClick={() => setRot(r => (r + 90) % 360)}
                          className="h-10 w-10 rounded-full bg-black/60 hover:bg-black/80
                            text-white flex items-center justify-center backdrop-blur-sm
                            transition-all hover:scale-110 shadow-lg"
                          title="หมุนขวา 90°"
                        >
                          <RotateCw className="w-4.5 h-4.5" />
                        </button>
                      </div>
                    </div>

                    {/* Rotation indicator badge */}
                    {rot !== 0 && (
                      <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px]
                        font-medium px-2 py-1 rounded-full backdrop-blur-sm pointer-events-none">
                        {rot}°
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Extracted data + actions ─────────────────────────────────── */}
          <div className="flex flex-col bg-background min-h-0">
            {/* Duplicate resolution banner — shown above everything when duplicate */}
            {doc.is_duplicate && duplicateOriginal && (
              <DuplicateResolutionBanner
                docId={doc.id}
                original={duplicateOriginal}
                onResolved={(action) => {
                  if (action === "replace") {
                    router.refresh()
                  } else {
                    router.push("/documents")
                  }
                }}
              />
            )}
            <div className="flex-1 overflow-y-auto">
              {debug ? (
                <DebugPanel doc={doc} rawAI={rawAI} />
              ) : (
                <DocDataPanel
                  doc={doc}
                  form={form}
                  setForm={setForm}
                  items={items}
                  setItems={setItems}
                  updateItem={updateItem}
                  removeItem={removeItem}
                  conf={conf}
                  confPct={confPct}
                  confTone={confTone}
                  confLabel={confLabel}
                  docCategory={docCategory}
                  fmt={fmt}
                  vatClaimable={vatClaimable}
                  expenseClaimable={expenseClaimable}
                  businessUseNote={businessUseNote}
                  platformName={platformName}
                  onPlatformChange={setPlatformName}
                  platformRef={platformRef}
                  customerName={customerName}
                  staffName={staffName}
                  warnings={warnings}
                  canEdit={canEdit}
                  saving={saving}
                  orgId={doc.organization_id ?? ""}
                />
              )}
            </div>

            {/* ── Sticky action footer ─────────────────────────────────────────── */}
            {canEdit && (
              <div className="shrink-0 border-t border-border bg-card">
                {integrations.length > 1 && (
                  <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-0">
                    <span className="text-[11.5px] text-muted-foreground shrink-0">ส่งไปยัง</span>
                    <select
                      value={form.integration_id}
                      onChange={e => setForm(f => ({ ...f, integration_id: e.target.value }))}
                      className="flex-1 h-8 rounded-[8px] border border-border bg-card text-xs
                        px-2.5 outline-none focus:border-brand-500 transition"
                    >
                      {integrations.map(i => (
                        <option key={i.id} value={i.id}>
                          {PROVIDER_LABEL[i.provider] ?? i.provider}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {isFailed ? (
                  /* ── Failed: Retry / Delete ──────────────────────────────────── */
                  <div className="p-3.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDeleteDoc}
                      disabled={deleting || retrying}
                      className="h-10 px-4 rounded-[10px] text-sm font-medium text-rose-600 dark:text-rose-400
                        hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-transparent
                        hover:border-rose-200 dark:hover:border-rose-500/30
                        inline-flex items-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                    >
                      {deleting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2  className="w-4 h-4" />}
                      ลบเอกสาร
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={retrying || deleting}
                      className="h-10 px-5 rounded-[10px] bg-brand-500 hover:bg-brand-600
                        text-white text-sm font-semibold inline-flex items-center gap-1.5
                        shadow-sm shadow-brand-500/30 transition-all disabled:opacity-50"
                    >
                      {retrying
                        ? <Loader2   className="w-4 h-4 animate-spin" />
                        : <RefreshCw className="w-4 h-4" />}
                      {retrying ? "กำลังประมวลผล…" : "ลองอีกครั้ง"}
                    </button>
                  </div>
                ) : (
                  /* ── Normal: Reject / Save / Approve ─────────────────────────── */
                  <div className="p-3.5 flex items-center gap-2">
                    <button type="button" onClick={handleReject} disabled={saving}
                      className="h-10 px-4 rounded-[10px] text-sm font-medium text-rose-600 dark:text-rose-400
                        hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-transparent
                        hover:border-rose-200 dark:hover:border-rose-500/30
                        inline-flex items-center gap-1.5 transition-all disabled:opacity-50 shrink-0">
                      <X className="w-4 h-4" />
                      ปฏิเสธ
                    </button>

                    <div className="flex-1" />

                    <button type="button" onClick={handleSaveDraft} disabled={saving}
                      className={`h-10 px-4 rounded-[10px] text-sm font-medium inline-flex items-center
                        gap-1.5 transition-all disabled:opacity-50 ${
                        isDirty
                          ? "bg-brand-500 hover:bg-brand-600 text-white shadow-sm shadow-brand-500/30 border border-brand-600"
                          : "border border-border bg-card text-foreground hover:bg-muted"
                      }`}>
                      <Save className="w-3.5 h-3.5" />
                      {isDirty ? "บันทึกการเปลี่ยนแปลง" : "บันทึกร่าง"}
                    </button>

                    <button type="button" onClick={() => handleApprove(false)} disabled={saving}
                      className="h-10 px-4 rounded-[10px] border border-emerald-300 dark:border-emerald-700
                        bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400
                        hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-sm font-medium
                        inline-flex items-center gap-1.5 transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" />
                      อนุมัติ
                    </button>

                    {integrations.length > 0 && (
                      <button type="button" onClick={() => handleApprove(true)} disabled={saving}
                        className="h-10 px-4 rounded-[10px] bg-brand-500 hover:bg-brand-600
                          text-white text-sm font-semibold inline-flex items-center gap-1.5
                          shadow-sm shadow-brand-500/30 transition-all disabled:opacity-50">
                        <Send className="w-3.5 h-3.5" />
                        {saving ? "กำลังส่ง…" : "อนุมัติ & ส่งเข้าบัญชี"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Duplicate Resolution Banner ─────────────────────────────────────────────
function DuplicateResolutionBanner({
  docId, original, onResolved,
}: {
  docId:      string
  original:   DuplicateOriginal
  onResolved: (action: "replace" | "discard") => void
}) {
  const [loading, setLoading] = useState<"replace" | "discard" | null>(null)

  async function resolve(action: "replace" | "discard") {
    setLoading(action)
    try {
      const res = await fetch(`/api/documents/${docId}/resolve-duplicate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "เกิดข้อผิดพลาด")
        return
      }
      toast.success(action === "replace" ? "ทับเอกสารเก่าแล้ว" : "ยกเลิกรายการนี้แล้ว")
      onResolved(action)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="border-b border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-5 py-4 shrink-0">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-amber-900 dark:text-amber-200">
            พบเอกสารซ้ำในระบบ
          </p>
          <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-0.5">
            เอกสารนี้มีข้อมูลตรงกับรายการที่บันทึกไว้แล้ว กรุณาเลือกวิธีจัดการ
          </p>
        </div>
      </div>

      {/* Original doc info box */}
      <div className="mt-3 rounded-[8px] border border-amber-200 dark:border-amber-500/25 bg-white/70 dark:bg-black/20 px-3.5 py-2.5 text-[12px] space-y-1">
        <p className="text-muted-foreground text-[10.5px] uppercase tracking-wide font-semibold mb-1.5">
          เอกสารต้นฉบับในระบบ
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {original.vendor_name && (
            <span className="font-medium text-foreground">{original.vendor_name}</span>
          )}
          {original.doc_number && (
            <span className="text-muted-foreground">· เลขที่ {original.doc_number}</span>
          )}
          {original.doc_date && (
            <span className="text-muted-foreground">· {formatDate(original.doc_date)}</span>
          )}
          {original.total_amount != null && (
            <span className="font-semibold text-foreground ml-auto">{formatThb(original.total_amount)}</span>
          )}
        </div>
        <a
          href={`/documents/${original.id}/review`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 hover:underline mt-1"
        >
          <ExternalLink className="w-3 h-3" /> ดูเอกสารต้นฉบับ
        </a>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex gap-2.5 flex-wrap">
        <button
          onClick={() => resolve("replace")}
          disabled={!!loading}
          className="flex-1 min-w-[140px] h-9 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white
            text-[12.5px] font-semibold flex items-center justify-center gap-2
            disabled:opacity-60 transition-colors"
        >
          {loading === "replace"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
          ทับของเก่า
        </button>
        <button
          onClick={() => resolve("discard")}
          disabled={!!loading}
          className="flex-1 min-w-[140px] h-9 rounded-[8px] border border-amber-300 dark:border-amber-500/40
            text-amber-800 dark:text-amber-300 bg-white/80 dark:bg-black/20
            hover:bg-amber-50 dark:hover:bg-amber-500/10
            text-[12.5px] font-semibold flex items-center justify-center gap-2
            disabled:opacity-60 transition-colors"
        >
          {loading === "discard"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Trash2 className="w-3.5 h-3.5" />}
          ยกเลิกรายการนี้
        </button>
      </div>
    </div>
  )
}

// ─── Debug Panel ─────────────────────────────────────────────────────────────
function DebugPanel({ doc, rawAI }: { doc: any; rawAI: any }) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied]  = useState(false)

  const fieldConf: Record<string, number> = rawAI?.field_confidence ?? {}
  const issues:    string[]               = rawAI?.extraction_issues ?? []
  const warnings:  any[]                  = doc.validation_warnings  ?? []

  const copyRaw = () => {
    navigator.clipboard.writeText(JSON.stringify(rawAI ?? doc.ai_raw_response, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const confColor = (v: number) =>
    v >= 0.9 ? "text-emerald-600 dark:text-emerald-400"
    : v >= 0.7 ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400"

  const confBar = (v: number) =>
    v >= 0.9 ? "bg-emerald-500" : v >= 0.7 ? "bg-amber-400" : "bg-rose-500"

  // Fields we want to show in the debug view
  const FIELD_LABELS: [string, string][] = [
    ["doc_category",    "ประเภทเอกสาร"],
    ["doc_type",        "doc_type (legacy)"],
    ["vendor_name",     "ชื่อผู้ขาย"],
    ["vendor_tax_id",   "เลขผู้เสียภาษี"],
    ["vendor_address",  "ที่อยู่ผู้ขาย"],
    ["vendor_phone",    "โทรศัพท์"],
    ["doc_number",      "เลขที่เอกสาร"],
    ["doc_date",        "วันที่เอกสาร"],
    ["due_date",        "วันครบกำหนด"],
    ["subtotal",        "ยอดก่อน VAT"],
    ["discount_amount", "ส่วนลด"],
    ["delivery_fee",    "ค่าจัดส่ง"],
    ["vat_amount",      "VAT"],
    ["wht_amount",      "WHT"],
    ["total_amount",    "ยอดรวม"],
    ["currency",        "สกุลเงิน"],
    ["platform_name",   "แพลตฟอร์ม"],
    ["payment_method",  "วิธีชำระเงิน"],
    ["vat_claimable",   "หักภาษีซื้อได้"],
    ["expense_claimable","บันทึกค่าใช้จ่ายได้"],
  ]

  return (
    <div className="p-4 space-y-4 font-mono text-[12px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-foreground font-sans">AI Debug — ผลการอ่านเอกสาร</span>
        </div>
        <button
          type="button"
          onClick={copyRaw}
          className="h-7 px-2.5 rounded-[6px] border border-border text-[11px] font-sans
            text-muted-foreground hover:bg-muted inline-flex items-center gap-1.5 transition-colors"
        >
          <Copy className="w-3 h-3" />
          {copied ? "คัดลอกแล้ว" : "คัดลอก JSON"}
        </button>
      </div>

      {/* Pipeline status */}
      <div className="rounded-[8px] border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider
          text-muted-foreground font-semibold font-sans">
          สถานะ Pipeline
        </div>
        <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {[
            ["status",           doc.status],
            ["doc_category",     rawAI?.doc_category ?? doc.doc_category ?? "—"],
            ["processing_stage", doc.processing_stage ?? "—"],
            ["processing_%",     doc.processing_percent != null ? `${doc.processing_percent}%` : "—"],
            ["overall_conf",     doc.overall_confidence != null ? `${Math.round(Number(doc.overall_confidence) * 100)}%` : "—"],
            ["extracted_at",     doc.extracted_at ? new Date(doc.extracted_at).toLocaleString("th") : "—"],
          ].map(([label, val]) => (
            <div key={label} className="flex items-baseline gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0 w-28 truncate">{label}</span>
              <span className="text-foreground font-medium truncate">{String(val ?? "—")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Extraction issues */}
      {issues.length > 0 && (
        <div className="rounded-[8px] border border-rose-200 dark:border-rose-800
          bg-rose-50 dark:bg-rose-950/50 p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold font-sans mb-2">
            ปัญหาที่ AI รายงาน ({issues.length})
          </p>
          {issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-1.5 text-rose-700 dark:text-rose-400">
              <span className="shrink-0 font-bold mt-0.5">•</span>
              <span className="leading-relaxed">{iss}</span>
            </div>
          ))}
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="rounded-[8px] border border-amber-200 dark:border-amber-800
          bg-amber-50 dark:bg-amber-950/50 p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold font-sans mb-2">
            Validation warnings ({warnings.length})
          </p>
          {warnings.map((w: any, i: number) => (
            <div key={i} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <span className="text-[10px] bg-amber-200 dark:bg-amber-800 px-1 rounded shrink-0 mt-0.5">
                {w.code ?? "WARN"}
              </span>
              <span>{w.message ?? String(w)}</span>
            </div>
          ))}
        </div>
      )}

      {/* No issues + no AI response */}
      {!rawAI && issues.length === 0 && (
        <div className="rounded-[8px] border border-dashed border-border bg-muted/20
          p-6 text-center text-muted-foreground font-sans text-sm">
          ยังไม่มีข้อมูล AI — เอกสารอาจยังไม่ผ่าน pipeline หรือ ai_raw_response ว่างเปล่า
        </div>
      )}

      {/* Field-by-field breakdown */}
      {rawAI && (
        <div className="rounded-[8px] border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider
            text-muted-foreground font-semibold font-sans">
            Field breakdown — ค่าที่ Claude อ่านได้
          </div>
          <div className="divide-y divide-border">
            {FIELD_LABELS.map(([key, label]) => {
              const val  = rawAI[key]
              const conf = fieldConf[key]
              const displayVal = val === null || val === undefined
                ? <span className="text-muted-foreground/50">null</span>
                : typeof val === "boolean"
                  ? <span className={val ? "text-emerald-600" : "text-rose-600"}>{String(val)}</span>
                  : <span className="text-foreground">{String(val)}</span>
              return (
                <div key={key} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors">
                  <div className="w-28 shrink-0">
                    <p className="text-muted-foreground leading-none">{key}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-sans">{label}</p>
                  </div>
                  <div className="flex-1 min-w-0 truncate">
                    {displayVal}
                  </div>
                  {conf !== undefined && (
                    <div className="shrink-0 flex items-center gap-1.5 w-20">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${confBar(conf)}`}
                          style={{ width: `${Math.round(conf * 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] tabular-nums w-8 text-right ${confColor(conf)}`}>
                        {Math.round(conf * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Line items from AI */}
      {rawAI?.line_items?.length > 0 && (
        <div className="rounded-[8px] border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider
            text-muted-foreground font-semibold font-sans">
            รายการสินค้า ({rawAI.line_items.length} รายการ)
          </div>
          <div className="divide-y divide-border">
            {rawAI.line_items.map((it: any, i: number) => (
              <div key={i} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-foreground">{it.description || <span className="text-muted-foreground/50">—</span>}</p>
                  <p className="text-[10px] text-muted-foreground font-sans">
                    {it.quantity ?? 1} × {it.unit_price ?? 0} = {it.amount ?? 0}
                  </p>
                </div>
                {it.confidence !== undefined && (
                  <span className={`text-[10px] shrink-0 ${confColor(it.confidence)}`}>
                    {Math.round(it.confidence * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON toggle */}
      <div className="rounded-[8px] border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRaw(r => !r)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60
            transition-colors text-left"
        >
          {showRaw
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground" />
          }
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            Raw JSON (ai_raw_response)
          </span>
        </button>
        {showRaw && (
          <pre className="p-3 text-[11px] overflow-x-auto leading-relaxed text-foreground/80
            bg-muted/20 max-h-96 overflow-y-auto">
            {JSON.stringify(rawAI ?? doc.ai_raw_response, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── Vendor status badge — queries vendors table to show found / new ─────────
interface VendorMatch {
  id:           string
  doc_count:    number
  total_amount: number
  last_doc_date: string | null
}

// ─── PlatformField — editable platform name with autocomplete ────────────────
const KNOWN_PLATFORMS = [
  "LINE MAN", "GrabFood", "Shopee Food", "FoodPanda", "Robinhood",
  "Lazada", "Shopee", "TikTok Shop", "Central Online",
  "Kerry Express", "Flash Express", "J&T Express", "Thailand Post",
  "PromptPay", "G-Wallet", "TrueMoney Wallet", "Rabbit LINE Pay",
  "SCB Easy", "KBank Mobile", "BBL Mobile", "KTB Next", "UOB TMRW",
  "ไทยธรรมชาติ 60/40", "เป๋าตัง",
]

function PlatformField({ value, onChange, orgId, canEdit, inputCls }: {
  value: string; onChange: (v: string) => void
  orgId: string; canEdit: boolean; inputCls: string
}) {
  const [open,        setOpen]        = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [lifeNames,   setLifeNames]   = useState<string[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load merchant names from life_merchants for autocomplete
  useEffect(() => {
    if (!orgId) return
    const sb = createClient()
    sb.from("life_merchants").select("name").eq("organization_id", orgId)
      .order("visit_count", { ascending: false }).limit(30)
      .then(({ data }) => setLifeNames((data ?? []).map((m: any) => m.name)))
  }, [orgId])

  const handleChange = (v: string) => {
    onChange(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      const q = v.toLowerCase()
      const all = [...KNOWN_PLATFORMS, ...lifeNames]
      const filtered = q
        ? all.filter(p => p.toLowerCase().includes(q)).slice(0, 6)
        : all.slice(0, 6)
      setSuggestions(filtered)
      setOpen(filtered.length > 0)
    }, 150)
  }

  return (
    <div className="relative">
      <input
        value={value ?? ""}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { if (!value) handleChange("") }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        disabled={!canEdit}
        placeholder="เช่น LINE MAN, Shopee Food, PromptPay…"
        className={inputCls}
      />
      {open && canEdit && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-[10px] shadow-lg overflow-hidden">
          {suggestions.map(s => {
            const inSystem = lifeNames.includes(s)
            return (
              <button key={s} type="button"
                onMouseDown={() => { onChange(s); setOpen(false) }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 transition-colors text-left">
                <span>{s}</span>
                {inSystem && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ มีในระบบ
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── VendorField — editable vendor with merchant lookup ───────────────────────
function VendorField({ value, onChange, orgId, canEdit, inputCls }: {
  value: string; onChange: (v: string) => void
  orgId: string; canEdit: boolean; inputCls: string
}) {
  const [open,        setOpen]        = useState(false)
  const [merchants,   setMerchants]   = useState<Array<{ name: string; visit_count: number; total_spent: number }>>([])
  const [vendors,     setVendors]     = useState<Array<{ name: string; doc_count: number }>>([])
  const [inSystem,    setInSystem]    = useState<"loading" | "found" | "new" | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if vendor exists & load suggestions
  const checkAndSuggest = useCallback(async (query: string) => {
    if (!query.trim() || !orgId) { setInSystem(null); setSuggestions([]); setOpen(false); return }
    setInSystem("loading")
    const sb = createClient()

    const [{ data: mData }, { data: vData }] = await Promise.all([
      sb.from("life_merchants").select("name, visit_count, total_spent")
        .eq("organization_id", orgId).ilike("name", `%${query}%`).limit(6),
      sb.from("vendors").select("name, doc_count")
        .eq("organization_id", orgId).ilike("name", `%${query}%`).limit(6),
    ])

    const found = [...(mData ?? []), ...(vData ?? [])].find(
      m => m.name.toLowerCase() === query.toLowerCase()
    )
    setInSystem(found ? "found" : "new")
    setMerchants(mData ?? [])
    setVendors(vData ?? [])
    setOpen(((mData?.length ?? 0) + (vData?.length ?? 0)) > 0)
  }, [orgId])

  const [suggestions, setSuggestions] = useState<any[]>([])

  const handleChange = (v: string) => {
    onChange(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => checkAndSuggest(v), 250)
  }

  const allSuggestions = [
    ...(merchants ?? []).map(m => ({ name: m.name, sub: `${m.visit_count} ครั้ง · ฿${Number(m.total_spent).toLocaleString()}`, type: "life" })),
    ...(vendors ?? []).filter(v => !(merchants ?? []).some(m => m.name.toLowerCase() === v.name.toLowerCase()))
      .map(v => ({ name: v.name, sub: `${v.doc_count} เอกสาร`, type: "vendor" })),
  ].slice(0, 8)

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={value ?? ""}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (value?.trim()) checkAndSuggest(value) }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          disabled={!canEdit}
          placeholder="—"
          className={inputCls}
        />
        {/* Status indicator */}
        {inSystem === "found" && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
            ✓ มีในระบบ
          </span>
        )}
        {inSystem === "new" && value?.trim() && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
            + ใหม่
          </span>
        )}
      </div>
      {open && canEdit && allSuggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-[10px] shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border bg-muted/30">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">ร้านค้าในระบบ</p>
          </div>
          {allSuggestions.map(s => (
            <button key={s.name} type="button"
              onMouseDown={() => { onChange(s.name); setOpen(false); setInSystem("found") }}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/60 transition-colors text-left border-b border-border/50 last:border-0">
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-[11px] text-muted-foreground">{s.sub}</p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                s.type === "life"
                  ? "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  : "bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"
              }`}>
                {s.type === "life" ? "Life Graph" : "Vendor"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function VendorStatusBadge({
  orgId, vendorName, taxId,
}: {
  orgId:      string
  vendorName: string
  taxId:      string
}) {
  const [status, setStatus]   = useState<"loading"|"found"|"new">("loading")
  const [match,  setMatch]    = useState<VendorMatch | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const name = vendorName.trim()
    if (!name) { setStatus("new"); return }

    if (debounce.current) clearTimeout(debounce.current)
    setStatus("loading")

    debounce.current = setTimeout(async () => {
      const supabase = createClient()
      let query = supabase
        .from("vendors")
        .select("id, doc_count, total_amount, last_doc_date")
        .eq("organization_id", orgId)

      if (taxId.trim()) {
        query = query.eq("tax_id", taxId.trim())
      } else {
        query = query.ilike("name", name)
      }

      const { data } = await query.limit(1).maybeSingle()
      if (data) {
        setMatch(data)
        setStatus("found")
      } else {
        setMatch(null)
        setStatus("new")
      }
    }, 500)

    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [vendorName, taxId, orgId])

  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        ตรวจสอบ...
      </span>
    )
  }

  if (status === "found" && match) {
    return (
      <a
        href="/vendors"
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium
          px-2 py-0.5 rounded-full
          bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400
          hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
        title={`พบในระบบ · ${match.doc_count} เอกสาร · ${formatThb(match.total_amount)}`}
      >
        <UserCheck className="w-3 h-3 shrink-0" />
        พบในระบบ · {match.doc_count} เอกสาร
        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
      </a>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium
      px-2 py-0.5 rounded-full
      bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
      <UserPlus className="w-3 h-3 shrink-0" />
      ผู้ขายใหม่ — จะบันทึกอัตโนมัติเมื่ออนุมัติ
    </span>
  )
}

// ─── Data panel (right side) — broken out for readability ────────────────────
interface DocDataPanelProps {
  doc:              any
  form:             any
  setForm:          (fn: (f: any) => any) => void
  items:            LineItem[]
  setItems:         (fn: (prev: LineItem[]) => LineItem[]) => void
  updateItem:       (i: number, key: keyof LineItem, val: string | number) => void
  removeItem:       (i: number) => void
  conf:             number
  confPct:          number
  confTone:         string
  confLabel:        string
  docCategory:      DocCategory
  fmt:              FormatConfig
  vatClaimable:     boolean
  expenseClaimable: boolean
  businessUseNote:  string
  platformName:     string | null
  onPlatformChange: (v: string) => void   // ← editable
  platformRef:      string | null
  customerName:     string | null
  staffName:        string | null
  warnings:         { tone: string; text: string }[]
  canEdit:          boolean
  saving:           boolean
  orgId:            string
}

function DocDataPanel({
  doc, form, setForm, items, setItems, updateItem, removeItem,
  conf, confPct, confTone, confLabel,
  docCategory, fmt,
  vatClaimable, expenseClaimable, businessUseNote,
  platformName, onPlatformChange, platformRef, customerName, staffName,
  warnings, canEdit, orgId,
}: DocDataPanelProps) {
  return (
    <div className="p-5 space-y-4">

      {/* ── AI confidence ──────────────────────────────────────────────────── */}
      {conf > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              ความถูกต้องของ AI
            </span>
            <span className={`text-xs font-bold ${
              confTone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
              : confTone === "amber" ? "text-amber-600 dark:text-amber-400"
              : "text-rose-600 dark:text-rose-400"
            }`}>{confPct}% — {confLabel}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${
              confTone === "emerald" ? "bg-emerald-500"
              : confTone === "amber" ? "bg-amber-400"
              : "bg-rose-500"
            }`} style={{ width: `${confPct}%` }} />
          </div>
        </div>
      )}

      {/* Machine verification is separate from human approval/status. */}
      {doc.machine_verification_status && (() => {
        const status = doc.machine_verification_status as "verified" | "needs_review" | "unverified"
        const reconciliation = doc.reconciliation_details ?? {}
        const label = status === "verified" ? "ระบบตรวจยอดแล้ว"
          : status === "needs_review" ? "ควรตรวจสอบก่อนอนุมัติ" : "ยังยืนยันข้อมูลไม่ได้"
        const detail = reconciliation.status === "balanced" ? "ยอดรวมและรายการที่ตรวจได้สมดุลกัน"
          : reconciliation.status === "mismatch" ? "พบยอดรวม หรือผลรวมรายการไม่ตรงกัน"
          : "ข้อมูลยังไม่เพียงพอสำหรับตรวจสมดุลยอด"
        return (
          <div className={`rounded-[10px] border px-3.5 py-3 ${
            status === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            : status === "needs_review" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
          }`}>
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              {status === "verified" ? <BadgeCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {label}
            </div>
            <p className="mt-1 pl-6 text-[11.5px] opacity-80">{detail}</p>
          </div>
        )
      })()}

      {/* ── Classification banner ─────────────────────────────────────────── */}
      {docCategory && docCategory !== "other" && (
        <div className="rounded-[10px] border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/30 flex-wrap gap-y-1.5">
            <DocCategoryBadge category={docCategory} />
            {platformName && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full
                bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                {platformName}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <TaxBadge ok={vatClaimable}
                label={vatClaimable ? "หักภาษีซื้อได้" : "หักภาษีซื้อไม่ได้"} />
              <TaxBadge ok={expenseClaimable}
                label={expenseClaimable ? "บันทึกค่าใช้จ่ายได้" : "บันทึกค่าใช้จ่ายไม่ได้"} />
            </div>
          </div>
          {businessUseNote && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-400" />
              <span>{businessUseNote}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Validation warnings ───────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className={`flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] text-[12.5px] ${
              w.tone === "rose"
                ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
            }`}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{w.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Platform highlight for consumer receipts ─────────────────────── */}
      {fmt.showPlatformBanner && (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-muted/30 border-b border-border">
            <SectionHeader icon={<ShoppingBag className="w-3.5 h-3.5 text-brand-500" />}>
              {fmt.vendorSectionLabel}
            </SectionHeader>
            {form.vendor_name && (
              <VendorStatusBadge orgId={orgId} vendorName={form.vendor_name} taxId={form.vendor_tax_id} />
            )}
          </div>
          <div className="px-3.5 py-3 grid grid-cols-2 gap-3">
            {/* Platform name — editable with autocomplete */}
            <div className="col-span-2">
              <FieldLabel icon={<Tag className="w-3 h-3" />}>แพลตฟอร์ม</FieldLabel>
              <PlatformField
                value={platformName ?? ""}
                onChange={onPlatformChange}
                orgId={orgId}
                canEdit={canEdit}
                inputCls={inputCls}
              />
            </div>
            {/* Vendor name — editable with merchant lookup */}
            <div className="col-span-2">
              <FieldLabel icon={<ShoppingBag className="w-3 h-3" />}>ร้านค้า / ผู้ให้บริการ</FieldLabel>
              <VendorField
                value={form.vendor_name}
                onChange={v => setForm((f: any) => ({ ...f, vendor_name: v }))}
                orgId={orgId}
                canEdit={canEdit}
                inputCls={inputCls}
              />
            </div>
            {platformRef && (
              <div className="col-span-2">
                <FieldLabel icon={<Hash className="w-3 h-3" />}>รหัส Delivery / Order</FieldLabel>
                <input value={platformRef} disabled className={`${inputCls} font-mono text-[11px]`} readOnly />
              </div>
            )}
            {customerName && (
              <div>
                <FieldLabel>ชื่อลูกค้า</FieldLabel>
                <input value={customerName} disabled className={inputCls} readOnly />
              </div>
            )}
            {staffName && (
              <div>
                <FieldLabel>พนักงาน</FieldLabel>
                <input value={staffName} disabled className={inputCls} readOnly />
              </div>
            )}
            <div>
              <FieldLabel icon={<Hash className="w-3 h-3" />}>{fmt.docNumberLabel}</FieldLabel>
              <input value={form.doc_number} disabled={!canEdit}
                onChange={e => setForm((f: any) => ({ ...f, doc_number: e.target.value }))}
                className={inputCls} placeholder="—" />
            </div>
            <div>
              <FieldLabel icon={<CalendarDays className="w-3 h-3" />}>วันที่</FieldLabel>
              <input type="date" value={form.doc_date} disabled={!canEdit}
                onChange={e => setForm((f: any) => ({ ...f, doc_date: e.target.value }))}
                className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Vendor / issuer section (for non-consumer) ───────────────────── */}
      {!fmt.showPlatformBanner && (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-muted/30 border-b border-border">
            <SectionHeader icon={<Building2 className="w-3.5 h-3.5 text-brand-500" />}>
              {fmt.vendorSectionLabel}
            </SectionHeader>
            {form.vendor_name && (
              <VendorStatusBadge orgId={orgId} vendorName={form.vendor_name} taxId={form.vendor_tax_id} />
            )}
          </div>
          <div className="px-3.5 py-3 space-y-3">
            <div>
              <FieldLabel>ชื่อผู้ขาย / ผู้ให้บริการ</FieldLabel>
              <input value={form.vendor_name} disabled={!canEdit}
                onChange={e => setForm((f: any) => ({ ...f, vendor_name: e.target.value }))}
                className={inputCls} placeholder="—" />
            </div>
            {fmt.showVendorTaxId && (
              <div>
                <FieldLabel icon={<Hash className="w-3 h-3" />}>เลขประจำตัวผู้เสียภาษี</FieldLabel>
                <input value={form.vendor_tax_id} disabled={!canEdit}
                  onChange={e => setForm((f: any) => ({ ...f, vendor_tax_id: e.target.value }))}
                  className={inputCls} placeholder="—" />
              </div>
            )}
            {fmt.showVendorPhone && form.vendor_phone !== undefined && (
              <div>
                <FieldLabel icon={<Phone className="w-3 h-3" />}>โทรศัพท์</FieldLabel>
                <input value={form.vendor_phone} disabled={!canEdit}
                  onChange={e => setForm((f: any) => ({ ...f, vendor_phone: e.target.value }))}
                  className={inputCls} placeholder="—" />
              </div>
            )}
            {fmt.showVendorAddress && form.vendor_address !== undefined && (
              <div>
                <FieldLabel icon={<MapPin className="w-3 h-3" />}>ที่อยู่</FieldLabel>
                <input value={form.vendor_address} disabled={!canEdit}
                  onChange={e => setForm((f: any) => ({ ...f, vendor_address: e.target.value }))}
                  className={inputCls} placeholder="—" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Document info section ─────────────────────────────────────────── */}
      {!fmt.showPlatformBanner && (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
          <div className="px-3.5 py-2.5 bg-muted/30 border-b border-border">
            <SectionHeader icon={<FileText className="w-3.5 h-3.5 text-brand-500" />}>
              ข้อมูลเอกสาร
            </SectionHeader>
          </div>
          <div className="px-3.5 py-3 grid grid-cols-2 gap-3">
            <div>
              <FieldLabel icon={<Hash className="w-3 h-3" />}>{fmt.docNumberLabel}</FieldLabel>
              <input value={form.doc_number} disabled={!canEdit}
                onChange={e => setForm((f: any) => ({ ...f, doc_number: e.target.value }))}
                className={inputCls} placeholder="—" />
            </div>
            <div>
              <FieldLabel icon={<CalendarDays className="w-3 h-3" />}>วันที่เอกสาร</FieldLabel>
              <input type="date" value={form.doc_date} disabled={!canEdit}
                onChange={e => setForm((f: any) => ({ ...f, doc_date: e.target.value }))}
                className={inputCls} />
            </div>
            {fmt.showDueDate && (
              <div className="col-span-2">
                <FieldLabel icon={<CalendarDays className="w-3 h-3" />}>วันครบกำหนดชำระ</FieldLabel>
                <input type="date" value={form.due_date} disabled={!canEdit}
                  onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))}
                  className={inputCls} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Line items ─────────────────────────────────────────────────────── */}
      {fmt.lineItemsStyle !== "none" && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <SectionHeader>รายการสินค้า / บริการ</SectionHeader>
            {canEdit && (
              <button type="button"
                onClick={() => setItems((prev: LineItem[]) => [...prev, { description: "", quantity: 1, unit_price: 0, amount: 0 }])}
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline
                  inline-flex items-center gap-1 transition-colors">
                <Plus className="w-3 h-3" /> เพิ่มรายการ
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border bg-card
              py-6 text-center text-sm text-muted-foreground">
              ไม่พบรายการสินค้า
            </div>
          ) : fmt.lineItemsStyle === "table" ? (
            /* Full table — for tax invoices & invoices */
            <div className="rounded-[10px] border border-border overflow-hidden bg-card">
              <table className="w-full text-[12.5px]">
                <thead className="bg-muted/50 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">รายละเอียด</th>
                    <th className="text-right px-3 py-2 font-medium w-20">จำนวน</th>
                    <th className="text-right px-3 py-2 font-medium w-24">ราคา/หน่วย</th>
                    <th className="text-right px-3 py-2 font-medium w-24">รวม</th>
                    {canEdit && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((it, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 align-top">
                        {canEdit ? (
                          <textarea value={it.description} disabled={!canEdit}
                            onChange={e => updateItem(i, "description", e.target.value)}
                            rows={Math.max(1, Math.ceil(it.description.length / 35))}
                            className="w-full bg-transparent outline-none text-foreground resize-none
                              placeholder:text-muted-foreground/50 leading-relaxed"
                            placeholder="รายละเอียด" />
                        ) : (
                          <span className="whitespace-pre-wrap leading-relaxed">{it.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground align-top">
                        {canEdit ? (
                          <input type="number" value={it.quantity} min={0}
                            onChange={e => updateItem(i, "quantity", e.target.value)}
                            className="w-full bg-transparent outline-none text-right text-foreground" />
                        ) : it.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {canEdit ? (
                          <input type="number" value={it.unit_price} min={0}
                            onChange={e => updateItem(i, "unit_price", e.target.value)}
                            className="w-full bg-transparent outline-none text-right text-foreground" />
                        ) : formatThb(it.unit_price)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatThb(it.amount)}
                      </td>
                      {canEdit && (
                        <td className="text-center pr-1">
                          <button type="button"
                            onClick={() => removeItem(i)}
                            className="h-6 w-6 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/20
                              text-muted-foreground hover:text-rose-500 inline-flex items-center
                              justify-center transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Simple list — for consumer receipts & general receipts */
            <div className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    {canEdit ? (
                      <input value={it.description} disabled={!canEdit}
                        onChange={e => updateItem(i, "description", e.target.value)}
                        className="w-full bg-transparent outline-none text-[13px] text-foreground
                          placeholder:text-muted-foreground/50"
                        placeholder="รายละเอียด" />
                    ) : (
                      <span className="text-[13px] text-foreground truncate block">{it.description}</span>
                    )}
                    {it.quantity > 1 && (
                      <span className="text-[11px] text-muted-foreground">× {it.quantity}</span>
                    )}
                  </div>
                  <span className="text-[13px] font-medium tabular-nums text-foreground shrink-0">
                    {formatThb(it.amount)}
                  </span>
                  {canEdit && (
                    <button type="button"
                      onClick={() => removeItem(i)}
                      className="h-6 w-6 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/20
                        text-muted-foreground hover:text-rose-500 inline-flex items-center
                        justify-center transition-colors shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div className="rounded-[10px] border border-border overflow-hidden bg-card">
        <div className="px-4 py-2.5 bg-muted/40 text-[10.5px] uppercase tracking-wider
          text-muted-foreground font-semibold flex items-center gap-1.5">
          <Receipt className="w-3.5 h-3.5" />
          สรุปยอด
        </div>
        <div className="p-4 space-y-2 text-sm">
          {fmt.showSubtotalLine && (
            <TotalRow label="ยอดก่อน VAT" value={
              canEdit ? (
                <NumInput value={form.subtotal} onChange={v => setForm((f: any) => ({ ...f, subtotal: v }))} />
              ) : formatThb(form.subtotal)
            } />
          )}
          {fmt.showDiscountLine && form.discount_amount > 0 && (
            <TotalRow label="ส่วนลด" muted value={
              canEdit ? (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">−</span>
                  <NumInput value={form.discount_amount} onChange={v => setForm((f: any) => ({ ...f, discount_amount: v }))} />
                </span>
              ) : `− ${formatThb(form.discount_amount)}`
            } />
          )}
          {fmt.showDeliveryLine && form.delivery_fee > 0 && (
            <TotalRow label="ค่าจัดส่ง" value={
              canEdit ? (
                <NumInput value={form.delivery_fee} onChange={v => setForm((f: any) => ({ ...f, delivery_fee: v }))} />
              ) : formatThb(form.delivery_fee)
            } />
          )}
          {fmt.showVatLine && form.vat_amount > 0 && (
            <TotalRow label="VAT 7%" value={
              canEdit ? (
                <NumInput value={form.vat_amount} onChange={v => setForm((f: any) => ({ ...f, vat_amount: v }))} />
              ) : formatThb(form.vat_amount)
            } />
          )}
          {fmt.showWhtLine && form.wht_amount > 0 && (
            <TotalRow label="ภาษีหัก ณ ที่จ่าย (WHT)" muted value={
              canEdit ? (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">−</span>
                  <NumInput value={form.wht_amount} onChange={v => setForm((f: any) => ({ ...f, wht_amount: v }))} />
                </span>
              ) : `− ${formatThb(form.wht_amount)}`
            } />
          )}
          <div className="h-px bg-border" />
          <TotalRow
            label={fmt.totalLabel}
            strong
            value={
              canEdit ? (
                <NumInput value={form.total_amount} onChange={v => setForm((f: any) => ({ ...f, total_amount: v }))} bold />
              ) : formatThb(form.total_amount)
            }
          />
        </div>
      </div>

      {/* ── AI Notes (read-only log) ──────────────────────────────────────── */}
      {form.notes && (
        <div>
          <FieldLabel>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15
                text-amber-700 dark:text-amber-400 font-semibold tracking-wide">AI</span>
              บันทึกจาก AI
            </span>
          </FieldLabel>
          <div className="w-full rounded-[10px] border border-border bg-muted/40 text-[12.5px]
            text-muted-foreground p-3 leading-relaxed whitespace-pre-wrap select-text">
            {form.notes}
          </div>
        </div>
      )}

      {/* ── User Note (editable) ──────────────────────────────────────────── */}
      <div>
        <FieldLabel>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-500/15
              text-brand-700 dark:text-brand-400 font-semibold tracking-wide">คุณ</span>
            บันทึก / หมายเหตุ
          </span>
        </FieldLabel>
        <textarea rows={3} value={form.review_note} disabled={!canEdit}
          onChange={e => setForm((f: any) => ({ ...f, review_note: e.target.value }))}
          placeholder="เพิ่มบันทึกของคุณ เช่น หมายเหตุการอนุมัติ, รายละเอียดเพิ่มเติม..."
          className="w-full rounded-[10px] border border-border bg-card text-sm p-3
            outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15
            resize-y transition disabled:opacity-60 min-h-[80px]" />
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
const inputCls = `w-full h-10 rounded-[10px] border border-border bg-card text-sm text-foreground
  px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15
  transition disabled:bg-muted/40 disabled:text-muted-foreground placeholder:text-muted-foreground/40`

const toolBtnCls = `h-8 w-8 rounded-[8px] hover:bg-muted flex items-center justify-center
  transition-colors text-muted-foreground hover:text-foreground`

function FieldLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground mb-1.5">
      {icon && <span className="opacity-60">{icon}</span>}
      {children}
    </label>
  )
}

function SectionHeader({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
      {icon}
      {children}
    </h3>
  )
}

function TotalRow({ label, value, strong, muted }: {
  label: string; value: React.ReactNode; strong?: boolean; muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={muted ? "text-muted-foreground text-[13px]" : "text-muted-foreground text-[13px]"}>
        {label}
      </span>
      <span className={`tabular-nums ${strong ? "text-[17px] font-bold text-foreground" : "font-medium text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}

function NumInput({ value, onChange, bold }: {
  value: number; onChange: (v: number) => void; bold?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={0}
      step={0.01}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`w-28 text-right bg-transparent outline-none border-b border-dashed
        border-border focus:border-brand-400 transition
        ${bold ? "text-[17px] font-bold text-foreground" : "font-medium text-foreground"}`}
    />
  )
}

function TaxBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
      ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
         : "bg-muted text-muted-foreground"
    }`}>
      {ok ? <BadgeCheck className="w-3 h-3" /> : <BadgeX className="w-3 h-3" />}
      {label}
    </span>
  )
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  tax_invoice_full:       { label: "ใบกำกับภาษีเต็มรูปแบบ",  color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  tax_invoice_simplified: { label: "ใบกำกับภาษีอย่างย่อ",    color: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
  receipt_with_tax:       { label: "ใบเสร็จ/ใบกำกับภาษี",   color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  receipt:                { label: "ใบเสร็จรับเงิน",          color: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" },
  consumer_receipt:       { label: "ใบเสร็จแอปพลิเคชัน",     color: "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300" },
  invoice:                { label: "ใบแจ้งหนี้",              color: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  credit_note:            { label: "ใบลดหนี้",                color: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
  other:                  { label: "ไม่ทราบประเภท",           color: "bg-muted text-muted-foreground" },
}

function DocCategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.other
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${meta.color}`}>
      {meta.label}
    </span>
  )
}
