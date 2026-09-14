/**
 * /liff/sport/pay/[sessionId] — Dedicated payment page (LIFF mini-app)
 *
 * Opens from the "จ่ายเงิน" button on the sport bill-summary card sent into
 * the LINE group chat. Shows just this user's outstanding amount, a
 * PromptPay QR scoped to that amount, the pay/unpay button, and slip upload
 * — without the full dashboard/roster UI of /liff/sport.
 */

"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import QRCode from "qrcode"
import { cn } from "@/lib/utils"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { useAppLoading } from "@/lib/loading"
import {
  Loader2, AlertCircle, CheckCircle2, Clock, Camera, Trash2, QrCode, MapPin, Calendar, Share2, Users,
} from "lucide-react"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"

interface Participant {
  id: string; name: string; amount: number; paid: boolean; isMe: boolean
  guestCount: number; paymentProofUrl: string | null
  pendingReview: boolean; linePictureUrl: string | null
}
interface SessionDetail {
  id: string; title: string; emoji: string
  venue: string | null; fee: number; status: string
  participants: Participant[]
  bookingDate: string | null; startTime: string | null; endTime: string | null
  promptpayId: string | null
}

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
const THAI_MONTHS   = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

function fmtTHB(n: number) {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "2026-06-10" → "พุธที่ 10 มิ.ย." */
function thaiDateLabel(dateStr: string | null): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00")
  if (isNaN(d.getTime())) return ""
  return `${THAI_WEEKDAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`
}

/** "20:00" + "22:00" → "20:00 - 22:00 น." */
function timeRangeLabel(start: string | null, end: string | null): string {
  const s = start?.slice(0, 5)
  const e = end?.slice(0, 5)
  if (s && e) return `${s} - ${e} น.`
  if (s) return `${s} น.`
  return ""
}

