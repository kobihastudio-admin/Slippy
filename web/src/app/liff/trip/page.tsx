/**
 * /liff/trip — Trip Groups Dashboard (LIFF mini-app, "à la KhunThong", travel-themed)
 *
 * Opens INSIDE LINE app from the Rich Menu "✈️ กลุ่มทริป" tap-area.
 * Mirrors /liff/sport exactly (same auth flow, same even-split mechanics) —
 * just themed for travel: trip_type/destination instead of sport_type/venue.
 *
 * Views: list → create → detail
 */

"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import QRCode from "qrcode"
import { getAppUrl } from "@/lib/app-url"
import { cn } from "@/lib/utils"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { useAppLoading } from "@/lib/loading"
import {
  Loader2, AlertCircle, Plus, MapPin, Users, ChevronLeft,
  CheckCircle2, Circle, Share2, Lock, ArrowRight, Navigation, Pencil, QrCode, Check, X,
} from "lucide-react"

type View = "list" | "create" | "detail"
type DetailTab = "overview" | "itinerary" | "settlements"

interface GroupSummary {
  id: string; title: string; emoji: string; tripType: string | null
  destination: string | null; fee: number; status: string; shareToken: string
  createdAt: string; paidCount: number; headCount: number
}
interface Participant { id: string; name: string; amount: number; paid: boolean; isMe: boolean }

interface ItineraryItem {
  id: string; sortOrder: number; type: string; title: string
  location?: string | null; notes?: string | null; amount?: number | null
  timeFrom?: string | null; timeTo?: string | null
}
interface ItineraryDay {
  id: string; dayNumber: number; date?: string | null; title: string; items: ItineraryItem[]
}
interface Settlement {
  id: string | null; fromId: string; fromName: string; toId: string; toName: string
  amount: number; settled: boolean; settledAt?: string | null
}

interface GroupDetail {
  id: string; title: string; emoji: string; tripType: string | null
  destination: string | null; fee: number; status: string; shareToken: string
  promptpayId: string | null; isCreator: boolean
  participants: Participant[]; paidTotal: number
}

const TRIP_OPTIONS = [
  { label: "เที่ยวทะเล", emoji: "🏖️" },
  { label: "แคมป์ปิ้ง",  emoji: "⛺" },
  { label: "ปีนเขา",     emoji: "🏔️" },
  { label: "ต่างประเทศ", emoji: "✈️" },
  { label: "ทริปเมือง",  emoji: "🏙️" },
  { label: "เกาะ",       emoji: "🏝️" },
]

const ITEM_TYPE_OPTIONS = [
  { type: "activity", emoji: "🎯", label: "กิจกรรม" },
  { type: "meal", emoji: "🍽️", label: "อาหาร" },
  { type: "transport", emoji: "🚌", label: "เดินทาง" },
  { type: "hotel", emoji: "🏨", label: "ที่พัก" },
  { type: "booking", emoji: "🎟️", label: "จอง" },
  { type: "other", emoji: "📌", label: "อื่นๆ" },
]
const TYPE_EMOJI: Record<string, string> = Object.fromEntries(ITEM_TYPE_OPTIONS.map(o => [o.type, o.emoji]))

