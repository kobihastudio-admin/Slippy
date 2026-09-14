/**
 * /liff/health — Health & Medication LIFF mini-app (Slippy)
 *
 * Opens INSIDE LINE app from the Rich Menu "💊 สุขภาพ/ยา" tap-area.
 * Tabs: Overview (longevity score + health log) | Medications (list + add + detail)
 */

"use client"

import { useEffect, useState } from "react"
import { useAppLoading } from "@/lib/loading"
import {
  Loader2, AlertCircle, Plus, Heart, X, ChevronLeft,
  Pill, Package, Clock, CheckCircle2, SkipForward, AlertTriangle,
} from "lucide-react"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"
type View = "overview" | "medications" | "add-medication" | "med-detail"

// ── Health entry types ───────────────────────────────────────────────────────

interface HealthEntry {
  id: string; type: string; value: number; unit: string | null
  notes: string | null; recorded_at: string
}

const TYPE_UNITS: Record<string, string> = {
  weight: "kg", blood_pressure_systolic: "mmHg", blood_pressure_diastolic: "mmHg",
  blood_glucose: "mg/dL", steps: "steps", sleep_hours: "ชั่วโมง",
  heart_rate: "bpm", water_ml: "ml", calories: "kcal",
}
const TYPE_LABELS: Record<string, string> = {
  weight: "น้ำหนัก", blood_pressure_systolic: "ความดันโลหิต (บน)", blood_pressure_diastolic: "ความดันโลหิต (ล่าง)",
  blood_glucose: "น้ำตาลในเลือด", steps: "ก้าวเดิน", sleep_hours: "ชั่วโมงนอน",
  heart_rate: "อัตราการเต้นหัวใจ", water_ml: "น้ำที่ดื่ม", calories: "แคลอรี่",
}
const TYPE_EMOJIS: Record<string, string> = {
  weight: "⚖️", blood_pressure_systolic: "❤️", blood_pressure_diastolic: "💙",
  blood_glucose: "🩸", steps: "👟", sleep_hours: "😴",
  heart_rate: "💓", water_ml: "💧", calories: "🔥",
}
const QUICK_LOG_TYPES = ["weight", "steps", "sleep_hours", "heart_rate", "water_ml"]

// ── Medication types ─────────────────────────────────────────────────────────

interface MedSchedule {
  id: string
  medication_id: string
  times: string[]
  days_of_week: number[]
  dose_qty: number
  unit: string
  meal_relation: string
  reminder_enabled: boolean
  reminder_via: string
}

interface MedInventory {
  id: string
  medication_id: string
  qty_remaining: number
  qty_unit: string
  low_stock_alert: number
  expiry_date: string | null
  price_per_unit: number | null
}

interface MedLog {
  id: string
  medication_id: string
  schedule_id: string | null
  scheduled_at: string
  taken_at: string | null
  status: string
  notes: string | null
}

interface Medication {
  id: string
  name: string
  brand_name: string | null
  dosage_form: string
  strength: string | null
  category: string
  purpose: string | null
  is_chronic: boolean
  color: string
  schedules: MedSchedule[]
  inventory: MedInventory | null
  todayLogs: MedLog[]
}

const CATEGORY_COLORS: Record<string, string> = {
  chronic: "#ef4444",
  prescription: "#3b82f6",
  otc: "#10b981",
  supplement: "#f97316",
  vitamin: "#eab308",
}
const CATEGORY_LABELS: Record<string, string> = {
  chronic: "โรคเรื้อรัง", prescription: "ใบสั่งแพทย์",
  otc: "ยาทั่วไป", supplement: "อาหารเสริม", vitamin: "วิตามิน",
}
const DOSAGE_FORM_LABELS: Record<string, string> = {
  tablet: "เม็ด", capsule: "แคปซูล", liquid: "น้ำ",
  injection: "ฉีด", patch: "แผ่นแปะ", other: "อื่นๆ",
}
const MEAL_RELATION_LABELS: Record<string, string> = {
  before: "ก่อนอาหาร", after: "หลังอาหาร", with: "พร้อมอาหาร", any: "เมื่อไรก็ได้",
}
const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#10b981", "#3b82f6", "#8b5cf6"]

// ── ScoreGauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const r = 70
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const offset = arc - (score / 100) * arc
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#14b8a6" : score >= 40 ? "#f59e0b" : "#f87171"
  const label = score >= 80 ? "ยอดเยี่ยม" : score >= 60 ? "ดี" : score >= 40 ? "พอใช้" : "ต้องปรับปรุง"

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 180 180" className="w-full h-full -rotate-[135deg]">
          <circle cx={90} cy={90} r={r} fill="none" stroke="currentColor" strokeWidth={12}
            strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round" className="text-muted/40" />
          <circle cx={90} cy={90} r={r} fill="none" stroke={color} strokeWidth={12}
            strokeDasharray={`${arc - offset} ${circ - (arc - offset)}`} strokeLinecap="round"
            className="transition-all duration-1000" style={{ filter: `drop-shadow(0 0 8px ${color}80)` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <span className="text-3xl font-black" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="mt-1 text-xs font-semibold px-3 py-0.5 rounded-full" style={{ backgroundColor: color + "20", color }}>
        {label}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function LiffHealthDashboard() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError, setAuthError] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const [profile, setProfile] = useState<{ userId: string; displayName: string; pictureUrl?: string } | null>(null)
  const [error, setError] = useState("")
  const [needsConnect, setNeedsConnect] = useState(false)

  // Health
  const [entries, setEntries] = useState<HealthEntry[] | null>(null)
  const [longevityScore, setLongevityScore] = useState(0)
  const [busy, setBusy] = useState(false)
  const { setLoading } = useAppLoading()
  useEffect(() => {
    setLoading(busy, "Slippy กำลังดำเนินการ...")
    return () => { if (busy) setLoading(false) }
  }, [busy, setLoading])

  // Add health entry modal
  const [showModal, setShowModal] = useState(false)
  const [logType, setLogType] = useState("weight")
  const [logValue, setLogValue] = useState("")
  const [logNotes, setLogNotes] = useState("")

  // Medications
  const [medications, setMedications] = useState<Medication[] | null>(null)
  const [medsLoading, setMedsLoading] = useState(false)

  // Navigation
  const [view, setView] = useState<View>("overview")
  const [activeTab, setActiveTab] = useState<"overview" | "medications">("overview")
  const [selectedMed, setSelectedMed] = useState<Medication | null>(null)

  // Add medication form
  const [addForm, setAddForm] = useState({
    name: "", brandName: "", dosageForm: "tablet", strength: "",
    category: "prescription", purpose: "", times: ["08:00"],
    doseQty: 1, unit: "เม็ด", mealRelation: "after",
    reminderEnabled: false, qtyRemaining: 30, lowStockAlert: 7,
    color: "#3b82f6",
  })
  const [addBusy, setAddBusy] = useState(false)

  // Update inventory modal
  const [showInventoryModal, setShowInventoryModal] = useState(false)
  const [invQty, setInvQty] = useState("")
  const [invExpiry, setInvExpiry] = useState("")

  useEffect(() => { init() }, [])

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
      const prof = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl }
      setProfile(prof)
      setAuthStatus("ready")
      await Promise.all([loadHealth(prof.userId), loadMedications(prof.userId)])
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

  async function loadHealth(userId: string) {
    try {
      const res = await fetch(`/api/liff/health?lineUserId=${userId}`)
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 404) setNeedsConnect(true)
        setEntries([])
        return
      }
      setEntries(data.entries ?? [])
      setLongevityScore(data.longevityScore ?? 0)
    } catch { setError("โหลดข้อมูลสุขภาพไม่สำเร็จ") }
  }

  async function loadMedications(userId: string) {
    setMedsLoading(true)
    try {
      const res = await fetch(`/api/liff/medications?lineUserId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setMedications(data.medications ?? [])
      } else {
        setMedications([])
      }
    } catch { setMedications([]) }
    finally { setMedsLoading(false) }
  }

  async function logHealthEntry() {
    if (!profile || !logValue) return
    setBusy(true)
    try {
      const res = await fetch("/api/liff/health", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.userId, type: logType,
          value: Number(logValue), unit: TYPE_UNITS[logType],
          notes: logNotes.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "บันทึกไม่สำเร็จ"); return }
      setShowModal(false); setLogValue(""); setLogNotes("")
      await loadHealth(profile.userId)
    } finally { setBusy(false) }
  }

  async function handleMedAction(medId: string, action: "log_taken" | "log_skipped", scheduledAt: string) {
    if (!profile) return
    setBusy(true)
    try {
      await fetch(`/api/liff/medications/${medId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineUserId: profile.userId, scheduledAt }),
      })
      await loadMedications(profile.userId)
      // Refresh selected med detail
      if (selectedMed?.id === medId) {
        const updated = medications?.find(m => m.id === medId)
        if (updated) setSelectedMed(updated)
      }
    } finally { setBusy(false) }
  }

  async function handleAddMedication() {
    if (!profile || !addForm.name.trim()) return
    setAddBusy(true)
    try {
      const res = await fetch("/api/liff/medications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.userId,
          name: addForm.name.trim(),
          brandName: addForm.brandName.trim() || undefined,
          dosageForm: addForm.dosageForm,
          strength: addForm.strength.trim() || undefined,
          category: addForm.category,
          purpose: addForm.purpose.trim() || undefined,
          isChronic: addForm.category === "chronic",
          color: addForm.color,
          times: addForm.times,
          daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
          doseQty: addForm.doseQty,
          unit: addForm.unit,
          mealRelation: addForm.mealRelation,
          reminderEnabled: addForm.reminderEnabled,
          qtyRemaining: addForm.qtyRemaining,
          qtyUnit: addForm.unit,
          lowStockAlert: addForm.lowStockAlert,
        }),
      })
      if (res.ok) {
        setAddForm({
          name: "", brandName: "", dosageForm: "tablet", strength: "",
          category: "prescription", purpose: "", times: ["08:00"],
          doseQty: 1, unit: "เม็ด", mealRelation: "after",
          reminderEnabled: false, qtyRemaining: 30, lowStockAlert: 7,
          color: "#3b82f6",
        })
        setView("medications")
        setActiveTab("medications")
        await loadMedications(profile.userId)
      } else {
        const d = await res.json()
        setError(d.error ?? "เพิ่มยาไม่สำเร็จ")
      }
    } finally { setAddBusy(false) }
  }

  async function handleDeactivateMed(medId: string) {
    if (!profile) return
    setBusy(true)
    try {
      await fetch(`/api/liff/medications/${medId}?lineUserId=${profile.userId}`, { method: "DELETE" })
      setView("medications")
      setActiveTab("medications")
      setSelectedMed(null)
      await loadMedications(profile.userId)
    } finally { setBusy(false) }
  }

  async function handleUpdateInventory(medId: string) {
    if (!profile) return
    setBusy(true)
    try {
      await fetch(`/api/liff/medications/${medId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_inventory",
          lineUserId: profile.userId,
          qtyRemaining: Number(invQty),
          expiryDate: invExpiry || undefined,
        }),
      })
      setShowInventoryModal(false)
      await loadMedications(profile.userId)
    } finally { setBusy(false) }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  }

  function getTodayScheduledTimes(med: Medication): Array<{ time: string; scheduledAt: string; log: MedLog | null }> {
    if (!med.schedules.length) return []
    const schedule = med.schedules[0]
    const today = new Date()
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay()
    if (!schedule.days_of_week.includes(dayOfWeek)) return []

    return schedule.times.map(time => {
      const [hh, mm] = time.split(":").map(Number)
      const scheduled = new Date(today)
      scheduled.setHours(hh, mm, 0, 0)
      const scheduledAt = scheduled.toISOString()
      const log = med.todayLogs.find(l => {
        const logTime = new Date(l.scheduled_at)
        return Math.abs(logTime.getTime() - scheduled.getTime()) < 60 * 60 * 1000
      }) ?? null
      return { time, scheduledAt, log }
    })
  }

  // ── Auth states ──────────────────────────────────────────────────────────────

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-7 h-7 animate-spin text-teal-600" />
        <p className="text-xs text-muted-foreground">กำลังเชื่อมต่อกับ LINE...</p>
      </div>
    )
  }

  if (authStatus === "outsideLine") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg">💊</div>
          <p className="font-semibold mb-1">เปิดจากแอป LINE เท่านั้น</p>
          <p className="text-sm text-muted-foreground">แตะเมนู "สุขภาพ/ยา" จากแชท Slippy ในแอป LINE เพื่อเข้าใช้งานแดชบอร์ดนี้</p>
        </div>
      </div>
    )
  }

  if (authStatus === "needLogin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#06C755]/10 via-white to-teal-50 dark:from-[#06C755]/5 dark:via-slate-900 dark:to-slate-900">
        <div className="text-center max-w-xs w-full">
          <div className="w-16 h-16 rounded-2xl bg-[#06C755] flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg">💬</div>
          <p className="font-bold text-lg mb-1">เข้าสู่ระบบด้วยบัญชี LINE</p>
          <p className="text-sm text-muted-foreground mb-6">
            💊 สุขภาพ/ยา Slippy ใช้บัญชี LINE ของคุณเพื่อระบุตัวตน — ไม่ต้องสมัครสมาชิกใหม่หรือใช้รหัสผ่านใดๆ ทั้งสิ้น
          </p>
          <button
            onClick={handleLineLogin} disabled={loggingIn}
            className="w-full h-12 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-60 transition-colors"
          >
            {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-base">💬</span>}
            เข้าสู่ระบบด้วย LINE
          </button>
          <p className="text-xs text-muted-foreground mt-4">Powered by Slippy · AI Life Assistant</p>
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

  if (!profile) return null

  // ── Add Medication View ──────────────────────────────────────────────────────

  if (view === "add-medication") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-md mx-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
            <button onClick={() => setView("medications")} className="h-9 w-9 rounded-xl border flex items-center justify-center hover:bg-muted">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-base flex-1">เพิ่มยาใหม่</h1>
            <button
              onClick={handleAddMedication}
              disabled={addBusy || !addForm.name.trim()}
              className="h-9 px-4 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-1"
            >
              {addBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "บันทึก"}
            </button>
          </div>

          <div className="p-4 space-y-4 pb-10">
            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError("")} className="font-bold">×</button>
              </div>
            )}

            {/* Basic info */}
            <div className="bg-card border rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ข้อมูลยา</p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ชื่อยา <span className="text-rose-500">*</span></label>
                <input
                  value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น ยาลดความดัน, Metformin"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ชื่อยี่ห้อ (ไม่บังคับ)</label>
                <input
                  value={addForm.brandName} onChange={e => setAddForm(f => ({ ...f, brandName: e.target.value }))}
                  placeholder="เช่น Norvasc, Glucophage"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">รูปแบบ</label>
                  <select
                    value={addForm.dosageForm} onChange={e => setAddForm(f => ({ ...f, dosageForm: e.target.value }))}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                  >
                    {Object.entries(DOSAGE_FORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">ความแรง</label>
                  <input
                    value={addForm.strength} onChange={e => setAddForm(f => ({ ...f, strength: e.target.value }))}
                    placeholder="เช่น 5mg, 500mg"
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ประเภทยา</label>
                <select
                  value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">วัตถุประสงค์</label>
                <input
                  value={addForm.purpose} onChange={e => setAddForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder="เช่น ลดความดันโลหิต"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                />
              </div>
            </div>

            {/* Schedule */}
            <div className="bg-card border rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ตารางการทาน</p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">เวลาทาน</label>
                <div className="space-y-2">
                  {addForm.times.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time" value={t}
                        onChange={e => {
                          const newTimes = [...addForm.times]
                          newTimes[i] = e.target.value
                          setAddForm(f => ({ ...f, times: newTimes }))
                        }}
                        className="flex-1 h-10 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                      />
                      {addForm.times.length > 1 && (
                        <button
                          onClick={() => setAddForm(f => ({ ...f, times: f.times.filter((_, j) => j !== i) }))}
                          className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-rose-50 hover:border-rose-300 hover:text-rose-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setAddForm(f => ({ ...f, times: [...f.times, "12:00"] }))}
                    className="h-9 px-3 rounded-xl border border-dashed text-xs font-medium text-muted-foreground hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700 flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> เพิ่มเวลา
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">จำนวนต่อครั้ง</label>
                  <div className="flex gap-2">
                    <input
                      type="number" min={0.5} step={0.5} value={addForm.doseQty}
                      onChange={e => setAddForm(f => ({ ...f, doseQty: Number(e.target.value) }))}
                      className="w-20 h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                    />
                    <input
                      value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder="เม็ด"
                      className="flex-1 h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">ทานกับอาหาร</label>
                  <select
                    value={addForm.mealRelation} onChange={e => setAddForm(f => ({ ...f, mealRelation: e.target.value }))}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                  >
                    {Object.entries(MEAL_RELATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Inventory */}
            <div className="bg-card border rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">สต็อกเริ่มต้น</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">จำนวนที่มี</label>
                  <input
                    type="number" min={0} value={addForm.qtyRemaining}
                    onChange={e => setAddForm(f => ({ ...f, qtyRemaining: Number(e.target.value) }))}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">แจ้งเตือนเมื่อเหลือ</label>
                  <input
                    type="number" min={0} value={addForm.lowStockAlert}
                    onChange={e => setAddForm(f => ({ ...f, lowStockAlert: Number(e.target.value) }))}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 bg-background"
                  />
                </div>
              </div>
            </div>

            {/* Color */}
            <div className="bg-card border rounded-2xl p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">สีแสดงผล</p>
              <div className="flex gap-3">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c} onClick={() => setAddForm(f => ({ ...f, color: c }))}
                    className="w-9 h-9 rounded-full border-2 transition-transform active:scale-95"
                    style={{
                      backgroundColor: c,
                      borderColor: addForm.color === c ? "white" : c,
                      boxShadow: addForm.color === c ? `0 0 0 2px ${c}` : "none",
                      transform: addForm.color === c ? "scale(1.15)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Medication Detail View ───────────────────────────────────────────────────

  if (view === "med-detail" && selectedMed) {
    const med = selectedMed
    // Refresh from state
    const liveMed = medications?.find(m => m.id === med.id) ?? med
    const todayTimes = getTodayScheduledTimes(liveMed)
    const inv = liveMed.inventory
    const stockPct = inv ? Math.min(100, (inv.qty_remaining / Math.max(1, (inv.qty_remaining + inv.low_stock_alert * 2))) * 100) : null
    const isLowStock = inv ? inv.qty_remaining <= inv.low_stock_alert : false
    const catColor = CATEGORY_COLORS[liveMed.category] ?? "#3b82f6"

    // 7-day adherence
    const adherenceDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)
      // We don't have full log history here, but we can show today's from todayLogs
      const isToday = i === 6
      if (isToday) {
        const taken = todayTimes.some(t => t.log?.status === "taken")
        const skipped = todayTimes.some(t => t.log?.status === "skipped")
        return { d, taken, skipped, pending: !taken && !skipped && todayTimes.length > 0 }
      }
      return { d, taken: false, skipped: false, pending: false }
    })

    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-md mx-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
            <button onClick={() => { setView("medications"); setActiveTab("medications") }} className="h-9 w-9 rounded-xl border flex items-center justify-center hover:bg-muted">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: liveMed.color }} />
              <h1 className="font-bold text-base truncate">{liveMed.name}</h1>
            </div>
          </div>

          <div className="p-4 space-y-4 pb-10">
            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError("")} className="font-bold">×</button>
              </div>
            )}

            {/* Med info card */}
            <div className="bg-card border rounded-2xl p-4 border-l-4" style={{ borderLeftColor: liveMed.color }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: liveMed.color + "20" }}>
                  <Pill className="w-5 h-5" style={{ color: liveMed.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{liveMed.name}</p>
                  {liveMed.brand_name && <p className="text-xs text-muted-foreground">{liveMed.brand_name}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {liveMed.strength && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium">{liveMed.strength}</span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: catColor + "20", color: catColor }}>
                      {CATEGORY_LABELS[liveMed.category] ?? liveMed.category}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                      {DOSAGE_FORM_LABELS[liveMed.dosage_form] ?? liveMed.dosage_form}
                    </span>
                  </div>
                  {liveMed.purpose && (
                    <p className="text-xs text-muted-foreground mt-1.5">{liveMed.purpose}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Today's schedule */}
            <div className="bg-card border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-teal-500" />
                <p className="text-sm font-semibold">ยาวันนี้</p>
              </div>
              {todayTimes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">ไม่มีกำหนดทานยาวันนี้</p>
              ) : (
                <div className="space-y-2">
                  {todayTimes.map(({ time, scheduledAt, log }) => {
                    const isTaken = log?.status === "taken"
                    const isSkipped = log?.status === "skipped"
                    const schedule = liveMed.schedules[0]
                    return (
                      <div key={time} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                        <div className="text-center shrink-0 w-12">
                          <p className="text-sm font-bold">{time}</p>
                          <p className="text-[10px] text-muted-foreground">{MEAL_RELATION_LABELS[schedule?.meal_relation] ?? ""}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{schedule?.dose_qty} {schedule?.unit}</p>
                          {isTaken && <p className="text-xs text-emerald-600 font-medium">✅ ทานแล้ว</p>}
                          {isSkipped && <p className="text-xs text-amber-600 font-medium">⏭ ข้ามไป</p>}
                        </div>
                        {!isTaken && !isSkipped && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => handleMedAction(liveMed.id, "log_taken", scheduledAt)}
                              disabled={busy}
                              className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              ✅ ทาน
                            </button>
                            <button
                              onClick={() => handleMedAction(liveMed.id, "log_skipped", scheduledAt)}
                              disabled={busy}
                              className="h-8 px-3 rounded-lg border text-xs font-semibold hover:bg-muted disabled:opacity-50"
                            >
                              ⏭ ข้าม
                            </button>
                          </div>
                        )}
                        {(isTaken || isSkipped) && (
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isTaken ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"}`}>
                            {isTaken ? <CheckCircle2 className="w-4 h-4" /> : <SkipForward className="w-4 h-4" />}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Inventory */}
            {inv && (
              <div className="bg-card border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Package className="w-4 h-4 text-teal-500" />
                  <p className="text-sm font-semibold">สต็อกยา</p>
                  {isLowStock && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" /> ยาใกล้หมด
                    </span>
                  )}
                </div>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <p className="text-2xl font-black">{inv.qty_remaining}</p>
                    <p className="text-xs text-muted-foreground">{inv.qty_unit} คงเหลือ</p>
                  </div>
                  <div className="text-right">
                    {inv.expiry_date && (
                      <p className="text-xs text-muted-foreground">หมดอายุ {new Date(inv.expiry_date).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</p>
                    )}
                    <p className="text-xs text-muted-foreground">แจ้งเตือนเมื่อเหลือ {inv.low_stock_alert} {inv.qty_unit}</p>
                  </div>
                </div>
                {stockPct !== null && (
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${stockPct}%`, backgroundColor: isLowStock ? "#f59e0b" : "#10b981" }}
                    />
                  </div>
                )}
                <button
                  onClick={() => { setInvQty(String(inv.qty_remaining)); setInvExpiry(inv.expiry_date ?? ""); setShowInventoryModal(true) }}
                  className="w-full h-10 rounded-xl border border-teal-300 text-teal-700 dark:border-teal-600 dark:text-teal-400 text-sm font-semibold hover:bg-teal-50 dark:hover:bg-teal-500/10"
                >
                  + เติมยา / อัพเดตสต็อก
                </button>
              </div>
            )}

            {/* 7-day adherence */}
            <div className="bg-card border rounded-2xl p-4">
              <p className="text-sm font-semibold mb-3">การทานยา 7 วันที่ผ่านมา</p>
              <div className="grid grid-cols-7 gap-1">
                {adherenceDays.map(({ d, taken, skipped, pending }, i) => {
                  const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
                  const dayName = dayNames[d.getDay()]
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <p className="text-[10px] text-muted-foreground">{dayName}</p>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                        ${taken ? "bg-emerald-100 text-emerald-700" : skipped ? "bg-amber-100 text-amber-700" : pending ? "bg-muted text-muted-foreground" : "bg-muted/30 text-muted-foreground/50"}`}>
                        {taken ? "✓" : skipped ? "–" : d.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Deactivate */}
            <button
              onClick={() => handleDeactivateMed(liveMed.id)}
              disabled={busy}
              className="w-full h-11 rounded-xl border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10 disabled:opacity-50"
            >
              ปิดการใช้งานยานี้
            </button>
          </div>
        </div>

        {/* Update inventory modal */}
        {showInventoryModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowInventoryModal(false)} />
            <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">เติมยา / อัพเดตสต็อก</h3>
                <button onClick={() => setShowInventoryModal(false)} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">จำนวนคงเหลือ ({inv?.qty_unit})</label>
                  <input
                    type="number" min={0} value={invQty} onChange={e => setInvQty(e.target.value)}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">วันหมดอายุ (ไม่บังคับ)</label>
                  <input
                    type="date" value={invExpiry} onChange={e => setInvExpiry(e.target.value)}
                    className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                  />
                </div>
                <button
                  onClick={() => handleUpdateInventory(liveMed.id)}
                  disabled={busy || !invQty}
                  className="w-full h-11 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Main app with tabs ───────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b">
          <div className="px-4 pt-3 pb-0 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
              <Heart className="w-4 h-4 text-teal-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-base font-bold leading-tight">💊 สุขภาพ & ยา</h1>
            </div>
            {activeTab === "overview" && (
              <button onClick={() => { setLogType("weight"); setShowModal(true) }} className="h-8 w-8 rounded-xl border flex items-center justify-center hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600">
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* Tab bar */}
          <div className="flex px-4 mt-2">
            {(["overview", "medications"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setView(tab) }}
                className={`flex-1 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab ? "border-teal-500 text-teal-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {tab === "overview" ? "ภาพรวม" : "ยาของฉัน"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="font-bold">×</button>
          </div>
        )}

        {/* ── Overview Tab ─────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="p-4 pb-10 space-y-3">
            {needsConnect && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <p>💡 ยังไม่ได้เชื่อมบัญชี — เชื่อมก่อนเพื่อบันทึกข้อมูลสุขภาพได้</p>
                <a
                  href="/api/auth/line?next=/liff/health"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#06C755] text-white text-xs font-semibold active:scale-95 transition-transform"
                >
                  เข้าสู่ระบบด้วย LINE (เชื่อมอัตโนมัติ)
                </a>
              </div>
            )}

            {/* Longevity Score */}
            <div className="bg-card border rounded-2xl p-5 flex flex-col items-center">
              <ScoreGauge score={longevityScore} />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                คำนวณจากความสม่ำเสมอในการบันทึก biomarker
              </p>
            </div>

            {/* Today's medications summary */}
            {medications && medications.length > 0 && (() => {
              const todayMeds = medications.filter(m => getTodayScheduledTimes(m).length > 0)
              if (todayMeds.length === 0) return null
              return (
                <div className="bg-card border rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-sm font-semibold">💊 ยาวันนี้</p>
                    <button onClick={() => { setActiveTab("medications"); setView("medications") }} className="text-xs text-teal-600 font-medium">ดูทั้งหมด →</button>
                  </div>
                  <div className="space-y-2">
                    {todayMeds.slice(0, 3).map(med => {
                      const times = getTodayScheduledTimes(med)
                      const doneCount = times.filter(t => t.log?.status === "taken" || t.log?.status === "skipped").length
                      const allDone = doneCount === times.length
                      return (
                        <div key={med.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/30">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: med.color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{med.name}</p>
                            <p className="text-xs text-muted-foreground">{times.map(t => t.time).join(", ")}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!allDone ? (
                              <>
                                <button
                                  onClick={() => {
                                    const pending = times.find(t => !t.log)
                                    if (pending) handleMedAction(med.id, "log_taken", pending.scheduledAt)
                                  }}
                                  disabled={busy}
                                  className="h-7 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                                >
                                  ✅
                                </button>
                                <button
                                  onClick={() => {
                                    const pending = times.find(t => !t.log)
                                    if (pending) handleMedAction(med.id, "log_skipped", pending.scheduledAt)
                                  }}
                                  disabled={busy}
                                  className="h-7 px-2 rounded-lg border text-xs font-semibold hover:bg-muted disabled:opacity-50"
                                >
                                  ⏭
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-emerald-600 font-semibold">ครบแล้ว ✓</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Quick-log buttons */}
            <div className="bg-card border rounded-2xl p-4">
              <h3 className="text-sm font-semibold mb-2.5">บันทึกด่วน</h3>
              <div className="flex flex-wrap gap-2">
                {QUICK_LOG_TYPES.map(type => (
                  <button
                    key={type}
                    onClick={() => { setLogType(type); setShowModal(true) }}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-border text-sm font-medium hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700 dark:hover:bg-teal-500/10 dark:hover:border-teal-500 dark:hover:text-teal-400 transition-colors"
                  >
                    <span>{TYPE_EMOJIS[type]}</span>
                    <span>{TYPE_LABELS[type]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Recent health entries */}
            <div className="bg-card border rounded-2xl overflow-hidden">
              <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1">รายการล่าสุด</p>
              {entries === null && (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-teal-500" /></div>
              )}
              {entries?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                  <p className="text-3xl mb-2">🌿</p>
                  <p className="font-medium text-sm">ยังไม่มีข้อมูลสุขภาพ</p>
                  <p className="text-xs text-muted-foreground mt-1">เริ่มบันทึก biomarker เพื่อติดตาม Longevity Score ของคุณ</p>
                </div>
              )}
              {entries && entries.length > 0 && (
                <div className="divide-y">
                  {entries.slice(0, 10).map(entry => (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0 text-base">
                        {TYPE_EMOJIS[entry.type] ?? "📊"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{TYPE_LABELS[entry.type] ?? entry.type}</p>
                        {entry.notes && <p className="text-xs text-muted-foreground truncate">{entry.notes}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{entry.value} <span className="text-xs font-normal text-muted-foreground">{entry.unit}</span></p>
                        <p className="text-[10px] text-muted-foreground">{fmtDate(entry.recorded_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Medications Tab ───────────────────────────────────────── */}
        {activeTab === "medications" && (
          <div className="p-4 pb-24 space-y-3 relative">
            {medsLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
              </div>
            )}
            {!medsLoading && medications?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-teal-500/10 flex items-center justify-center text-3xl mb-3">💊</div>
                <p className="font-semibold mb-1">ยังไม่มีรายการยา</p>
                <p className="text-sm text-muted-foreground mb-4">เพิ่มยาที่ต้องทานประจำเพื่อติดตามการรับยาและสต็อก</p>
                <button
                  onClick={() => setView("add-medication")}
                  className="h-11 px-6 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-semibold text-sm flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> เพิ่มยาแรก
                </button>
              </div>
            )}
            {!medsLoading && medications && medications.length > 0 && medications.map(med => {
              const inv = med.inventory
              const isLow = inv ? inv.qty_remaining <= inv.low_stock_alert : false
              const catColor = CATEGORY_COLORS[med.category] ?? "#3b82f6"
              const todayTimes = getTodayScheduledTimes(med)
              const schedule = med.schedules[0]

              return (
                <button
                  key={med.id}
                  onClick={() => { setSelectedMed(med); setView("med-detail") }}
                  className="w-full text-left bg-card border rounded-2xl overflow-hidden hover:shadow-md transition-shadow active:scale-[0.99]"
                  style={{ borderLeftWidth: 4, borderLeftColor: med.color }}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: med.color + "20" }}>
                        <Pill className="w-5 h-5" style={{ color: med.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-sm">{med.name}</p>
                            {med.strength && <p className="text-xs text-muted-foreground">{med.strength}</p>}
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full shrink-0 font-medium" style={{ backgroundColor: catColor + "20", color: catColor }}>
                            {CATEGORY_LABELS[med.category] ?? med.category}
                          </span>
                        </div>
                        {schedule && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">{schedule.times.join(" · ")} · {MEAL_RELATION_LABELS[schedule.meal_relation]}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stock bar */}
                    {inv && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <Package className="w-3 h-3 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">สต็อก: {inv.qty_remaining} {inv.qty_unit}</p>
                          </div>
                          {isLow && (
                            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                              <AlertTriangle className="w-3 h-3" /> ใกล้หมด
                            </span>
                          )}
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, (inv.qty_remaining / Math.max(1, inv.qty_remaining + inv.low_stock_alert * 2)) * 100)}%`,
                              backgroundColor: isLow ? "#f59e0b" : "#10b981",
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Today's dose quick-action */}
                    {todayTimes.length > 0 && (() => {
                      const pending = todayTimes.find(t => !t.log)
                      if (!pending) return null
                      return (
                        <div className="mt-3 pt-3 border-t flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">เวลา {pending.time} — รอบันทึก</p>
                          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => handleMedAction(med.id, "log_taken", pending.scheduledAt)}
                              disabled={busy}
                              className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              ✅ ทาน
                            </button>
                            <button
                              onClick={() => handleMedAction(med.id, "log_skipped", pending.scheduledAt)}
                              disabled={busy}
                              className="h-7 px-2.5 rounded-lg border text-xs font-semibold hover:bg-muted disabled:opacity-50"
                            >
                              ⏭
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </button>
              )
            })}

            {/* FAB */}
            {!medsLoading && (
              <button
                onClick={() => setView("add-medication")}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-teal-500 hover:bg-teal-600 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform z-20"
              >
                <Plus className="w-6 h-6" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add health entry modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{TYPE_EMOJIS[logType]} {TYPE_LABELS[logType]}</h3>
              <button onClick={() => setShowModal(false)} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ค่า ({TYPE_UNITS[logType]})</label>
                <input
                  type="number" inputMode="decimal" autoFocus
                  value={logValue} onChange={e => setLogValue(e.target.value)}
                  placeholder="กรอกค่า"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">หมายเหตุ (ไม่บังคับ)</label>
                <input
                  value={logNotes} onChange={e => setLogNotes(e.target.value)}
                  placeholder="หมายเหตุเพิ่มเติม"
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 bg-background"
                />
              </div>
              <button
                onClick={logHealthEntry}
                disabled={!logValue || busy}
                className="w-full h-11 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> บันทึก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