export default function LiffSportPayPage() {
  const params    = useParams()
  const sessionId = params.sessionId as string

  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError,  setAuthError]  = useState("")
  const [profile, setProfile] = useState<{ userId: string; displayName: string } | null>(null)

  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy]   = useState(false)
  const [proofBusy, setProofBusy] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const { setLoading } = useAppLoading()
  useEffect(() => {
    setLoading(busy || proofBusy, "Slippy กำลังดำเนินการ...")
    return () => { if (busy || proofBusy) setLoading(false) }
  }, [busy, proofBusy, setLoading])

  useEffect(() => { init() }, [])

  const me = sessionDetail?.participants.find(p => p.isMe)

  // For visitors who aren't (yet) part of this group — e.g. opened the
  // "จ่ายเงิน" link from outside the LINE group — let them pick how much to
  // pay, defaulting to the average per-person share.
  const [guestAmount, setGuestAmount] = useState("")
  useEffect(() => {
    if (sessionDetail && !me && guestAmount === "") {
      const n = sessionDetail.participants.length || 1
      const suggested = Math.round((sessionDetail.fee / n) * 100) / 100
      if (suggested > 0) setGuestAmount(String(suggested))
    }
  }, [sessionDetail, me, guestAmount])

  // Personalized PromptPay QR — amount pre-filled for this participant, or
  // the guest-entered amount for non-members.
  useEffect(() => {
    const amount = me ? me.amount : Number(guestAmount) || 0
    if (!sessionDetail?.promptpayId || amount <= 0) { setQrDataUrl(null); return }
    QRCode.toDataURL(buildPromptPayPayload(sessionDetail.promptpayId, amount), { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [sessionDetail?.promptpayId, me, guestAmount])

  // Share the QR image (with payment details) via the device's share sheet —
  // lets a participant forward this to a friend outside the LINE group.
  async function shareQr() {
    if (!qrDataUrl || !sessionDetail) return
    const amount = me ? me.amount : Number(guestAmount) || 0
    try {
      const res  = await fetch(qrDataUrl)
      const blob = await res.blob()
      const file = new File([blob], "promptpay-qr.png", { type: "image/png" })
      const shareData: ShareData & { files?: File[] } = {
        title: sessionDetail.title,
        text:  `📱 PromptPay QR — ${sessionDetail.title}\nยอดที่ต้องโอน: ${fmtTHB(amount)}`,
        files: [file],
      }
      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData)
      } else if (navigator.share) {
        await navigator.share({ title: shareData.title, text: shareData.text, url: window.location.href })
      }
    } catch { /* user cancelled share — ignore */ }
  }

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
      await liff.init({ liffId })
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`เริ่มต้น LIFF ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
      return
    }

    if (!liff.isInClient()) { setAuthStatus("outsideLine"); return }
    if (!liff.isLoggedIn()) { setAuthStatus("needLogin"); return }

    try {
      const p = await liff.getProfile()
      const prof = { userId: p.userId as string, displayName: p.displayName as string }
      setProfile(prof)
      setAuthStatus("ready")
      await loadDetail(prof.userId)
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  async function handleLineLogin() {
    try {
      const mod = await import("@line/liff")
      const liff = mod.default
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! })
      liff.login({ redirectUri: window.location.href.split("#")[0] })
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`เข้าสู่ระบบด้วย LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  async function loadDetail(lineUserId: string) {
    try {
      const res  = await fetch(`/api/liff/sport-groups/sessions/${sessionId}?lineUserId=${lineUserId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ไม่พบกลุ่ม"); return }
      setSessionDetail(data.group)
    } catch {
      setError("โหลดข้อมูลไม่สำเร็จ — กรุณาลองใหม่")
    }
  }

  async function doPay(action: "pay" | "unpay") {
    if (!profile) return
    setBusy(true)
    try {
      const res = await fetch(`/api/liff/sport-groups/sessions/${sessionId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineUserId: profile.userId, displayName: profile.displayName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ทำรายการไม่สำเร็จ"); return }
      setSessionDetail(data.group)
    } finally { setBusy(false) }
  }

  async function uploadProof(file: File) {
    if (!profile) return
    setProofBusy(true)
    try {
      const form = new FormData()
      form.append("lineUserId", profile.userId)
      form.append("file", file)
      const res = await fetch(`/api/liff/sport-groups/sessions/${sessionId}/proof`, { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "อัปโหลดสลิปไม่สำเร็จ"); return }
      setSessionDetail(data.group)
    } finally { setProofBusy(false) }
  }

  async function deleteProof() {
    if (!profile) return
    setProofBusy(true)
    try {
      const res = await fetch(`/api/liff/sport-groups/sessions/${sessionId}/proof?lineUserId=${profile.userId}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ลบสลิปไม่สำเร็จ"); return }
      setSessionDetail(data.group)
    } finally { setProofBusy(false) }
  }

  // ── Auth screens ──────────────────────────────────────────────────────
  if (authStatus === "checking") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
        <p className="text-xs text-muted-foreground">กำลังเชื่อมต่อกับ LINE...</p>
      </div>
    )
  }

  if (authStatus === "outsideLine") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg">🏸</div>
          <p className="font-semibold mb-1">เปิดจากแอป LINE เท่านั้น</p>
          <p className="text-sm text-muted-foreground">แตะปุ่ม "จ่ายเงิน" จากการ์ดสรุปบิลในแชท Slippy เพื่อเปิดหน้านี้</p>
        </div>
      </div>
    )
  }

  if (authStatus === "needLogin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#06C755]/10 via-white to-violet-50 dark:from-[#06C755]/5 dark:via-slate-900 dark:to-slate-900">
        <div className="text-center max-w-xs w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#06C755] flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">💬</div>
          <p className="font-bold text-lg mb-1">เข้าสู่ระบบด้วยบัญชี LINE</p>
          <p className="text-sm text-muted-foreground mb-6">
            หน้าจ่ายเงิน Slippy ใช้บัญชี LINE ของคุณเพื่อระบุตัวตน — ไม่ต้องสมัครสมาชิกใหม่
          </p>
          <button
            onClick={handleLineLogin}
            className="w-full h-12 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md transition-colors"
          >
            <span className="text-base">💬</span> เข้าสู่ระบบด้วย LINE
          </button>
        </div>
      </div>
    )
  }

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

  // ── Loading session detail ────────────────────────────────────────────
  if (!sessionDetail) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 p-6">
        {error ? (
          <div className="text-center max-w-xs">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <>
            <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
            <p className="text-xs text-muted-foreground">กำลังโหลดบิล...</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="max-w-sm mx-auto space-y-3">

        {error && (
          <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="font-bold">×</button>
          </div>
        )}

        {/* Bill summary header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl p-4 text-white shadow-lg">
          <p className="text-lg font-black">{sessionDetail.emoji} {sessionDetail.title}</p>
          {sessionDetail.venue && (
            <p className="text-sm text-white/80 mt-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{sessionDetail.venue}</p>
          )}
          {sessionDetail.bookingDate && (
            <p className="text-sm text-white/80 mt-0.5 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {thaiDateLabel(sessionDetail.bookingDate)} {timeRangeLabel(sessionDetail.startTime, sessionDetail.endTime)}
            </p>
          )}
        </div>

        {/* My amount */}
        {me ? (
          <div className="bg-card border rounded-2xl p-4 text-center shadow-sm">
            <p className="text-xs text-muted-foreground mb-1">ยอดที่คุณต้องจ่าย</p>
            <p className="text-3xl font-black text-violet-700 dark:text-violet-300">{fmtTHB(me.amount)}</p>
            <p className={cn(
              "text-xs font-semibold mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
              me.paid ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : me.pendingReview ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                : "bg-muted text-muted-foreground"
            )}>
              {me.paid ? <><CheckCircle2 className="w-3.5 h-3.5" /> จ่ายแล้ว</> : me.pendingReview ? <><Clock className="w-3.5 h-3.5" /> รอผู้สร้างกลุ่มตรวจสอบสลิป</> : "ยังไม่จ่าย"}
            </p>
          </div>
        ) : (
          /* Non-member — not in this group's roster. Let them set their own
             amount (default = average per-person share) and pay/share the QR. */
          <div className="bg-card border rounded-2xl p-4 text-center shadow-sm space-y-2">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Users className="w-3.5 h-3.5" /> คุณไม่ได้อยู่ในรายชื่อกลุ่มนี้ — ใส่จำนวนเงินที่ต้องการโอน
            </p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-2xl font-black text-violet-700 dark:text-violet-300">฿</span>
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                value={guestAmount} onChange={e => setGuestAmount(e.target.value)}
                className="text-3xl font-black text-violet-700 dark:text-violet-300 bg-transparent w-32 text-center outline-none border-b-2 border-dashed border-violet-200 dark:border-violet-500/30"
              />
            </div>
            <p className="text-xs text-muted-foreground">ยอดรวมทั้งหมด {fmtTHB(sessionDetail.fee)} ({sessionDetail.participants.length || 1} คน)</p>
          </div>
        )}

        {/* PromptPay QR */}
        {sessionDetail.status !== "finalized" && (!me || (!me.paid && !me.pendingReview)) && (
          <div className="bg-violet-50 dark:bg-violet-500/10 border border-violet-100 dark:border-violet-500/20 rounded-2xl p-4 text-center">
            {qrDataUrl ? (
              <>
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2 flex items-center justify-center gap-1">
                  <QrCode className="w-4 h-4" /> สแกน PromptPay เพื่อโอน {fmtTHB(me ? me.amount : Number(guestAmount) || 0)}
                </p>
                <img src={qrDataUrl} alt="PromptPay QR" className="w-48 h-48 mx-auto rounded-xl bg-white p-2 border" />
                {typeof navigator !== "undefined" && !!navigator.share && (
                  <button
                    onClick={shareQr}
                    className="mt-3 w-full h-10 rounded-xl border border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 font-medium text-sm flex items-center justify-center gap-1.5"
                  >
                    <Share2 className="w-4 h-4" /> ส่ง QR นี้ให้เพื่อน
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">ผู้สร้างกลุ่มยังไม่ได้ตั้งค่า PromptPay</p>
            )}
          </div>
        )}

        {/* Slip upload */}
        {sessionDetail.status !== "finalized" && me && !me.paid && (
          <div className="bg-card border rounded-2xl p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">📸 อัปโหลดสลิป/ภาพโอนเงิน</p>
            {me.paymentProofUrl ? (
              <div className="space-y-2">
                <img src={me.paymentProofUrl} alt="สลิป" className="w-full rounded-xl border" />
                <button
                  onClick={deleteProof} disabled={proofBusy}
                  className="w-full h-10 rounded-xl border text-rose-600 border-rose-200 dark:border-rose-500/30 font-medium text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {proofBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} ลบสลิป
                </button>
              </div>
            ) : (
              <label className={cn(
                "w-full h-11 rounded-xl border-2 border-dashed border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 font-medium text-sm flex items-center justify-center gap-1.5 cursor-pointer",
                proofBusy && "opacity-50"
              )}>
                {proofBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} แตะเพื่อเลือกรูปสลิป
                <input
                  type="file" accept="image/*" className="hidden" disabled={proofBusy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f) }}
                />
              </label>
            )}
            <p className="text-xs text-muted-foreground">ผู้สร้างกลุ่มจะตรวจสอบและกดยืนยันให้ก่อนถึงจะมาร์คว่าจ่ายแล้ว</p>
          </div>
        )}

        {/* Pay / unpay */}
        {sessionDetail.status !== "finalized" && me && (
          <button
            onClick={() => doPay(me.paid ? "unpay" : "pay")}
            disabled={busy}
            className={cn(
              "w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50",
              me.paid
                ? "bg-muted text-foreground border"
                : me.pendingReview
                ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
                : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md"
            )}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : me.paid ? (
              "↺ ยกเลิกการจ่าย"
            ) : me.pendingReview ? (
              <><Clock className="w-4 h-4" /> รอผู้สร้างกลุ่มตรวจสอบสลิป</>
            ) : (
              "✅ จ่ายแล้ว — กดยืนยัน"
            )}
          </button>
        )}

        {sessionDetail.status === "finalized" && (
          <div className="bg-muted/50 rounded-xl p-4 text-center text-sm text-muted-foreground">
            กลุ่มนี้ปิดรับการชำระเงินแล้ว
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground pt-2">Powered by Slippy · AI Life Assistant</p>
      </div>
    </div>
  )
}