function fmtTHB(n: number) {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"

export default function LiffTripDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError,  setAuthError]  = useState("")
  const [loggingIn,  setLoggingIn]  = useState(false)
  const [profile, setProfile] = useState<{ userId: string; displayName: string; pictureUrl?: string } | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [error, setError]   = useState("")

  const [view, setView]     = useState<View>("list")
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [busy, setBusy]     = useState(false)
  const { setLoading } = useAppLoading()
  useEffect(() => {
    setLoading(busy, "Slippy กำลังดำเนินการ...")
    return () => { if (busy) setLoading(false) }
  }, [busy, setLoading])

  // create-form state
  const [tripType, setTripType] = useState("")
  const [fee, setFee]   = useState("")
  const [destination, setDestination] = useState("")

  // "เลือกจุดหมาย" picker — null shows the 2-way chooser, otherwise the panel for that mode
  const [destMode, setDestMode] = useState<"map" | "manual" | null>(null)

  // Set right after a new group is created — shows the "เลือกกลุ่ม LINE เพื่อ
  // โพสต์คำเชิญ" prompt on the detail page.
  const [justCreated, setJustCreated] = useState(false)

  // detail tab
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")

  // itinerary state
  const [itineraryDays, setItineraryDays] = useState<ItineraryDay[]>([])
  const [itineraryLoading, setItineraryLoading] = useState(false)
  const [addingItemDayId, setAddingItemDayId] = useState<string | null>(null)
  const [newItemType, setNewItemType] = useState("activity")
  const [newItemTitle, setNewItemTitle] = useState("")
  const [newItemLocation, setNewItemLocation] = useState("")
  const [newItemAmount, setNewItemAmount] = useState("")
  const [newItemTimeFrom, setNewItemTimeFrom] = useState("")

  // settlements state
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [settlementsLoading, setSettlementsLoading] = useState(false)

  // PromptPay QR for the payment section
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [editingPromptpay, setEditingPromptpay] = useState(false)
  const [promptpayDraft, setPromptpayDraft] = useState("")

  useEffect(() => { init() }, [])

  // Generate the PromptPay QR (with this user's amount embedded) whenever the
  // group's PromptPay ID or my outstanding amount changes.
  useEffect(() => {
    const me = detail?.participants.find(p => p.isMe)
    if (!detail?.promptpayId || !me || me.amount <= 0) { setQrDataUrl(null); return }
    QRCode.toDataURL(buildPromptPayPayload(detail.promptpayId, me.amount), { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [detail?.promptpayId, detail?.participants])

  // Returning from "/liff/places?picker=trip" with a chosen destination —
  // restore the create form and fill it in.
  useEffect(() => {
    if (searchParams.get("restoreCreate") !== "1") return
    const draftRaw = sessionStorage.getItem("slippy_trip_create_draft")
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw) as { tripType: string; fee: string }
        setTripType(draft.tripType)
        setFee(draft.fee)
      } catch {}
      sessionStorage.removeItem("slippy_trip_create_draft")
    }
    const raw = sessionStorage.getItem("slippy_place_picker_result")
    if (raw) {
      try {
        const place = JSON.parse(raw) as { name: string; address: string; mapsUrl: string }
        setDestination(place.name)
      } catch {}
      sessionStorage.removeItem("slippy_place_picker_result")
    }
    setView("create")
    setDestMode(null)
    router.replace("/liff/trip")
  }, [searchParams, router])

  // LIFF auth — done step-by-step (same explicit flow as /liff/sport) so we can
  // show our OWN branded "เข้าสู่ระบบด้วย LINE" screen and surface real errors
  // instead of silently bouncing through LINE's bare OAuth page.
  async function init() {
    setAuthStatus("checking")
    setAuthError("")

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) {
      setAuthStatus("authError")
      setAuthError("ระบบยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID ไม่พบ) — กรุณาติดต่อผู้ดูแลระบบ")
      return
    }

    let liff: any
    try {
      const mod = await import("@line/liff")
      liff = mod.default
      // liff.init() also finishes processing any login redirect (#liff.state=...)
      // that brought us back here after tapping "เข้าสู่ระบบด้วย LINE" below.
      await liff.init({ liffId })
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`เริ่มต้น LIFF ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
      return
    }

    if (!liff.isInClient()) {
      setAuthStatus("outsideLine")
      return
    }

    if (!liff.isLoggedIn()) {
      setAuthStatus("needLogin")
      return
    }

    try {
      const p = await liff.getProfile()
      const prof = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl }
      setProfile(prof)
      setAuthStatus("ready")
      await loadGroups(prof.userId)
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  // User explicitly taps "เข้าสู่ระบบด้วย LINE" — runs liff.login(), which
  // redirects through LINE's consent screen and back to this exact URL
  // (stripped of any stale hash so liff.init() can re-process it cleanly).
  async function handleLineLogin() {
    setLoggingIn(true)
    try {
      const mod = await import("@line/liff")
      const liff = mod.default
      const redirectUri = window.location.href.split("#")[0]
      liff.login({ redirectUri })
    } catch (err: any) {
      setLoggingIn(false)
      setAuthStatus("authError")
      setAuthError(`เข้าสู่ระบบด้วย LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  async function loadGroups(userId: string) {
    try {
      const res = await fetch(`/api/liff/trip-groups?lineUserId=${userId}`)
      const data = await res.json()
      if (data.needsConnect) setNeedsConnect(true)
      setGroups(data.groups ?? [])
    } catch { setError("โหลดรายการกลุ่มไม่สำเร็จ") }
  }

  async function openDetail(id: string, opts?: { justCreated?: boolean }) {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${id}?lineUserId=${profile.userId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ไม่พบกลุ่ม"); return }
      setDetail(data.group)
      setView("detail")
      setDetailTab("overview")
      setJustCreated(!!opts?.justCreated)
      setItineraryDays([])
      setSettlements([])
    } finally { setBusy(false) }
  }

  async function loadItinerary(id: string) {
    if (!profile) return
    setItineraryLoading(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${id}/itinerary?lineUserId=${profile.userId}`)
      const data = await res.json()
      if (res.ok) setItineraryDays(data.days ?? [])
    } finally { setItineraryLoading(false) }
  }

  async function loadSettlements(id: string) {
    if (!profile) return
    setSettlementsLoading(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${id}/settlements?lineUserId=${profile.userId}`)
      const data = await res.json()
      if (res.ok) setSettlements(data.settlements ?? [])
    } finally { setSettlementsLoading(false) }
  }

  async function addDay(tripId: string) {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${tripId}/itinerary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_day", lineUserId: profile.userId }),
      })
      const data = await res.json()
      if (res.ok) setItineraryDays(prev => [...prev, { ...data.day, items: [] }])
      else setError(data.error ?? "เพิ่มวันไม่สำเร็จ")
    } finally { setBusy(false) }
  }

  async function addItem(tripId: string, dayId: string) {
    if (!profile || !newItemTitle.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${tripId}/itinerary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_item", lineUserId: profile.userId, dayId,
          type: newItemType, title: newItemTitle.trim(),
          location: newItemLocation.trim() || undefined,
          amount: newItemAmount ? Number(newItemAmount) : undefined,
          timeFrom: newItemTimeFrom || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setItineraryDays(prev => prev.map(d =>
          d.id === dayId ? { ...d, items: [...d.items, data.item] } : d
        ))
        setAddingItemDayId(null)
        setNewItemTitle(""); setNewItemLocation(""); setNewItemAmount(""); setNewItemTimeFrom("")
      } else { setError(data.error ?? "เพิ่มกิจกรรมไม่สำเร็จ") }
    } finally { setBusy(false) }
  }

  async function removeItem(tripId: string, dayId: string, itemId: string) {
    if (!profile) return
    const res = await fetch(`/api/liff/trip-groups/${tripId}/itinerary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_item", lineUserId: profile.userId, itemId }),
    })
    if (res.ok) {
      setItineraryDays(prev => prev.map(d =>
        d.id === dayId ? { ...d, items: d.items.filter(i => i.id !== itemId) } : d
      ))
    }
  }

  async function computeSettlements(tripId: string) {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${tripId}/settlements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compute", lineUserId: profile.userId }),
      })
      const data = await res.json()
      if (res.ok) setSettlements(data.settlements ?? [])
      else setError(data.error ?? "คำนวณไม่สำเร็จ")
    } finally { setBusy(false) }
  }

  async function markSettled(tripId: string, settlementId: string) {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${tripId}/settlements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_settled", lineUserId: profile.userId, settlementId }),
      })
      if (res.ok) {
        setSettlements(prev => prev.map(s => s.id === settlementId ? { ...s, settled: true } : s))
      }
    } finally { setBusy(false) }
  }

  async function refreshDetail(id: string) {
    if (!profile) return
    const res = await fetch(`/api/liff/trip-groups/${id}?lineUserId=${profile.userId}`)
    const data = await res.json()
    if (res.ok) setDetail(data.group)
  }

  async function doAction(action: "join" | "pay" | "unpay" | "finalize") {
    if (!profile || !detail) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineUserId: profile.userId, displayName: profile.displayName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ทำรายการไม่สำเร็จ"); return }
      setDetail(data.group)
      loadGroups(profile.userId)
    } finally { setBusy(false) }
  }

  async function savePromptPay(value: string) {
    if (!profile || !detail) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/trip-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setPromptPay", lineUserId: profile.userId, promptpayId: value }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "บันทึกไม่สำเร็จ"); return }
      setDetail(data.group)
      setEditingPromptpay(false)
    } finally { setBusy(false) }
  }

  async function createGroup() {
    if (!profile || !tripType || !fee) return
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/liff/trip-groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.userId, displayName: profile.displayName,
          tripType, fee: Number(fee), destination: destination.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsConnect) setNeedsConnect(true)
        setError(data.error ?? "สร้างกลุ่มไม่สำเร็จ")
        return
      }
      setTripType(""); setFee(""); setDestination("")
      setDestMode(null)
      await loadGroups(profile.userId)
      await openDetail(data.id, { justCreated: true })
    } finally { setBusy(false) }
  }

  // Builds the "การ์ดเชิญ" Flex Message — ทริป · จุดหมาย · ค่าใช้จ่าย/หัว ·
  // ปุ่มเข้าร่วม — posted into whichever LINE chat the user picks below.
  function buildInviteFlex(d: GroupDetail) {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    const joinUrl = liffId
      ? `https://liff.line.me/${liffId}/liff/join/${d.shareToken}?type=split`
      : `${getAppUrl()}/split/join/${d.shareToken}`
    const perPerson = d.participants.find(p => p.isMe)?.amount ?? d.participants[0]?.amount ?? d.fee

    const rows: any[] = []
    if (d.destination) {
      rows.push({ type: "box", layout: "baseline", spacing: "sm", contents: [
        { type: "text", text: "📍", flex: 0, size: "sm" },
        { type: "text", text: d.destination, size: "sm", color: "#555555", margin: "md", wrap: true },
      ]})
    }
    rows.push({ type: "box", layout: "baseline", spacing: "sm", contents: [
      { type: "text", text: "💰", flex: 0, size: "sm" },
      { type: "text", text: `${fmtTHB(perPerson)} / คน  (รวม ${fmtTHB(d.fee)})`, size: "sm", color: "#555555", margin: "md", wrap: true },
    ]})

    return {
      type: "flex",
      altText: `${d.emoji} ชวนไปทริป ${d.title} — ${fmtTHB(perPerson)}/คน`,
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: `${d.emoji} ${d.title}`, weight: "bold", size: "lg", wrap: true },
            { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: rows },
          ],
        },
        footer: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: [
            { type: "button", style: "primary", color: "#0284c7", height: "sm",
              action: { type: "uri", label: "🙋 เข้าร่วม / ดูรายละเอียด", uri: joinUrl } },
          ],
        },
      },
    }
  }

  // เลือกกลุ่ม LINE ที่จะโพสต์คำเชิญ → bot โพสการ์ดเชิญลงในกลุ่มที่เลือก
  async function shareInviteCard() {
    if (!detail) return
    try {
      const mod = await import("@line/liff")
      const liff = mod.default
      if (liff.isApiAvailable?.("shareTargetPicker")) {
        await liff.shareTargetPicker([buildInviteFlex(detail) as any])
        setJustCreated(false)
        return
      }
    } catch { /* fall through to clipboard */ }
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    const url = liffId
      ? `https://liff.line.me/${liffId}/liff/join/${detail.shareToken}?type=split`
      : `${getAppUrl()}/split/join/${detail.shareToken}`
    try { await navigator.clipboard.writeText(url) } catch {}
    setJustCreated(false)
  }

  // ───────────────────────────────────────────────────────── render helpers

  function Header({ title, onBack }: { title: string; onBack?: () => void }) {
    return (
      <div className="flex items-center gap-2 mb-4">
        {onBack && (
          <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <h1 className="text-lg font-bold flex-1">{title}</h1>
      </div>
    )
  }

  // ── Checking LIFF state ──────────────────────────────────────────────────
  if (authStatus === "checking") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-7 h-7 animate-spin text-sky-600" />
        <p className="text-xs text-muted-foreground">กำลังเชื่อมต่อกับ LINE...</p>
      </div>
    )
  }

  // ── Opened outside the LINE app (external browser) ───────────────────────
  if (authStatus === "outsideLine") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg">✈️</div>
          <p className="font-semibold mb-1">เปิดจากแอป LINE เท่านั้น</p>
          <p className="text-sm text-muted-foreground">แตะเมนู "กลุ่มทริป" จากแชท Slippy ในแอป LINE เพื่อเข้าใช้งานแดชบอร์ดนี้</p>
        </div>
      </div>
    )
  }

  // ── LINE-branded login screen (only shown for LIFF — never the Slippy web login) ──
  if (authStatus === "needLogin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#06C755]/10 via-white to-sky-50 dark:from-[#06C755]/5 dark:via-slate-900 dark:to-slate-900">
        <div className="text-center max-w-xs w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#06C755] flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">
            💬
          </div>
          <p className="font-bold text-lg mb-1">เข้าสู่ระบบด้วยบัญชี LINE</p>
          <p className="text-sm text-muted-foreground mb-6">
            ✈️ กลุ่มทริป Slippy ใช้บัญชี LINE ของคุณเพื่อระบุตัวตน — ไม่ต้องสมัครสมาชิกใหม่
            หรือใช้รหัสผ่านใดๆ ทั้งสิ้น
          </p>
          <button
            onClick={handleLineLogin}
            disabled={loggingIn}
            className="w-full h-12 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-60 transition-colors"
          >
            {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-base">💬</span>}
            เข้าสู่ระบบด้วย LINE
          </button>
          <p className="text-xs text-muted-foreground mt-4">
            Powered by Slippy · AI Life Assistant
          </p>
        </div>
      </div>
    )
  }

  // ── Real error from the LIFF SDK (init / login / getProfile) ─────────────
  if (authStatus === "authError") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <p className="font-semibold mb-1">เชื่อมต่อกับ LINE ไม่สำเร็จ</p>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 mb-4 break-words">{authError}</p>
          <button onClick={init} className="text-sm text-brand-500 hover:underline font-medium">↻ ลองเชื่อมต่อใหม่</button>
        </div>
      </div>
    )
  }

  if (!profile) return null // unreachable — authStatus === "ready" implies profile is set

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4 pb-10">
      <div className="max-w-md mx-auto">

        {error && (
          <div className="mb-3 flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="font-bold">×</button>
          </div>
        )}

        {/* ───────────── LIST VIEW ───────────── */}
        {view === "list" && (
          <>
            <div className="flex items-center gap-3 mb-5">
              {profile.pictureUrl && <img src={profile.pictureUrl} className="w-10 h-10 rounded-full border-2 border-white shadow" alt="" />}
              <div>
                <p className="text-xs text-muted-foreground">สวัสดี 👋</p>
                <p className="font-bold">{profile.displayName}</p>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h1 className="text-lg font-bold flex items-center gap-1.5">✈️ กลุ่มทริปของฉัน</h1>
              <button
                onClick={() => { setView("create"); setError(""); setDestMode(null) }}
                className="h-9 px-3.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
              >
                <Plus className="w-4 h-4" /> สร้างกลุ่ม
              </button>
            </div>

            {needsConnect && (
              <div className="mb-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <p>💡 ยังไม่ได้เชื่อมบัญชี — เชื่อมก่อนเพื่อสร้าง/จัดการกลุ่มได้เต็มรูปแบบ (ดูยังได้ตามปกติ)</p>
                <a
                  href="/api/auth/line?next=/liff/trip"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#06C755] text-white text-xs font-semibold active:scale-95 transition-transform"
                >
                  เข้าสู่ระบบด้วย LINE (เชื่อมอัตโนมัติ)
                </a>
                <p className="text-amber-700/80 dark:text-amber-300/70">หรือพิมพ์ <b>/connect CODE</b> ในแชท Slippy</p>
              </div>
            )}

            {groups === null && (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>
            )}

            {groups?.length === 0 && (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">✈️</p>
                <p className="font-semibold">ยังไม่มีกลุ่มทริป</p>
                <p className="text-sm text-muted-foreground mt-1">กดปุ่ม "สร้างกลุ่ม" เพื่อตั้งกลุ่มแรกของคุณ</p>
              </div>
            )}

            <div className="space-y-2.5">
              {groups?.map(g => (
                <button
                  key={g.id}
                  onClick={() => openDetail(g.id)}
                  className="w-full text-left bg-card border rounded-2xl p-4 shadow-sm hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-100 to-blue-100 dark:from-sky-500/20 dark:to-blue-500/20 flex items-center justify-center text-2xl shrink-0">
                    {g.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold truncate">{g.title}</p>
                      {g.status === "finalized" && (
                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> ปิดแล้ว
                        </span>
                      )}
                    </div>
                    {g.destination && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{g.destination}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-sky-600 dark:text-sky-400">{fmtTHB(g.fee)}</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{g.headCount} คน</span>
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" />{g.paidCount}/{g.headCount} จ่ายแล้ว</span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* ───────────── CREATE VIEW ───────────── */}
        {view === "create" && (
          <>
            <Header title="สร้างกลุ่มทริปใหม่" onBack={() => setView("list")} />
            <div className="bg-card border rounded-2xl p-4 shadow-sm space-y-4">
              <div>
                <p className="text-sm font-semibold mb-2">เลือกธีมทริป</p>
                <div className="grid grid-cols-3 gap-2">
                  {TRIP_OPTIONS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => setTripType(s.label)}
                      className={cn(
                        "rounded-xl border-2 py-2.5 flex flex-col items-center gap-1 text-xs font-medium transition-colors",
                        tripType === s.label ? "border-sky-500 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-transparent bg-muted/50"
                      )}
                    >
                      <span className="text-xl">{s.emoji}</span>{s.label}
                    </button>
                  ))}
                </div>
                <input
                  value={tripType} onChange={e => setTripType(e.target.value)}
                  placeholder="หรือพิมพ์เอง เช่น เที่ยวเชียงใหม่"
                  className="mt-2 w-full h-10 rounded-xl border px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                />
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">ค่าใช้จ่ายรวม (บาท)</p>
                <input
                  type="number" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)}
                  placeholder="เช่น 3000"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                />
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">จุดหมาย (ไม่บังคับ)</p>

                {destination && (
                  <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 px-3 h-11">
                    <MapPin className="w-4 h-4 text-sky-600 shrink-0" />
                    <span className="flex-1 text-sm font-medium truncate">{destination}</span>
                    <button onClick={() => { setDestination(""); setDestMode(null) }}
                      className="text-xs text-sky-600 font-semibold shrink-0">เปลี่ยน</button>
                  </div>
                )}

                {!destination && destMode === null && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        sessionStorage.removeItem("slippy_place_picker_result")
                        sessionStorage.setItem("slippy_trip_create_draft", JSON.stringify({ tripType, fee }))
                        router.push(`/liff/places?picker=trip&lineUserId=${profile?.userId ?? ""}`)
                      }}
                      className="h-11 rounded-xl border-2 border-transparent bg-muted/50 flex flex-col items-center justify-center gap-0.5 text-xs font-medium"
                    >
                      <Navigation className="w-4 h-4" /> เลือกจากแผนที่
                    </button>
                    <button
                      onClick={() => setDestMode("manual")}
                      className="h-11 rounded-xl border-2 border-transparent bg-muted/50 flex flex-col items-center justify-center gap-0.5 text-xs font-medium"
                    >
                      <Pencil className="w-4 h-4" /> พิมพ์เอง
                    </button>
                  </div>
                )}

                {!destination && destMode === "manual" && (
                  <div className="space-y-2">
                    <input
                      value={destination} onChange={e => setDestination(e.target.value)}
                      placeholder="เช่น ภูเก็ต"
                      autoFocus
                      className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                    />
                    <button onClick={() => setDestMode(null)} className="text-xs text-muted-foreground">← เลือกวิธีอื่น</button>
                  </div>
                )}
              </div>

              <button
                onClick={createGroup}
                disabled={!tripType || !fee || Number(fee) <= 0 || busy}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "สร้างกลุ่ม →"}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                💡 ระบบจะหารค่าใช้จ่ายเท่าๆ กันให้อัตโนมัติเมื่อเพื่อนเข้าร่วม
              </p>
            </div>
          </>
        )}

        {/* ───────────── DETAIL VIEW ───────────── */}
        {view === "detail" && detail && (
          <>
            <Header title={`${detail.emoji} ${detail.title}`} onBack={() => { setView("list"); setDetail(null); setJustCreated(false) }} />

            {/* Tab bar */}
            <div className="flex rounded-xl bg-muted/50 p-1 mb-4 gap-1">
              {([
                { id: "overview", label: "📋 ภาพรวม" },
                { id: "itinerary", label: "📅 แผนการเดินทาง" },
                { id: "settlements", label: "💰 สรุปยอด" },
              ] as { id: DetailTab; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setDetailTab(tab.id)
                    if (tab.id === "itinerary" && itineraryDays.length === 0) loadItinerary(detail.id)
                    if (tab.id === "settlements") loadSettlements(detail.id)
                  }}
                  className={cn(
                    "flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors",
                    detailTab === tab.id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── OVERVIEW TAB ── */}
            {detailTab === "overview" && (
              <>
                {/* เลือกกลุ่ม LINE ที่จะโพสต์คำเชิญ — shown once right after a new
                    group is created; the chosen chat receives the invite Flex card. */}
                {justCreated && (
                  <div className="mb-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3">
                    <span className="text-2xl shrink-0">🎉</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-800">สร้างกลุ่มสำเร็จ!</p>
                      <p className="text-xs text-amber-700 mt-0.5">เลือกกลุ่ม LINE เพื่อโพสต์การ์ดเชิญให้เพื่อน</p>
                    </div>
                    <button onClick={shareInviteCard} disabled={busy}
                      className="h-9 px-3.5 rounded-xl bg-amber-500 text-white text-xs font-semibold shrink-0 active:scale-95 transition-transform disabled:opacity-50">
                      เลือกกลุ่ม
                    </button>
                  </div>
                )}

                <div className="bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl p-4 text-white shadow-lg mb-3">
                  {detail.destination && <p className="text-sm text-white/80 flex items-center gap-1 mb-1"><MapPin className="w-3.5 h-3.5" />{detail.destination}</p>}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-white/70">ยอดรวม</p>
                      <p className="text-2xl font-black">{fmtTHB(detail.fee)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/70">ต่อคน</p>
                      <p className="text-lg font-bold">{fmtTHB(detail.participants[0]?.amount ?? detail.fee)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-white/80">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{detail.participants.length} คน</span>
                    <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{fmtTHB(detail.paidTotal)} จ่ายแล้ว</span>
                    {detail.status === "finalized" && (
                      <span className="ml-auto flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5"><Lock className="w-3 h-3" />ปิดกลุ่มแล้ว</span>
                    )}
                  </div>
                </div>

                <div className="bg-card border rounded-2xl overflow-hidden shadow-sm mb-3">
                  <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1">รายชื่อ ({detail.participants.length})</p>
                  {detail.participants.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2.5 border-t first:border-t-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {p.paid ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                        <span className={cn("text-sm truncate", p.isMe && "font-bold")}>{p.name}{p.isMe && " (คุณ)"}</span>
                      </div>
                      <span className={cn("text-sm font-semibold shrink-0", p.paid ? "text-emerald-600" : "text-muted-foreground")}>{fmtTHB(p.amount)}</span>
                    </div>
                  ))}
                </div>

                {/* PromptPay QR — scan to pay (dynamic, with my amount embedded) */}
                {detail.status !== "finalized" && (() => {
                  const me = detail.participants.find(p => p.isMe)
                  return me && !me.paid && me.amount > 0 ? (
                    <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 rounded-2xl p-4 mb-3 text-center">
                      {qrDataUrl ? (
                        <>
                          <p className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-2 flex items-center justify-center gap-1">
                            <QrCode className="w-4 h-4" /> สแกน PromptPay เพื่อโอน {fmtTHB(me.amount)}
                          </p>
                          <img src={qrDataUrl} alt="PromptPay QR" className="w-44 h-44 mx-auto rounded-xl bg-white p-2 border" />
                        </>
                      ) : detail.isCreator ? (
                        <p className="text-xs text-sky-700 dark:text-sky-300">
                          💡 เพิ่มเบอร์ PromptPay เพื่อสร้าง QR ให้สมาชิกสแกนโอนเงิน
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">ผู้สร้างกลุ่มยังไม่ได้ตั้งค่า PromptPay</p>
                      )}

                      {detail.isCreator && (
                        editingPromptpay ? (
                          <div className="flex items-center gap-1.5 mt-2">
                            <input
                              value={promptpayDraft} onChange={e => setPromptpayDraft(e.target.value)}
                              placeholder="เบอร์ PromptPay เช่น 0812345678"
                              className="flex-1 h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                            />
                            <button onClick={() => savePromptPay(promptpayDraft)} disabled={busy} className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingPromptpay(false)} className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setPromptpayDraft(detail.promptpayId ?? ""); setEditingPromptpay(true) }}
                            className="mt-2 text-xs text-sky-700 dark:text-sky-300 underline underline-offset-2 flex items-center justify-center gap-1 mx-auto"
                          >
                            <Pencil className="w-3 h-3" /> {detail.promptpayId ? "เปลี่ยนเบอร์ PromptPay" : "เพิ่มเบอร์ PromptPay"}
                          </button>
                        )
                      )}
                    </div>
                  ) : null
                })()}

                <div className="space-y-2">
                  {detail.status !== "finalized" && (
                    <>
                      {detail.participants.find(p => p.isMe) ? (
                        <button
                          onClick={() => doAction(detail.participants.find(p => p.isMe)?.paid ? "unpay" : "pay")}
                          disabled={busy}
                          className={cn(
                            "w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50",
                            detail.participants.find(p => p.isMe)?.paid
                              ? "bg-muted text-foreground border"
                              : "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md"
                          )}
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : detail.participants.find(p => p.isMe)?.paid ? "↺ ยกเลิกการจ่าย" : "✅ จ่ายแล้ว — กดยืนยัน"}
                        </button>
                      ) : (
                        <button
                          onClick={() => doAction("join")}
                          disabled={busy}
                          className="w-full h-11 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "🙋 เข้าร่วมกลุ่มนี้"}
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={shareInviteCard} className="h-10 rounded-xl border font-medium text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                          <Share2 className="w-4 h-4" /> ส่งการ์ดเชิญ
                        </button>
                        <button
                          onClick={() => doAction("finalize")}
                          disabled={busy}
                          className="h-10 rounded-xl border font-medium text-sm flex items-center justify-center gap-1.5 text-rose-600 border-rose-200 dark:border-rose-500/30 active:scale-95 transition-transform disabled:opacity-50"
                        >
                          <Lock className="w-4 h-4" /> ปิดกลุ่ม / สรุปยอด
                        </button>
                      </div>
                    </>
                  )}
                  {detail.status === "finalized" && (
                    <button onClick={shareInviteCard} className="w-full h-10 rounded-xl border font-medium text-sm flex items-center justify-center gap-1.5">
                      <Share2 className="w-4 h-4" /> แชร์สรุปยอด
                    </button>
                  )}
                  <button onClick={() => refreshDetail(detail.id)} className="w-full text-xs text-muted-foreground py-1">
                    ↻ รีเฟรชสถานะ
                  </button>
                </div>
              </>
            )}

            {/* ── ITINERARY TAB ── */}
            {detailTab === "itinerary" && (
              <div className="space-y-3">
                {itineraryLoading && (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-sky-500" /></div>
                )}
                {!itineraryLoading && itineraryDays.length === 0 && (
                  <div className="text-center py-10">
                    <p className="text-3xl mb-2">📅</p>
                    <p className="font-semibold text-sm">ยังไม่มีแผนการเดินทาง</p>
                    <p className="text-xs text-muted-foreground mt-1">กดปุ่มด้านล่างเพื่อเพิ่มวันแรก</p>
                  </div>
                )}

                {itineraryDays.map(day => (
                  <div key={day.id} className="bg-card border rounded-2xl overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between px-4 py-3 bg-sky-50 dark:bg-sky-500/10 border-b">
                      <div>
                        <p className="font-bold text-sm">วันที่ {day.dayNumber} — {day.title}</p>
                        {day.date && <p className="text-xs text-muted-foreground mt-0.5">{new Date(day.date).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}</p>}
                      </div>
                    </div>

                    {day.items.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-3">ยังไม่มีกิจกรรม</p>
                    )}

                    {day.items.map(item => (
                      <div key={item.id} className="flex items-start gap-2.5 px-4 py-2.5 border-t first:border-t-0">
                        <span className="text-lg shrink-0 mt-0.5">{TYPE_EMOJI[item.type] ?? "📌"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.timeFrom && (
                              <span className="text-[10px] font-semibold bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded-full shrink-0">
                                {item.timeFrom}{item.timeTo ? ` – ${item.timeTo}` : ""}
                              </span>
                            )}
                            <p className="text-sm font-semibold truncate">{item.title}</p>
                          </div>
                          {item.location && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{item.location}</p>}
                          {item.amount && item.amount > 0 && <p className="text-xs font-semibold text-sky-600 mt-0.5">{fmtTHB(item.amount)}</p>}
                        </div>
                        {detail.isCreator && (
                          <button onClick={() => removeItem(detail.id, day.id, item.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-50 shrink-0 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Add item form */}
                    {detail.isCreator && addingItemDayId === day.id ? (
                      <div className="px-4 py-3 border-t bg-muted/30 space-y-2">
                        <div className="flex gap-1 flex-wrap">
                          {ITEM_TYPE_OPTIONS.map(o => (
                            <button
                              key={o.type}
                              onClick={() => setNewItemType(o.type)}
                              className={cn(
                                "h-7 px-2 rounded-lg text-xs font-medium border transition-colors",
                                newItemType === o.type ? "border-sky-500 bg-sky-50 dark:bg-sky-500/20 text-sky-700" : "border-transparent bg-muted/50"
                              )}
                            >
                              {o.emoji} {o.label}
                            </button>
                          ))}
                        </div>
                        <input
                          value={newItemTitle} onChange={e => setNewItemTitle(e.target.value)}
                          placeholder="ชื่อกิจกรรม *"
                          className="w-full h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={newItemLocation} onChange={e => setNewItemLocation(e.target.value)}
                            placeholder="สถานที่"
                            className="h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                          />
                          <input
                            value={newItemAmount} onChange={e => setNewItemAmount(e.target.value)}
                            type="number" inputMode="decimal" placeholder="ราคา (บาท)"
                            className="h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                          />
                        </div>
                        <input
                          value={newItemTimeFrom} onChange={e => setNewItemTimeFrom(e.target.value)}
                          type="time" placeholder="เวลาเริ่ม"
                          className="w-full h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => addItem(detail.id, day.id)}
                            disabled={!newItemTitle.trim() || busy}
                            className="flex-1 h-9 rounded-lg bg-sky-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "บันทึก"}
                          </button>
                          <button
                            onClick={() => { setAddingItemDayId(null); setNewItemTitle(""); setNewItemLocation(""); setNewItemAmount(""); setNewItemTimeFrom("") }}
                            className="h-9 px-3 rounded-lg border text-sm"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : detail.isCreator ? (
                      <button
                        onClick={() => { setAddingItemDayId(day.id); setNewItemType("activity"); setNewItemTitle(""); setNewItemLocation(""); setNewItemAmount(""); setNewItemTimeFrom("") }}
                        className="w-full py-2 text-xs text-sky-600 font-medium border-t flex items-center justify-center gap-1 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> เพิ่มกิจกรรม
                      </button>
                    ) : null}
                  </div>
                ))}

                {detail.isCreator && (
                  <button
                    onClick={() => addDay(detail.id)}
                    disabled={busy}
                    className="w-full h-11 rounded-xl border-2 border-dashed border-sky-300 dark:border-sky-500/40 text-sky-600 dark:text-sky-400 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> เพิ่มวัน</>}
                  </button>
                )}
              </div>
            )}

            {/* ── SETTLEMENTS TAB ── */}
            {detailTab === "settlements" && (
              <div className="space-y-3">
                {settlementsLoading && (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-sky-500" /></div>
                )}

                {detail.isCreator && (
                  <button
                    onClick={() => computeSettlements(detail.id)}
                    disabled={busy}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔄 คำนวณยอดสุทธิ"}
                  </button>
                )}

                {!settlementsLoading && settlements.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-3xl mb-2">💰</p>
                    <p className="font-semibold text-sm">ยังไม่มีข้อมูลการชำระ</p>
                    {detail.isCreator && <p className="text-xs text-muted-foreground mt-1">กดปุ่มด้านบนเพื่อคำนวณ</p>}
                  </div>
                )}

                {settlements.map((s, idx) => (
                  <div key={s.id ?? idx} className={cn(
                    "bg-card border rounded-2xl p-3.5 flex items-center gap-3",
                    s.settled && "opacity-60"
                  )}>
                    <span className="text-xl shrink-0">{s.settled ? "✅" : "🧾"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{s.fromName} ต้องโอน {fmtTHB(s.amount)} ให้ {s.toName}</p>
                      {s.settled && s.settledAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">ชำระแล้ว {new Date(s.settledAt).toLocaleDateString("th-TH")}</p>
                      )}
                    </div>
                    {detail.isCreator && !s.settled && s.id && (
                      <button
                        onClick={() => markSettled(detail.id, s.id!)}
                        disabled={busy}
                        className="h-8 px-3 rounded-lg bg-emerald-500 text-white text-xs font-semibold shrink-0 disabled:opacity-50"
                      >
                        ✅ ชำระแล้ว
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
