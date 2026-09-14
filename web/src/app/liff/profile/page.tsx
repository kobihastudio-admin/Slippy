/**
 * /liff/profile — Profile & Package LIFF mini-app
 *
 * Sections: Profile Card, Usage, Plan, Settings (PromptPay), Referral
 */

"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Loader2, AlertCircle, Pencil, Check, X, Copy, ChevronRight,
  User, BarChart2, Zap, Settings, Share2, Bell, Globe, Camera,
  PieChart, HeartPulse, Plane, Users, SplitSquareVertical,
} from "lucide-react"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"

interface LineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
}

interface ProfileData {
  profile: {
    lineUserId: string
    displayName: string
    pictureUrl: string | null
    organizationName: string
    connectedAt: string
  }
  usage: {
    docsThisMonth: number
    docsAllTime: number
    monthlyQuota: number
  }
  settings: {
    promptpayId: string | null
    language: string
    notifications: {
      bills: boolean
      medications: boolean
      trips: boolean
      community: boolean
    }
  }
  plan: {
    name: string
    monthlyQuota: number
    features: string[]
  }
}

export default function LiffProfilePage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError,  setAuthError]  = useState("")
  const [loggingIn,  setLoggingIn]  = useState(false)
  const [lineProfile, setLineProfile] = useState<LineProfile | null>(null)

  const [data,    setData]    = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState("")

  // PromptPay edit state
  const [editingPay,  setEditingPay]  = useState(false)
  const [payInput,    setPayInput]    = useState("")
  const [savingPay,   setSavingPay]   = useState(false)

  // Language
  const [savingLang, setSavingLang] = useState(false)

  // Notifications
  const [notifs, setNotifs] = useState<ProfileData["settings"]["notifications"]>({
    bills: true, medications: true, trips: true, community: true,
  })
  const [savingNotif, setSavingNotif] = useState(false)

  const [copiedRef, setCopiedRef] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────
  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    setAuthStatus("checking")
    setAuthError("")

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) {
      setAuthStatus("authError")
      setAuthError("ระบบยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID ไม่พบ)")
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
      const prof: LineProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl }
      setLineProfile(prof)
      setAuthStatus("ready")
      await loadProfile(prof.userId, p.pictureUrl, p.displayName)
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

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

  // ── Data ──────────────────────────────────────────────────────────────
  async function loadProfile(userId: string, liffPictureUrl?: string, liffDisplayName?: string) {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/liff/profile?lineUserId=${userId}`)
      const json = await res.json()
      if (json.needsConnect) {
        setError("กรุณาเชื่อมบัญชี LINE กับ Slippy ก่อน — พิมพ์ /connect ในแชท Slippy")
        return
      }
      setData(json)
      setPayInput(json.settings?.promptpayId ?? "")
      if (json.settings?.notifications) setNotifs(json.settings.notifications)

      // Sync LINE profile (picture + name) to DB silently so future loads use it
      if (liffPictureUrl || liffDisplayName) {
        fetch("/api/liff/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineUserId: userId,
            ...(liffPictureUrl  ? { pictureUrl:  liffPictureUrl  } : {}),
            ...(liffDisplayName ? { displayName: liffDisplayName } : {}),
          }),
        }).catch(() => {})
      }
    } catch { setError("โหลดข้อมูลโปรไฟล์ไม่สำเร็จ") }
    finally { setLoading(false) }
  }

  async function savePromptPay() {
    if (!lineProfile) return
    setSavingPay(true)
    try {
      const res = await fetch("/api/liff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: lineProfile.userId, promptpayId: payInput }),
      })
      const json = await res.json()
      if (json.ok) {
        setData(prev => prev ? { ...prev, settings: { ...prev.settings, promptpayId: payInput || null } } : prev)
        setEditingPay(false)
      }
    } finally { setSavingPay(false) }
  }

  async function saveLanguage(lang: string) {
    if (!lineProfile) return
    setSavingLang(true)
    try {
      await fetch("/api/liff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: lineProfile.userId, language: lang }),
      })
      setData(prev => prev ? { ...prev, settings: { ...prev.settings, language: lang } } : prev)
    } finally { setSavingLang(false) }
  }

  async function toggleNotif(key: keyof ProfileData["settings"]["notifications"]) {
    if (!lineProfile) return
    const updated = { ...notifs, [key]: !notifs[key] }
    setNotifs(updated)
    setSavingNotif(true)
    try {
      await fetch("/api/liff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: lineProfile.userId, notifications: updated }),
      })
    } finally { setSavingNotif(false) }
  }

  function copyReferral() {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? ""
    const link = `https://liff.line.me/${liffId}/liff/scan`
    const text = `ลอง Slippy สิ — บันทึกสลิปอัตโนมัติ 🧾\n${link}`
    navigator.clipboard.writeText(text).then(() => {
      setCopiedRef(true)
      setTimeout(() => setCopiedRef(false), 2000)
    })
  }

  // ── Auth screens ──────────────────────────────────────────────────────
  if (authStatus === "checking") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white gap-3">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
        <p className="text-sm text-gray-500">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    )
  }

  if (authStatus === "outsideLine") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-amber-500" />
        <h2 className="text-lg font-semibold text-gray-800">เปิดใน LINE เท่านั้น</h2>
        <p className="text-sm text-gray-500">กรุณาเปิดหน้านี้ผ่านแอป LINE</p>
      </div>
    )
  }

  if (authStatus === "needLogin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
          <User className="w-8 h-8 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">โปรไฟล์</h2>
          <p className="text-sm text-gray-500">กรุณาเข้าสู่ระบบด้วย LINE เพื่อใช้งาน</p>
        </div>
        <button
          onClick={handleLineLogin}
          disabled={loggingIn}
          className="w-full max-w-xs py-3 bg-green-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          เข้าสู่ระบบด้วย LINE
        </button>
      </div>
    )
  }

  if (authStatus === "authError") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-sm text-red-600">{authError}</p>
        <button onClick={init} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">ลองอีกครั้ง</button>
      </div>
    )
  }

  // ── Loading data ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 gap-3">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
        <p className="text-sm text-gray-500">กำลังโหลดโปรไฟล์...</p>
      </div>
    )
  }

  // ── Main content ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">โปรไฟล์</h1>
      </div>

      {error && (
        <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {data && (
        <div className="px-4 py-4 space-y-4">

          {/* ── 1. Profile Card ─────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 flex items-center gap-4">
            {lineProfile?.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lineProfile.pictureUrl}
                alt="avatar"
                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <User className="w-8 h-8 text-green-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-900 truncate">{lineProfile?.displayName || data.profile.displayName}</p>
              <p className="text-sm text-gray-500 truncate mt-0.5">{data.profile.organizationName}</p>
              <span className="inline-flex items-center gap-1 mt-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                เชื่อมแล้ว
              </span>
            </div>
          </div>

          {/* ── 2. Usage Card ───────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">การใช้งานเดือนนี้</h2>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">สลิป</span>
                <span className="font-semibold text-gray-900">
                  {data.usage.docsThisMonth} / {data.usage.monthlyQuota} ใบ
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className={cn(
                    "h-2.5 rounded-full transition-all",
                    data.usage.docsThisMonth / data.usage.monthlyQuota > 0.8
                      ? "bg-red-500"
                      : data.usage.docsThisMonth / data.usage.monthlyQuota > 0.6
                      ? "bg-amber-500"
                      : "bg-green-500",
                  )}
                  style={{ width: `${Math.min(100, (data.usage.docsThisMonth / data.usage.monthlyQuota) * 100)}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">รวมทั้งหมด: {data.usage.docsAllTime.toLocaleString()} ใบ</p>
          </div>

          {/* ── 3. Plan Card ────────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-700">แพ็คเกจ</h2>
              </div>
              <span className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-semibold">
                {data.plan.name}
              </span>
            </div>
            <ul className="space-y-1.5">
              {data.plan.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-3 bg-gray-100 text-gray-400 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 cursor-not-allowed"
            >
              อัพเกรดแพ็คเกจ
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">เร็วๆ นี้</span>
            </button>
          </div>

          {/* ── 4. Settings ─────────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">ตั้งค่า</h2>
            </div>

            {/* PromptPay ID */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-600">เลข PromptPay</label>
                {!editingPay && (
                  <button
                    onClick={() => { setPayInput(data.settings.promptpayId ?? ""); setEditingPay(true) }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
              {editingPay ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={payInput}
                    onChange={e => setPayInput(e.target.value)}
                    placeholder="0812345678"
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={savePromptPay}
                    disabled={savingPay}
                    className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center flex-shrink-0"
                  >
                    {savingPay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setEditingPay(false)}
                    className="w-10 h-10 bg-gray-100 text-gray-600 rounded-xl flex items-center justify-center flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-900 bg-gray-50 rounded-xl px-3 py-2">
                  {data.settings.promptpayId ?? (
                    <span className="text-gray-400 italic">ยังไม่ได้ตั้งค่า</span>
                  )}
                </p>
              )}
            </div>

            {/* Language */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">ภาษา</span>
                </div>
                <div className="flex gap-1">
                  {[{ value: "th", label: "ไทย" }, { value: "en", label: "ENG" }].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => saveLanguage(opt.value)}
                      disabled={savingLang}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                        data.settings.language === opt.value
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── 5. Notifications ────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-700">การแจ้งเตือน LINE</h2>
              </div>
              {savingNotif && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
            </div>
            {([
              { key: "bills",       label: "บิล & หารค่าใช้จ่าย" },
              { key: "medications", label: "แจ้งเตือนทานยา" },
              { key: "trips",       label: "อัพเดตทริป" },
              { key: "community",   label: "กิจกรรมกลุ่ม" },
            ] as { key: keyof typeof notifs; label: string }[]).map(item => (
              <div key={item.key} className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-700">{item.label}</span>
                <button
                  onClick={() => toggleNotif(item.key)}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                    notifs[item.key] ? "bg-green-500" : "bg-gray-200",
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                    notifs[item.key] ? "translate-x-5" : "translate-x-0",
                  )} />
                </button>
              </div>
            ))}
          </div>

          {/* ── 6. Quick Nav ────────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-1">
            <p className="text-sm font-semibold text-gray-700 mb-3">เมนูทั้งหมด</p>
            {[
              { icon: Camera,            label: "ส่งสลิป",      sub: "สแกนและอัพโหลดเอกสาร",  path: "/liff/scan"      },
              { icon: PieChart,          label: "Dashboard",     sub: "ภาพรวมและ Life Score",   path: "/liff/dashboard" },
              { icon: SplitSquareVertical, label: "หารบิล",     sub: "แบ่งค่าใช้จ่ายกัน",       path: "/liff/split"     },
              { icon: Plane,             label: "สร้างทริป",     sub: "วางแผนการเดินทาง",        path: "/liff/trip"      },
              { icon: HeartPulse,        label: "สุขภาพ & ยา",  sub: "ติดตามการทานยา",          path: "/liff/health"    },
              { icon: Users,             label: "สร้างกลุ่ม",   sub: "ชุมชนและกิจกรรม",         path: "/liff/community" },
            ].map(item => {
              const Icon = item.icon
              const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? ""
              const href = `https://liff.line.me/${liffId}${item.path}`
              return (
                <a
                  key={item.path}
                  href={href}
                  className="flex items-center gap-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-50 transition-colors">
                    <Icon className="w-4 h-4 text-gray-600 group-hover:text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-400 truncate">{item.sub}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
                </a>
              )
            })}
          </div>

          {/* ── 7. Referral ─────────────────────────────────────── */}
          <div className="bg-white rounded-2xl px-4 py-5 space-y-3">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">แนะนำเพื่อน</h2>
            </div>
            <p className="text-sm text-gray-500">แนะนำเพื่อนให้ใช้ Slippy เพื่อบันทึกสลิปอัตโนมัติ</p>
            <div className="bg-green-50 rounded-xl px-3 py-3">
              <p className="text-sm text-green-800 italic">"ลอง Slippy สิ — บันทึกสลิปอัตโนมัติ 🧾"</p>
            </div>
            <button
              onClick={copyReferral}
              className="w-full py-3 border-2 border-green-500 text-green-600 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm"
            >
              {copiedRef ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedRef ? "คัดลอกแล้ว!" : "คัดลอกข้อความแนะนำ"}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
