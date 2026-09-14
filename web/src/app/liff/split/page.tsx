/**
 * /liff/split — "หารบิล" Dashboard (LIFF mini-app, "à la KhunThong")
 *
 * Opens INSIDE LINE app — generic even-split bill (no document, no sport/trip
 * theme). Mirrors /liff/sport and /liff/trip (same auth flow, same even-split
 * mechanics via split_bills.category='general') with a minimal create-form:
 * title + total amount + optional note.
 *
 * Views: list → create → detail
 */

"use client"

import { Fragment, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import QRCode from "qrcode"
import { getAppUrl } from "@/lib/app-url"
import { cn } from "@/lib/utils"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { useAppLoading } from "@/lib/loading"
import {
  Loader2, AlertCircle, Plus, Users, ChevronLeft,
  CheckCircle2, Circle, Share2, Lock, ArrowRight, QrCode, Pencil, Check, X,
  Receipt, ImagePlus, UserPlus, Trash2, Search, Send, MessageCircle,
} from "lucide-react"

type View = "list" | "create" | "detail"

interface GroupSummary {
  id: string; title: string; note: string | null
  fee: number; status: string; shareToken: string
  createdAt: string; paidCount: number; headCount: number
}
interface NamedGuest { id: string; name: string }
interface Participant {
  id: string; name: string; amount: number; paid: boolean; isMe: boolean; userId: string | null
  avatarUrl: string | null
  guests: NamedGuest[]
}
interface GroupDetail {
  id: string; title: string; note: string | null
  fee: number; status: string; shareToken: string
  promptpayId: string | null; receiptUrl: string | null; isCreator: boolean
  splitMode: "equal" | "custom" | "itemized"; allocationDetails: {
    creator?: { detail?: string; paymentMethod?: string }
    members?: { name: string; detail?: string; paymentMethod?: string }[]
  }
  receipts: { id: string; url: string | null; title: string | null; amount: number; expenseDate: string; mealType: string; payerName: string | null; documentId: string | null }[]
  participants: Participant[]; paidTotal: number
}
interface FriendOption { friendshipId: string; friend: { id: string; full_name: string; avatar_url: string | null } }

function fmtTHB(n: number) {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const PAYMENT_METHODS = [
  { value: "transfer", label: "โอนเงิน" },
  { value: "cash", label: "เงินสด" },
  { value: "card", label: "บัตร" },
  { value: "other", label: "อื่นๆ" },
] as const

function paymentLabel(value?: string) {
  return PAYMENT_METHODS.find(m => m.value === value)?.label ?? "โอนเงิน"
}

function ParticipantAvatar({ participant, size = "w-9 h-9" }: { participant: Participant; size?: string }) {
  return participant.avatarUrl ? (
    <img src={participant.avatarUrl} alt={participant.name} className={cn(size, "rounded-full object-cover border-2 border-white/80 shrink-0")} />
  ) : (
    <div className={cn(size, "rounded-full bg-indigo-500 text-white text-xs font-black flex items-center justify-center border-2 border-white/80 shrink-0")}>
      {participant.name[0]?.toUpperCase() ?? "?"}
    </div>
  )
}

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"

export default function LiffSplitDashboard() {
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
  const [title, setTitle] = useState("")
  const [fee, setFee]     = useState("")
  const [note, setNote]   = useState("")
  const [receiptFile, setReceiptFile]   = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [receiptPayerName, setReceiptPayerName] = useState("__creator__")
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receiptMealType, setReceiptMealType] = useState("other")
  const [summaryScope, setSummaryScope] = useState<"trip" | "day" | "meal">("trip")
  const [splitMode, setSplitMode] = useState<"equal" | "custom" | "itemized">("equal")
  const [creatorDetail, setCreatorDetail] = useState("")
  const [creatorPaymentMethod, setCreatorPaymentMethod] = useState("transfer")
  const [members, setMembers] = useState<{ name: string; amount: string; detail: string; paymentMethod: string }[]>([])

  // เพิ่มสมาชิกใหม่ในหน้ารายละเอียดบิล (เฉพาะผู้สร้างบิล)
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberTab, setAddMemberTab] = useState<"manual" | "friend">("manual")
  const [newMemberName, setNewMemberName]     = useState("")
  const [newMemberAmount, setNewMemberAmount] = useState("")
  const [friendOptions, setFriendOptions]   = useState<FriendOption[] | null>(null)
  const [friendQuery, setFriendQuery]       = useState("")
  const [friendSearching, setFriendSearching] = useState(false)

  // ส่ง QR เตือนจ่ายเงินให้ผู้เข้าร่วมคนใดคนหนึ่ง (เฉพาะผู้สร้างบิล)
  const [qrShareFor, setQrShareFor] = useState<Participant | null>(null)
  const [sendingQr, setSendingQr]   = useState<"line" | "inapp" | null>(null)

  // ปรับยอดที่ต้องชำระของผู้ร่วมบิล (เฉพาะผู้สร้างบิล)
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null)
  const [amountDraft, setAmountDraft] = useState("")

  function handleReceiptChange(file: File | null) {
    setReceiptFile(file)
    if (receiptPreview) URL.revokeObjectURL(receiptPreview)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  // Set right after a new bill is created — shows the "เลือกกลุ่ม LINE เพื่อ
  // โพสต์คำเชิญ" prompt on the detail page.
  const [justCreated, setJustCreated] = useState(false)

  // PromptPay QR for the payment section
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [editingPromptpay, setEditingPromptpay] = useState(false)
  const [promptpayDraft, setPromptpayDraft] = useState("")

  useEffect(() => { init() }, [])

  // Generate the PromptPay QR (with this user's amount embedded) whenever the
  // bill's PromptPay ID or my outstanding amount changes.
  useEffect(() => {
    const me = detail?.participants.find(p => p.isMe)
    if (!detail?.promptpayId || !me || me.amount <= 0) { setQrDataUrl(null); return }
    QRCode.toDataURL(buildPromptPayPayload(detail.promptpayId, me.amount), { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [detail?.promptpayId, detail?.participants])

  // Arriving from "/liff/places" via "🆕 สร้างกลุ่ม" on a place card — seed the
  // create form's title/note from the chosen place.
  useEffect(() => {
    if (searchParams.get("seedPlace") !== "1") return
    const raw = sessionStorage.getItem("slippy_place_group_seed")
    if (raw) {
      try {
        const place = JSON.parse(raw) as { name: string; address: string }
        setTitle(`หารบิลที่ ${place.name}`)
        setNote(place.address ?? "")
      } catch {}
      sessionStorage.removeItem("slippy_place_group_seed")
    }
    setView("create")
    router.replace("/liff/split")
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
      const res = await fetch(`/api/liff/split-groups?lineUserId=${userId}`)
      const data = await res.json()
      if (data.needsConnect) setNeedsConnect(true)
      setGroups(data.groups ?? [])
    } catch { setError("โหลดรายการบิลไม่สำเร็จ") }
  }

  async function openDetail(id: string, opts?: { justCreated?: boolean }) {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${id}?lineUserId=${profile.userId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ไม่พบบิล"); return }
      setDetail(data.group)
      setView("detail")
      setJustCreated(!!opts?.justCreated)
    } finally { setBusy(false) }
  }

  async function refreshDetail(id: string) {
    if (!profile) return
    const res = await fetch(`/api/liff/split-groups/${id}?lineUserId=${profile.userId}`)
    const data = await res.json()
    if (res.ok) setDetail(data.group)
  }

  async function doAction(action: "join" | "pay" | "unpay" | "finalize") {
    if (!profile || !detail) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
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
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
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
    if (!profile || !title.trim() || !fee) return
    setBusy(true); setError("")
    try {
      const form = new FormData()
      form.set("lineUserId", profile.userId)
      form.set("displayName", profile.displayName)
      form.set("title", title.trim())
      form.set("fee", fee)
      form.set("allocationMode", splitMode)
      form.set("creatorDetail", creatorDetail)
      form.set("creatorPaymentMethod", creatorPaymentMethod)
      form.set("receiptPayerName", receiptPayerName)
      form.set("receiptDate", receiptDate)
      form.set("receiptMealType", receiptMealType)
      if (profile.pictureUrl) form.set("linePictureUrl", profile.pictureUrl)
      if (note.trim()) form.set("note", note.trim())
      form.set("members", JSON.stringify(
        members.filter(m => m.name.trim()).map(m => ({
          name: m.name.trim(), amount: splitMode === "equal" ? undefined : (m.amount ? Number(m.amount) : undefined),
          detail: m.detail.trim(), paymentMethod: m.paymentMethod,
        }))
      ))
      if (receiptFile) form.set("receipt", receiptFile)

      const res = await fetch("/api/liff/split-groups", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) {
        if (data.needsConnect) setNeedsConnect(true)
        setError(data.error ?? "สร้างบิลไม่สำเร็จ")
        return
      }
      setTitle(""); setFee(""); setNote("")
      handleReceiptChange(null); setMembers([]); setSplitMode("equal"); setCreatorDetail(""); setCreatorPaymentMethod("transfer"); setReceiptPayerName("__creator__")
      await loadGroups(profile.userId)
      await openDetail(data.id, { justCreated: true })
    } catch {
      setError("สร้างบิลไม่สำเร็จ — กรุณาลองใหม่")
    } finally { setBusy(false) }
  }

  // เพิ่มรายชื่อผู้ร่วมบิล (ในหน้ารายละเอียด, เฉพาะผู้สร้างบิล)
  async function addParticipant() {
    if (!profile || !detail || !newMemberName.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addParticipant", lineUserId: profile.userId,
          name: newMemberName.trim(),
          amount: newMemberAmount ? Number(newMemberAmount) : 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "เพิ่มรายชื่อไม่สำเร็จ"); return }
      setDetail(data.group)
      setNewMemberName(""); setNewMemberAmount(""); setAddingMember(false)
    } finally { setBusy(false) }
  }

  // โหลดรายชื่อเพื่อนในระบบ (friendships ที่ accepted แล้ว) — แท็บ "เพื่อนในระบบ"
  async function loadFriendOptions() {
    if (!profile) return
    setFriendSearching(true)
    try {
      const res = await fetch(`/api/liff/friends?lineUserId=${profile.userId}`)
      const data = await res.json()
      setFriendOptions(data.friends ?? [])
    } catch {
      setFriendOptions([])
    } finally { setFriendSearching(false) }
  }

  // เพิ่มผู้ร่วมบิลจากเพื่อนในระบบ
  async function addParticipantFromFriend(friendUserId: string) {
    if (!profile || !detail) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addParticipant", lineUserId: profile.userId,
          friendUserId, amount: newMemberAmount ? Number(newMemberAmount) : 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "เพิ่มรายชื่อไม่สำเร็จ"); return }
      setDetail(data.group)
      setNewMemberAmount(""); setAddingMember(false); setFriendQuery("")
    } finally { setBusy(false) }
  }

  // ส่ง QR เตือนจ่ายเงินทาง LINE (shareTargetPicker) — ใช้ได้กับทุกคน ไม่ต้องเชื่อมระบบ
  async function shareQrViaLine(p: Participant) {
    if (!detail) return
    setSendingQr("line")
    try {
      const mod = await import("@line/liff")
      const liff = mod.default
      if (liff.isApiAvailable?.("shareTargetPicker")) {
        await liff.shareTargetPicker([buildQrFlex(detail, p) as any])
      }
    } catch { /* ผู้ใช้ปิด picker หรือไม่รองรับ — เงียบไว้ */ }
    finally { setSendingQr(null); setQrShareFor(null) }
  }

  // ส่ง QR เตือนจ่ายเงินในแอป (เฉพาะผู้เข้าร่วมที่เชื่อมต่อระบบแล้ว) — โพสต์เป็นข้อความขอเงินในแชท
  async function sendQrInApp(p: Participant) {
    if (!profile || !detail) return
    setSendingQr("inapp")
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}/send-qr`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: profile.userId, participantId: p.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ส่ง QR ไม่สำเร็จ"); return }
    } finally { setSendingQr(null); setQrShareFor(null) }
  }

  // ปรับยอดที่ต้องชำระของผู้ร่วมบิล (ในหน้ารายละเอียด, เฉพาะผู้สร้างบิล)
  async function saveAmount(participantId: string) {
    if (!profile || !detail || amountDraft === "") return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setAmount", lineUserId: profile.userId, participantId, amount: Number(amountDraft) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ปรับยอดไม่สำเร็จ"); return }
      setDetail(data.group)
      setEditingAmountId(null)
    } finally { setBusy(false) }
  }

  // ลบเพื่อนที่ลงชื่อไว้ — ทำได้โดยคนที่เพิ่ม หรือผู้สร้างบิล
  async function removeGuest(participantId: string) {
    if (!profile || !detail) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/split-groups/${detail.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeGuest", lineUserId: profile.userId, participantId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ลบไม่สำเร็จ"); return }
      setDetail(data.group)
    } finally { setBusy(false) }
  }

  function allocationFor(d: GroupDetail, p: Participant) {
    if (p.isMe && d.allocationDetails?.creator) return d.allocationDetails.creator
    return d.allocationDetails?.members?.find(m => m.name === p.name) ?? {}
  }

  // Builds the "การ์ดเชิญ" Flex Message — ชื่อบิล · หมายเหตุ · ค่าใช้จ่าย/หัว ·
  // ปุ่มเข้าร่วม — posted into whichever LINE chat the user picks below.
  function buildInviteFlex(d: GroupDetail) {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    const joinUrl = liffId
      ? `https://liff.line.me/${liffId}/liff/join/${d.shareToken}?type=split`
      : `${getAppUrl()}/split/join/${d.shareToken}`
    const perPerson = d.participants.find(p => p.isMe)?.amount ?? d.participants[0]?.amount ?? d.fee

    const rows: any[] = []
    if (d.note) {
      rows.push({ type: "box", layout: "baseline", spacing: "sm", contents: [
        { type: "text", text: "📝", flex: 0, size: "sm" },
        { type: "text", text: d.note, size: "sm", color: "#555555", margin: "md", wrap: true },
      ]})
    }
    rows.push({ type: "box", layout: "baseline", spacing: "sm", contents: [
      { type: "text", text: "💰", flex: 0, size: "sm" },
      { type: "text", text: `${fmtTHB(perPerson)} / คน  (รวม ${fmtTHB(d.fee)})`, size: "sm", color: "#555555", margin: "md", wrap: true },
    ]})
    for (const p of d.participants.slice(0, 10)) {
      const allocation = allocationFor(d, p)
      const suffix = [allocation.detail, paymentLabel(allocation.paymentMethod)].filter(Boolean).join(" · ")
      rows.push({ type: "box", layout: "baseline", spacing: "sm", contents: [
        { type: "text", text: p.name, size: "sm", color: "#333333", flex: 5, wrap: true },
        { type: "text", text: `${fmtTHB(p.amount)}${suffix ? `\n${suffix}` : ""}`, size: "sm", color: "#e11d48", align: "end", flex: 5, wrap: true },
      ]})
    }

    return {
      type: "flex",
      altText: `🧾 ชวนหารบิล ${d.title} — ${fmtTHB(perPerson)}/คน`,
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: `🧾 ${d.title}`, weight: "bold", size: "lg", wrap: true },
            { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: rows },
          ],
        },
        footer: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: [
            { type: "button", style: "primary", color: "#e11d48", height: "sm",
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

  // Builds a Flex Message carrying the PromptPay QR (as an image, rendered via
  // qrserver.com — same technique as /pay/[id]) for one participant's amount.
  // Posted into whichever LINE chat the user picks via shareTargetPicker.
  function buildQrFlex(d: GroupDetail, p: Participant) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${
      encodeURIComponent(buildPromptPayPayload(d.promptpayId!, p.amount))}`
    return {
      type: "flex",
      altText: `💸 ขอเงิน ${fmtTHB(p.amount)} — ${d.title}`,
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: `🧾 ${d.title}`, weight: "bold", size: "lg", wrap: true },
            { type: "text", text: `ขอเงินจาก ${p.name} · ${fmtTHB(p.amount)}`, size: "sm", color: "#555555", wrap: true },
            { type: "image", url: qrImageUrl, aspectMode: "fit", aspectRatio: "1:1", margin: "md" },
            { type: "text", text: "สแกน QR ด้วยแอปธนาคารเพื่อโอน", size: "xs", color: "#888888", align: "center" },
          ],
        },
      },
    }
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-rose-50 to-orange-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-7 h-7 animate-spin text-rose-600" />
        <p className="text-xs text-muted-foreground">กำลังเชื่อมต่อกับ LINE...</p>
      </div>
    )
  }

  // ── Opened outside the LINE app (external browser) ───────────────────────
  if (authStatus === "outsideLine") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg">🧾</div>
          <p className="font-semibold mb-1">เปิดจากแอป LINE เท่านั้น</p>
          <p className="text-sm text-muted-foreground">แตะเมนู "หารบิล" จากแชท Slippy ในแอป LINE เพื่อเข้าใช้งานแดชบอร์ดนี้</p>
        </div>
      </div>
    )
  }

  // ── LINE-branded login screen (only shown for LIFF — never the Slippy web login) ──
  if (authStatus === "needLogin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#06C755]/10 via-white to-rose-50 dark:from-[#06C755]/5 dark:via-slate-900 dark:to-slate-900">
        <div className="text-center max-w-xs w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#06C755] flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">
            💬
          </div>
          <p className="font-bold text-lg mb-1">เข้าสู่ระบบด้วยบัญชี LINE</p>
          <p className="text-sm text-muted-foreground mb-6">
            🧾 หารบิล Slippy ใช้บัญชี LINE ของคุณเพื่อระบุตัวตน — ไม่ต้องสมัครสมาชิกใหม่
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
    <div className="min-h-screen bg-gradient-to-br from-rose-50 to-orange-50 dark:from-slate-900 dark:to-slate-800 p-4 pb-10">
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
              <h1 className="text-lg font-bold flex items-center gap-1.5">🧾 หารบิลของฉัน</h1>
              <button
                onClick={() => { setView("create"); setError("") }}
                className="h-9 px-3.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 text-white text-sm font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
              >
                <Plus className="w-4 h-4" /> สร้างบิล
              </button>
            </div>

            {needsConnect && (
              <div className="mb-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <p>💡 ยังไม่ได้เชื่อมบัญชี — เชื่อมก่อนเพื่อสร้าง/จัดการบิลได้เต็มรูปแบบ (ดูยังได้ตามปกติ)</p>
                <a
                  href="/api/auth/line?next=/liff/split"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#06C755] text-white text-xs font-semibold active:scale-95 transition-transform"
                >
                  เข้าสู่ระบบด้วย LINE (เชื่อมอัตโนมัติ)
                </a>
                <p className="text-amber-700/80 dark:text-amber-300/70">หรือพิมพ์ <b>/connect CODE</b> ในแชท Slippy</p>
              </div>
            )}

            {groups === null && (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-rose-500" /></div>
            )}

            {groups?.length === 0 && (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">🧾</p>
                <p className="font-semibold">ยังไม่มีบิลที่หาร</p>
                <p className="text-sm text-muted-foreground mt-1">กดปุ่ม "สร้างบิล" เพื่อเริ่มหารค่าใช้จ่ายแรกของคุณ</p>
              </div>
            )}

            <div className="space-y-2.5">
              {groups?.map(g => (
                <button
                  key={g.id}
                  onClick={() => openDetail(g.id)}
                  className="w-full text-left bg-card border rounded-2xl p-4 shadow-sm hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-100 to-orange-100 dark:from-rose-500/20 dark:to-orange-500/20 flex items-center justify-center text-2xl shrink-0">
                    🧾
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
                    {g.note && <p className="text-xs text-muted-foreground truncate mt-0.5">{g.note}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtTHB(g.fee)}</span>
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
            <Header title="สร้างบิลหารใหม่" onBack={() => setView("list")} />
            <div className="bg-card border rounded-2xl p-4 shadow-sm space-y-4">
              <div>
                <p className="text-sm font-semibold mb-2">ชื่อบิล</p>
                <input
                  value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="เช่น ค่าข้าวเย็น, ค่าหอพักเดือนนี้"
                  autoFocus
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                />
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">ยอดรวม (บาท)</p>
                <input
                  type="number" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)}
                  placeholder="เช่น 1200"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                />
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">รูปแบบการหาร</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["equal", "หารเท่ากัน", "เฉลี่ยทุกคน"],
                    ["custom", "กำหนดเอง", "ใส่ยอดรายคน"],
                    ["itemized", "ตามรายการ", "ระบุว่าใครจ่ายอะไร"],
                  ] as const).map(([value, label, hint]) => (
                    <button key={value} type="button" onClick={() => setSplitMode(value)}
                      className={cn("min-h-16 rounded-xl border px-2 py-2 text-center transition-colors", splitMode === value && "border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/10")}>
                      <span className="block text-xs font-bold">{label}</span>
                      <span className="block text-[10px] opacity-70 mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">หมายเหตุ (ไม่บังคับ)</p>
                <input
                  value={note} onChange={e => setNote(e.target.value)}
                  placeholder="เช่น ร้านอาหารญี่ปุ่น"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                />
              </div>

              {/* ใบเสร็จ / สลิป (ไม่บังคับ) */}
              <div>
                <p className="text-sm font-semibold mb-2">ใบเสร็จ (ไม่บังคับ)</p>
                {receiptPreview ? (
                  <div className="rounded-xl overflow-hidden border">
                    <div className="relative">
                      <img src={receiptPreview} alt="ใบเสร็จ" className="w-full max-h-56 object-contain bg-muted" />
                      <button onClick={() => handleReceiptChange(null)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="p-3 bg-background">
                      <label className="text-xs font-semibold block mb-1.5">ใครเป็นผู้จ่ายใบเสร็จนี้ไปก่อน</label>
                      <select value={receiptPayerName} onChange={e => setReceiptPayerName(e.target.value)} className="w-full h-10 rounded-lg border bg-background px-3 text-sm">
                        <option value="__creator__">{profile?.displayName ?? "คุณ"} (คุณ)</option>
                        {members.filter(m => m.name.trim()).map((m, i) => <option key={`${m.name}-${i}`} value={m.name.trim()}>{m.name.trim()}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1">วันที่ใช้จ่าย</label>
                          <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className="w-full h-10 rounded-lg border bg-background px-2 text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1">มื้อ / ช่วงเวลา</label>
                          <select value={receiptMealType} onChange={e => setReceiptMealType(e.target.value)} className="w-full h-10 rounded-lg border bg-background px-2 text-xs">
                            <option value="breakfast">🌅 มื้อเช้า</option><option value="lunch">☀️ มื้อกลางวัน</option><option value="dinner">🌙 มื้อเย็น</option><option value="snack">🍡 ของว่าง</option><option value="other">🧾 ค่าใช้จ่ายอื่น</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1.5">ยอดนี้จะถูกนับเป็นเงินที่คนนี้สำรองจ่าย ไม่ใช่ยอดชำระคืน</p>
                    </div>
                  </div>
                ) : (
                  <label className="w-full h-24 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors">
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-xs">แตะเพื่อแนบรูปใบเสร็จ / สลิป</span>
                    <input
                      type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => handleReceiptChange(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
              </div>

              {/* รายชื่อและการจัดสรรยอด */}
              <div>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">ใครจ่ายอะไร เท่าไหร่</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">เพิ่มรายละเอียดให้ครบก่อนบันทึกบิล</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">คุณ</div>
                      <span className="text-sm font-semibold flex-1 truncate">{profile?.displayName ?? "คุณ"}</span>
                      <select value={creatorPaymentMethod} onChange={e => setCreatorPaymentMethod(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-xs">
                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    {splitMode === "itemized" && <input value={creatorDetail} onChange={e => setCreatorDetail(e.target.value)} placeholder="รายการของคุณ เช่น ข้าวผัด + น้ำ" className="w-full h-10 rounded-lg border px-3 text-sm outline-none focus:border-rose-500" />}
                  </div>
                  {members.map((m, i) => (
                    <div key={i} className="rounded-xl border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={m.name} onChange={e => setMembers(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder={`ชื่อเพื่อนคนที่ ${i + 1}`} className="flex-1 min-w-0 h-10 rounded-lg border px-3 text-sm outline-none focus:border-rose-500" />
                        {splitMode !== "equal" && <input type="number" inputMode="decimal" value={m.amount} onChange={e => setMembers(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="บาท" className="w-20 h-10 rounded-lg border px-2 text-sm text-right outline-none focus:border-rose-500" />}
                        <button onClick={() => setMembers(prev => prev.filter((_, j) => j !== i))} className="w-10 h-10 rounded-lg border flex items-center justify-center text-muted-foreground shrink-0"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="flex gap-2">
                        {splitMode === "itemized" && <input value={m.detail} onChange={e => setMembers(prev => prev.map((x, j) => j === i ? { ...x, detail: e.target.value } : x))} placeholder="รายการ เช่น สเต๊ก + โค้ก" className="flex-1 min-w-0 h-10 rounded-lg border px-3 text-sm outline-none focus:border-rose-500" />}
                        <select value={m.paymentMethod} onChange={e => setMembers(prev => prev.map((x, j) => j === i ? { ...x, paymentMethod: e.target.value } : x))} className="h-10 rounded-lg border bg-background px-2 text-xs">
                          {PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setMembers(prev => [...prev, { name: "", amount: "", detail: "", paymentMethod: "transfer" }])}
                    className="w-full h-11 rounded-xl border border-dashed flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" /> เพิ่มเพื่อน
                  </button>
                </div>
              </div>

              {fee && Number(fee) > 0 && (
                <div className="rounded-xl bg-slate-900 text-white p-3.5">
                  <div className="flex justify-between items-center mb-2"><p className="text-xs font-bold">สรุปก่อนบันทึก</p><span className="text-xs text-white/60">{1 + members.filter(m => m.name.trim()).length} คน</span></div>
                  <div className="space-y-1 text-xs">
                    {(() => {
                      const named = members.filter(m => m.name.trim())
                      const even = Number(fee) / (named.length + 1)
                      const others = named.reduce((sum, m) => sum + (Number(m.amount) || 0), 0)
                      const rows = [{ name: profile?.displayName ?? "คุณ", amount: splitMode === "equal" ? even : Math.max(0, Number(fee) - others), detail: creatorDetail }, ...named.map(m => ({ name: m.name, amount: splitMode === "equal" ? even : (Number(m.amount) || 0), detail: m.detail }))]
                      return rows.map((row, i) => <div key={`${row.name}-${i}`} className="flex gap-2"><span className="flex-1 truncate">{row.name}{row.detail ? ` · ${row.detail}` : ""}</span><span className="font-semibold">{fmtTHB(row.amount)}</span></div>)
                    })()}
                  </div>
                </div>
              )}

              <button
                onClick={createGroup}
                disabled={!title.trim() || !fee || Number(fee) <= 0 || busy}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "บันทึกบิลและดูสรุป →"}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                💡 ระบบจะหารยอดเท่าๆ กันให้อัตโนมัติเมื่อเพื่อนเข้าร่วม
              </p>
            </div>
          </>
        )}

        {/* ───────────── DETAIL VIEW ───────────── */}
        {view === "detail" && detail && (
          <>
            <Header title={`🧾 ${detail.title}`} onBack={() => { setView("list"); setDetail(null); setJustCreated(false) }} />

            {/* เลือกกลุ่ม LINE ที่จะโพสต์คำเชิญ — shown once right after a new
                bill is created; the chosen chat receives the invite Flex card. */}
            {justCreated && (
              <div className="mb-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3">
                <span className="text-2xl shrink-0">🎉</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800">สร้างบิลสำเร็จ!</p>
                  <p className="text-xs text-amber-700 mt-0.5">เลือกกลุ่ม LINE เพื่อโพสต์การ์ดเชิญให้เพื่อน</p>
                </div>
                <button onClick={shareInviteCard} disabled={busy}
                  className="h-9 px-3.5 rounded-xl bg-amber-500 text-white text-xs font-semibold shrink-0 active:scale-95 transition-transform disabled:opacity-50">
                  เลือกกลุ่ม
                </button>
              </div>
            )}

            <div className="relative overflow-hidden bg-gradient-to-br from-[#0e1527] to-[#1a2742] rounded-[22px] p-5 text-white shadow-lg mb-3 border border-[#27324d]">
              <div className="absolute right-0 top-0 w-32 h-full bg-indigo-500/10 skew-x-[-18deg] translate-x-12" />
              <div className="relative">
              <p className="text-[10px] font-bold tracking-[0.14em] text-indigo-200 mb-2">JOURNEY · EXPENSES</p>
              {detail.note && <p className="text-sm text-white/80 mb-1">{detail.note}</p>}
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
                  <span className="ml-auto flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5"><Lock className="w-3 h-3" />ปิดบิลแล้ว</span>
                )}
              </div>
              <div className="flex items-center mt-4">
                <div className="flex -space-x-2">
                  {detail.participants.slice(0, 5).map(p => <ParticipantAvatar key={p.id} participant={p} size="w-9 h-9" />)}
                </div>
                <span className="ml-3 text-[11px] text-slate-300">ผู้ร่วมเดินทาง · {detail.participants.length} คน</span>
              </div>
              </div>
            </div>

            {/* Expense summary scopes: whole trip, per day, or per meal. */}
            <div className="bg-[#0e1527] text-white border border-[#27324d] rounded-[18px] p-3.5 shadow-sm mb-3">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div><p className="text-sm font-bold">สรุปค่าใช้จ่าย</p><p className="text-[10px] text-slate-400">ภาพรวมของ Journey นี้</p></div>
                <div className="flex rounded-xl bg-[#171f35] p-1">
                  {([['trip','ทั้งทริป'],['day','รายวัน'],['meal','รายมื้อ']] as const).map(([scope, label]) => <button key={scope} onClick={() => setSummaryScope(scope)} className={cn("px-2.5 py-1.5 rounded-lg text-[10px] font-bold", summaryScope === scope ? "bg-indigo-500 text-white" : "text-slate-400")}>{label}</button>)}
                </div>
              </div>
              {(() => {
                const source = detail.receipts?.length ? detail.receipts : [{ id: 'legacy', url: detail.receiptUrl, title: detail.title, amount: detail.fee, expenseDate: '', mealType: 'other', payerName: null, documentId: null }]
                const mealNames: Record<string,string> = { breakfast:'🌅 มื้อเช้า', lunch:'☀️ มื้อกลางวัน', dinner:'🌙 มื้อเย็น', snack:'🍡 ของว่าง', other:'🧾 อื่นๆ' }
                const grouped = new Map<string, { amount: number; count: number }>()
                for (const receipt of source) {
                  const key = summaryScope === 'trip' ? 'ค่าใช้จ่ายทั้งหมด' : summaryScope === 'day' ? (receipt.expenseDate || 'ไม่ระบุวันที่') : (mealNames[receipt.mealType] ?? mealNames.other)
                  const current = grouped.get(key) ?? { amount: 0, count: 0 }; current.amount += receipt.amount; current.count += 1; grouped.set(key, current)
                }
                return <div className="space-y-2">{Array.from(grouped.entries()).map(([label, value]) => <div key={label} className="flex items-center gap-3 rounded-xl bg-[#171f35] border border-[#27324d] px-3 py-2.5"><div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center">฿</div><div className="flex-1"><p className="text-xs font-semibold">{label}</p><p className="text-[10px] text-slate-400">{value.count} ใบเสร็จ</p></div><p className="text-sm font-black text-indigo-200">{fmtTHB(value.amount)}</p></div>)}</div>
              })()}
            </div>

            {(detail.receipts?.length > 0 || detail.receiptUrl) && (
              <div className="bg-card border rounded-2xl overflow-hidden shadow-sm mb-3">
                <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5" /> ใบเสร็จ ({detail.receipts?.length || 1})
                </p>
                {(detail.receipts?.length ? detail.receipts : [{ id: "legacy", url: detail.receiptUrl, title: detail.title, amount: detail.fee, expenseDate: "", mealType: "other", payerName: null, documentId: null }]).map(receipt => (
                  <div key={receipt.id} className="px-4 pb-3 pt-1">
                    {receipt.url && <a href={receipt.url} target="_blank" rel="noreferrer"><img src={receipt.url} alt="ใบเสร็จ" className="w-full max-h-64 object-contain rounded-xl bg-muted" /></a>}
                    <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                      <span className="text-muted-foreground truncate">ผู้จ่ายก่อน: <strong className="text-foreground">{receipt.payerName ?? "ยังไม่ระบุ"}</strong></span>
                      <span className="font-bold text-rose-600">{fmtTHB(receipt.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-card border rounded-2xl overflow-hidden shadow-sm mb-3">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  รายชื่อ ({detail.participants.reduce((s, p) => s + 1 + p.guests.length, 0)})
                </p>
                {detail.isCreator && detail.status !== "finalized" && (
                  <button
                    onClick={() => { setAddingMember(true); setAddMemberTab("friend"); if (friendOptions === null) loadFriendOptions() }}
                    className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 active:scale-95 transition-transform">
                    <UserPlus className="w-3.5 h-3.5" /> เพิ่มเพื่อน
                  </button>
                )}
              </div>
              {detail.participants.map(p => {
                const canEdit = detail.isCreator && detail.status !== "finalized"
                const canSendQr = canEdit && !p.paid && p.amount > 0 && !!detail.promptpayId
                return (
                  <Fragment key={p.id}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-t first:border-t-0 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {p.paid ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                      <ParticipantAvatar participant={p} />
                      <span className={cn("text-sm truncate", p.isMe && "font-bold")}>{p.name}{p.isMe && " (คุณ)"}</span>
                      {(() => {
                        const allocation = allocationFor(detail, p)
                        return allocation.detail || allocation.paymentMethod ? (
                          <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">{allocation.detail || "ไม่ระบุรายการ"} · {paymentLabel(allocation.paymentMethod)}</span>
                        ) : null
                      })()}
                    </div>
                    {canSendQr && (
                      <button onClick={() => setQrShareFor(p)} title="ส่ง QR เตือนจ่ายเงิน"
                        className="w-7 h-7 rounded-lg border flex items-center justify-center text-muted-foreground shrink-0 active:scale-95 transition-transform">
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {editingAmountId === p.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number" inputMode="decimal" autoFocus value={amountDraft}
                          onChange={e => setAmountDraft(e.target.value)}
                          className="w-20 h-8 rounded-lg border px-2 text-sm text-right outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                        />
                        <button onClick={() => saveAmount(p.id)} disabled={busy} className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center disabled:opacity-50">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingAmountId(null)} className="w-8 h-8 rounded-lg border flex items-center justify-center">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { if (canEdit) { setEditingAmountId(p.id); setAmountDraft(String(p.amount)) } }}
                        disabled={!canEdit}
                        className={cn("flex items-center gap-1 shrink-0", canEdit && "active:opacity-60")}
                      >
                        <span className={cn("text-sm font-semibold", p.paid ? "text-emerald-600" : "text-muted-foreground")}>{fmtTHB(p.amount)}</span>
                        {canEdit && <Pencil className="w-3 h-3 text-muted-foreground/60" />}
                      </button>
                    )}
                    {/* ลบ/ยกเลิกได้แค่ตัวเอง — คนที่เข้าร่วมเองไม่มีใครลบแทนได้ */}
                    {p.isMe && detail.status !== "finalized" && (
                      <button onClick={() => removeGuest(p.id)} disabled={busy}
                        title="ยกเลิกการเข้าร่วม"
                        className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* เพื่อนที่ลงชื่อไว้ — ผูกกับ p (Tree): ไม่มียอด/สถานะของตัวเอง */}
                  {p.guests.length > 0 && (
                    <div className="border-t bg-muted/20">
                      {p.guests.map((g, gi) => {
                        // ลบได้แค่คนที่เพิ่มเข้ามาเอง (p คือคนที่เพิ่ม) — ไม่ใช่ผู้สร้างบิลทุกคน
                        const canRemove = p.isMe && detail.status !== "finalized"
                        return (
                          <div key={g.id} className="flex items-center gap-2 px-4 py-2 pl-9 text-sm text-muted-foreground">
                            <span className="text-muted-foreground/50 shrink-0">{gi === p.guests.length - 1 ? "└─" : "├─"}</span>
                            <span className="truncate flex-1">{g.name}</span>
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full shrink-0">รวมกับ {p.name}</span>
                            {canRemove && (
                              <button onClick={() => removeGuest(g.id)} disabled={busy}
                                className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0" aria-label={`ลบ ${g.name}`}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  </Fragment>
                )
              })}

              {/* เพิ่มรายชื่อผู้ร่วมบิล — เฉพาะผู้สร้างบิล */}
              {detail.isCreator && detail.status !== "finalized" && (
                addingMember ? (
                  <div className="px-4 py-2.5 border-t space-y-2.5">
                    {/* Tabs: พิมพ์ชื่อเอง | เพื่อนในระบบ */}
                    <div className="flex gap-1 bg-muted p-0.5 rounded-lg">
                      {([
                        { id: "manual", label: "✏️ พิมพ์ชื่อเอง" },
                        { id: "friend", label: "👥 เพื่อนในระบบ" },
                      ] as const).map(t => (
                        <button key={t.id} type="button"
                          onClick={() => {
                            setAddMemberTab(t.id)
                            if (t.id === "friend" && friendOptions === null) loadFriendOptions()
                          }}
                          className={cn("flex-1 h-7 rounded-md text-xs font-medium transition-colors",
                            addMemberTab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}>
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs font-semibold text-rose-600">
                      👥 ตอนนี้มีคนอยู่ในบิลแล้ว {detail.participants.reduce((s, p) => s + 1 + p.guests.length, 0)} คน
                    </p>

                    {addMemberTab === "manual" ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus value={newMemberName} onChange={e => setNewMemberName(e.target.value)}
                          placeholder="ชื่อผู้ร่วมบิล"
                          className="flex-1 min-w-0 h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                        />
                        <input
                          type="number" inputMode="decimal" value={newMemberAmount} onChange={e => setNewMemberAmount(e.target.value)}
                          placeholder="บาท"
                          className="w-20 shrink-0 h-9 rounded-lg border px-2 text-sm text-right outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                        />
                        <button onClick={addParticipant} disabled={busy || !newMemberName.trim()} className="w-9 h-9 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              value={friendQuery} onChange={e => setFriendQuery(e.target.value)}
                              placeholder="ค้นหาเพื่อน"
                              className="w-full h-9 rounded-lg border pl-8 pr-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                            />
                          </div>
                          <input
                            type="number" inputMode="decimal" value={newMemberAmount} onChange={e => setNewMemberAmount(e.target.value)}
                            placeholder="บาท"
                            className="w-20 shrink-0 h-9 rounded-lg border px-2 text-sm text-right outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                          />
                        </div>
                        {friendSearching ? (
                          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                        ) : (
                          <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                            {(friendOptions ?? [])
                              .filter(f => !friendQuery.trim() || f.friend.full_name?.toLowerCase().includes(friendQuery.trim().toLowerCase()))
                              .filter(f => !detail.participants.some(p => p.userId === f.friend.id))
                              .map(f => (
                                <button key={f.friendshipId} type="button" disabled={busy}
                                  onClick={() => addParticipantFromFriend(f.friend.id)}
                                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors disabled:opacity-50">
                                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-orange-500 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                                    {f.friend.full_name?.[0]?.toUpperCase() ?? "?"}
                                  </div>
                                  <span className="text-sm truncate flex-1">{f.friend.full_name}</span>
                                  <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                </button>
                              ))}
                            {friendOptions !== null && friendOptions.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-3">ยังไม่มีเพื่อนในระบบ — เพิ่มเพื่อนได้ที่หน้าเพื่อน</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* รายชื่อผู้เข้าร่วมตอนนี้ — แสดงสดในแผงนี้เลย พร้อมปุ่มยกเลิก
                        ไม่ต้องปิดแผงแล้วเลื่อนขึ้นไปหากล่อง "รายชื่อ" ด้านบน */}
                    <div className="pt-1">
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">ผู้เข้าร่วมตอนนี้</p>
                      <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                        {detail.participants.map(p => (
                          <Fragment key={p.id}>
                            <div className="flex items-center gap-2.5 px-3 py-2">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                                {p.name[0]?.toUpperCase() ?? "?"}
                              </div>
                              <span className="text-sm truncate flex-1">{p.name}{p.isMe && " (คุณ)"}</span>
                              {/* ลบได้แค่ตัวเอง — คนที่เข้าร่วมเองไม่มีใครลบแทนได้ */}
                              {p.isMe && detail.status !== "finalized" && (
                                <button onClick={() => removeGuest(p.id)} disabled={busy}
                                  title="ยกเลิกการเข้าร่วม" className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {p.guests.map(g => (
                              <div key={g.id} className="flex items-center gap-2 px-3 py-2 pl-9 text-sm text-muted-foreground">
                                <span className="truncate flex-1">↳ {g.name}</span>
                                {/* ลบได้แค่คนที่เพิ่มเข้ามาเอง (p คือคนที่เพิ่ม) */}
                                {p.isMe && detail.status !== "finalized" && (
                                  <button onClick={() => removeGuest(g.id)} disabled={busy}
                                    title="ยกเลิก" className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </Fragment>
                        ))}
                      </div>
                    </div>

                    <button onClick={() => { setAddingMember(false); setNewMemberName(""); setNewMemberAmount(""); setFriendQuery("") }}
                      className="w-full h-8 rounded-lg border text-xs font-medium text-muted-foreground">
                      ปิด
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingMember(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-t text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" /> เพิ่มรายชื่อผู้ร่วมบิล
                  </button>
                )
              )}
            </div>

            {/* PromptPay QR — scan to pay (dynamic, with my amount embedded) */}
            {detail.status !== "finalized" && (() => {
              const me = detail.participants.find(p => p.isMe)
              return me && !me.paid && me.amount > 0 ? (
                <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-2xl p-4 mb-3 text-center">
                  {qrDataUrl ? (
                    <>
                      <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-2 flex items-center justify-center gap-1">
                        <QrCode className="w-4 h-4" /> สแกน PromptPay เพื่อโอน {fmtTHB(me.amount)}
                      </p>
                      <img src={qrDataUrl} alt="PromptPay QR" className="w-44 h-44 mx-auto rounded-xl bg-white p-2 border" />
                    </>
                  ) : detail.isCreator ? (
                    <p className="text-xs text-rose-700 dark:text-rose-300">
                      💡 เพิ่มเบอร์ PromptPay เพื่อสร้าง QR ให้สมาชิกสแกนโอนเงิน
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">ผู้สร้างบิลยังไม่ได้ตั้งค่า PromptPay</p>
                  )}

                  {detail.isCreator && (
                    editingPromptpay ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <input
                          value={promptpayDraft} onChange={e => setPromptpayDraft(e.target.value)}
                          placeholder="เบอร์ PromptPay เช่น 0812345678"
                          className="flex-1 h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                        />
                        <button onClick={() => savePromptPay(promptpayDraft)} disabled={busy} className="w-9 h-9 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingPromptpay(false)} className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPromptpayDraft(detail.promptpayId ?? ""); setEditingPromptpay(true) }}
                        className="mt-2 text-xs text-rose-700 dark:text-rose-300 underline underline-offset-2 flex items-center justify-center gap-1 mx-auto"
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
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "🙋 เข้าร่วมบิลนี้"}
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
                      <Lock className="w-4 h-4" /> ปิดบิล / สรุปยอด
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

      </div>

      {/* ส่ง QR เตือนจ่ายเงิน — เลือกช่องทาง: LINE (shareTargetPicker) หรือในแอป (แชท) */}
      {qrShareFor && detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !sendingQr && setQrShareFor(null)} />
          <div className="relative bg-card w-full max-w-md rounded-t-2xl p-5 pb-6 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-bold">ส่ง QR เตือนจ่ายเงิน</p>
                <p className="text-xs text-muted-foreground mt-0.5">{qrShareFor.name} · {fmtTHB(qrShareFor.amount)}</p>
              </div>
              <button onClick={() => setQrShareFor(null)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <button onClick={() => shareQrViaLine(qrShareFor)} disabled={!!sendingQr}
              className="w-full h-11 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {sendingQr === "line" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-green-600" />}
              ส่งทาง LINE
            </button>

            {qrShareFor.userId ? (
              <button onClick={() => sendQrInApp(qrShareFor)} disabled={!!sendingQr}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {sendingQr === "inapp" ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                ส่งในแอป (แชท)
              </button>
            ) : (
              <p className="text-xs text-muted-foreground text-center px-2">
                {qrShareFor.name} ยังไม่เชื่อมต่อระบบ — ส่งได้ทาง LINE เท่านั้น
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
