"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Plus, Check, X, AlertTriangle, ChevronDown, ChevronUp, Loader2,
  Bell, BellOff, ScanLine, ShoppingCart, Send, Pencil, Trash2,
} from "lucide-react"
import { MedicationTimeline } from "./medication-timeline"
import { MedicationCourseCard } from "./medication-course-card"
import { medicationCategory } from "@/lib/activity-taxonomy"

type Schedule = { id: string; times: string[]; dose_qty: number; meal_relation: string; meal_note: string | null; reminder_enabled: boolean; is_bedtime: boolean }
type Inventory = { id: string; qty_remaining: number; qty_unit: string; qty_per_pack: number | null; low_stock_alert: number; expiry_date: string | null; loc_code: string | null; lot_no: string | null }
type Provider = { id: string; name: string; type: "hospital" | "clinic" | "pharmacy"; hn: string | null }
type Course = { id: string; status: "active" | "paused" | "stopped" | "completed"; start_date: string; planned_end_date: string | null; prescribed_by: string | null; doctor_instructions: string | null; instruction_source: "label" | "doctor" | "pharmacist" | "user" }
type Medication = {
  id: string; name: string; brand_name: string | null; dosage_form: string; strength: string | null
  category: string; purpose: string | null; is_chronic: boolean; color: string | null; notes: string | null
  provider_id: string | null; doctor_instructions: string | null; prescribed_by: string | null
  // Unlike medication_schedules/medication_inventory below, this embed
  // follows medications.provider_id -> medical_providers.id — a genuine
  // forward FK, so PostgREST returns a single object (or null), not an
  // array, same as iOS's Medication.provider: MedicalProvider?.
  provider: Provider | null
  /** A storage PATH despite the name — see the medication_label_images migration. Resolved to a signed URL on demand, never rendered directly. */
  image_url: string | null
  // PostgREST returns this embed as an array even though the app models it as
  // 1:1 — medication_inventory.medication_id has no UNIQUE constraint for
  // PostgREST to infer a to-one relation from, so it always returns a list,
  // same as medication_schedules. Take [0], not the whole array, everywhere
  // this is read (a raw `inv.qty_remaining` on an array silently reads
  // `undefined` — no runtime error, just a NaN nobody notices until it's
  // rendered, which is exactly what happened here before this was typed
  // correctly).
  medication_schedules: Schedule[]; medication_inventory: Inventory[]; medication_courses?: Course[]
}
type Log = { id: string; medication_id: string; scheduled_at: string; taken_at: string | null; status: string; dose_taken: number }
type Adherence = { medication_id: string; adherence_pct: number; taken: number; total_doses: number }

/** What GET /api/medications/reorder computes — matches ReorderItem there. */
type ReorderItem = {
  medicationId: string; name: string; brandName: string | null; strength: string | null
  qtyRemaining: number; qtyUnit: string; daysRemaining: number | null
  suggestedQty: number; reason: "low_stock" | "running_out_soon"
}

/** What POST /api/medications/scan proposes — read from a label photo, never written until reviewed. */
type ScannedMedication = {
  name: string; brand_name: string | null; generic_name: string | null
  dosage_form: string; strength: string | null; purpose: string | null
  instructions_verbatim: string | null
  times: string[]; dose_qty: number
  meal_relation: "before" | "after" | "with" | "any"; meal_note: string | null
  qty_total: number | null; qty_unit: string; expiry_date: string | null
  prescribing_doctor: string | null; hospital_name: string | null; lot_no: string | null
  confidence: number
}

const MEAL_LABEL: Record<string, string> = { before: "ก่อนอาหาร", after: "หลังอาหาร", with: "พร้อมอาหาร", any: "" }
const HEALTH_CATEGORY = medicationCategory()
const HealthIcon = HEALTH_CATEGORY.icon

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
const isLowStock = (inv: Inventory | null) => inv && Number(inv.qty_remaining) <= Number(inv.low_stock_alert)
const isExpiringSoon = (inv: Inventory | null) => {
  if (!inv?.expiry_date) return false
  return (new Date(inv.expiry_date).getTime() - Date.now()) < 30 * 86400000
}

/**
 * Days of stock left, from what's on hand ÷ what's actually being taken per
 * day — the number "จัดเวลาเดือนยาหมด" (schedule for when it runs out) needs.
 * Not `low_stock_alert` (that's a fixed threshold someone set once); this
 * recomputes from the real daily consumption every time inventory or the
 * schedule changes, so it stays right after a dose is logged.
 */
function daysRemaining(inv: Inventory | null, sched: Schedule | undefined): number | null {
  if (!inv || !sched || !sched.times.length) return null
  const perDay = Number(sched.dose_qty) * sched.times.length
  if (!perDay || !Number.isFinite(perDay)) return null
  return Math.floor(Number(inv.qty_remaining) / perDay)
}

function runOutDate(days: number | null): string | null {
  if (days == null) return null
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
}

/* ─── Add / Edit Medication Modal ────────────────────────────────────────────── */
function AddMedicationModal({ onClose, onCreate, scanned, scanIssues, existing }: {
  onClose: () => void; onCreate: () => void
  /** Pre-fill from a scanned label — still just a starting point, every field stays editable. */
  scanned?: ScannedMedication | null
  scanIssues?: string[]
  /** Set to edit this medication in place instead of creating a new one. */
  existing?: Medication | null
}) {
  const existingSched = existing?.medication_schedules[0]
  const existingInv   = existing?.medication_inventory[0]
  const [name,        setName]        = useState(existing?.name ?? scanned?.name ?? "")
  const [brand,       setBrand]       = useState(existing?.brand_name ?? scanned?.brand_name ?? "")
  const [form]                         = useState(existing?.dosage_form ?? scanned?.dosage_form ?? "tablet")
  const [strength,    setStrength]    = useState(existing?.strength ?? scanned?.strength ?? "")
  const [purpose,     setPurpose]     = useState(existing?.purpose ?? scanned?.purpose ?? "")
  const [notes,       setNotes]       = useState(existing?.notes ?? scanned?.instructions_verbatim ?? "")
  const [isChronic,   setIsChronic]   = useState(existing?.is_chronic ?? false)
  const [times,       setTimes]       = useState(existingSched?.times.length ? existingSched.times : (scanned?.times.length ? scanned.times : ["08:00"]))
  const [doseQty,     setDoseQty]     = useState(String(existingSched?.dose_qty ?? scanned?.dose_qty ?? 1))
  const [mealRelation,setMealRelation]= useState<"before" | "after" | "with" | "any">(
    (existingSched?.meal_relation as "before" | "after" | "with" | "any") ?? scanned?.meal_relation ?? "after")
  const [lowAlert,    setLowAlert]    = useState(existingInv ? String(existingInv.low_stock_alert) : "7")
  const [expiry,      setExpiry]      = useState(existingInv?.expiry_date ?? scanned?.expiry_date ?? "")
  const [reminder,    setReminder]    = useState(existingSched?.reminder_enabled ?? true)
  const [isBedtime,   setIsBedtime]   = useState(existingSched?.is_bedtime ?? false)
  const [startDate,   setStartDate]   = useState(existing?.medication_courses?.[0]?.start_date ?? new Date().toISOString().slice(0, 10))
  const [plannedEnd,  setPlannedEnd]  = useState(existing?.medication_courses?.[0]?.planned_end_date ?? "")
  const [saving,      setSaving]      = useState(false)

  // Doctor / provider / LOC / LOT — see the medication-tracking-expansion
  // plan for why provider is a real reference table, not free text.
  const [providers,       setProviders]       = useState<Provider[]>([])
  const [providerId,      setProviderId]      = useState(existing?.provider_id ?? "")
  const [showNewProvider, setShowNewProvider] = useState(false)
  const [newProvName,     setNewProvName]     = useState("")
  const [newProvType,     setNewProvType]     = useState<"hospital" | "clinic" | "pharmacy">("hospital")
  const [newProvHn,       setNewProvHn]       = useState("")
  const [savingProvider,  setSavingProvider]  = useState(false)
  const [doctorName,      setDoctorName]      = useState(existing?.prescribed_by ?? scanned?.prescribing_doctor ?? "")
  const [doctorNotes,     setDoctorNotes]     = useState(existing?.doctor_instructions ?? scanned?.instructions_verbatim ?? "")
  const [locCode,         setLocCode]         = useState(existingInv?.loc_code ?? "")
  const [lotNo,           setLotNo]           = useState(existingInv?.lot_no ?? scanned?.lot_no ?? "")

  useEffect(() => {
    fetch("/api/medications/providers").then(r => r.json()).then(j => setProviders(j.providers ?? [])).catch(() => {})
  }, [])

  const selectedProvider = providers.find(p => p.id === providerId) ?? null

  const createProvider = async () => {
    if (!newProvName.trim()) { toast.error("กรอกชื่อโรงพยาบาล/ร้านยา"); return }
    setSavingProvider(true)
    try {
      const res = await fetch("/api/medications/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProvName.trim(), type: newProvType, hn: newProvHn || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "เพิ่มไม่สำเร็จ")
      setProviders(p => [...p, json.provider])
      setProviderId(json.provider.id)
      setShowNewProvider(false)
      setNewProvName(""); setNewProvHn("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ")
    } finally {
      setSavingProvider(false)
    }
  }

  // Pack calculator — packSize seeded from qtyPerPack, falling back to the
  // current qtyRemaining (never blank when there's an existing inventory
  // row) so editing without touching either field reproduces the CURRENT
  // stock, not a full pack. alreadyTaken is derived the same way, so
  // computedRemaining === qtyRemaining by default on edit. See the iOS
  // fix (AddMedicationView.swift) this mirrors — same bug, same fix.
  const packSizeSeed = existingInv?.qty_per_pack ?? scanned?.qty_total ?? existingInv?.qty_remaining
  const [qtyPerPack,   setQtyPerPack]   = useState(packSizeSeed != null ? String(Math.round(packSizeSeed)) : "")
  const [alreadyTaken, setAlreadyTaken] = useState(
    existingInv ? String(Math.max(Math.round((packSizeSeed ?? existingInv.qty_remaining) - existingInv.qty_remaining), 0)) : ""
  )
  const computedRemaining = Math.max((Number(qtyPerPack) || 0) - (Number(alreadyTaken) || 0), 0)

  const addTime = () => setTimes(t => [...t, "12:00"])
  const removeTime = (i: number) => setTimes(t => t.filter((_, j) => j !== i))

  const handleSave = async () => {
    if (!name.trim()) { toast.error("กรอกชื่อยา"); return }
    setSaving(true)
    try {
      const res = existing
        ? await fetch(`/api/medications/${existing.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(), brand_name: brand || null,
              dosage_form: form, strength: strength || null, purpose: purpose || null,
              notes: notes.trim() || null,
              provider_id: providerId || null, doctor_instructions: doctorNotes || null,
              prescribed_by: doctorName || null,
              scheduleId: existingSched?.id, times, dose_qty: Number(doseQty) || 1,
              meal_relation: mealRelation, reminder_enabled: reminder, is_bedtime: isBedtime,
              inventoryId: existingInv?.id, qty_remaining: computedRemaining,
              qty_per_pack: Number(qtyPerPack) || null,
              low_stock_alert: Number(lowAlert) || 7, expiry_date: expiry || null,
              loc_code: locCode || null, lot_no: lotNo || null,
            }),
          })
        : await fetch("/api/medications", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(), brand_name: brand || null,
              dosage_form: form, strength: strength || null,
              purpose: purpose || null, is_chronic: isChronic,
              notes: notes.trim() || null,
              provider_id: providerId || undefined, doctor_instructions: doctorNotes || undefined,
              prescribed_by: doctorName || undefined,
              instruction_source: scanned?.instructions_verbatim ? "label" : "user",
              start_date: startDate, planned_end_date: plannedEnd || null,
              times, dose_qty: Number(doseQty) || 1,
              meal_relation: mealRelation, reminder_enabled: reminder, is_bedtime: isBedtime,
              qty_total: computedRemaining, qty_per_pack: Number(qtyPerPack) || undefined,
              low_stock_alert: Number(lowAlert) || 7, expiry_date: expiry || null,
              loc_code: locCode || undefined, lot_no: lotNo || undefined,
            }),
          })
      if (!res.ok) throw new Error()
      toast.success(existing ? "บันทึกการแก้ไขแล้ว ✏️" : "เพิ่มยาแล้ว 💊")
      onCreate()
      onClose()
    } catch { toast.error("เกิดข้อผิดพลาด") } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-semibold">{existing ? "แก้ไขยา" : scanned ? "ตรวจสอบก่อนบันทึก" : "เพิ่มยา"}</h3>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>

          {scanned && (
            <div className="rounded-[10px] border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/5 p-3 space-y-1.5">
              <p className="text-[11.5px] font-semibold text-brand-700 dark:text-brand-400 flex items-center gap-1.5">
                <ScanLine className="w-3.5 h-3.5" />อ่านจากฉลากยา — ตรวจให้ตรงกับซองยาก่อนบันทึก
              </p>
              {scanned.instructions_verbatim && (
                <p className="text-[11.5px] text-muted-foreground">&ldquo;{scanned.instructions_verbatim}&rdquo;</p>
              )}
              {(scanned.hospital_name || scanned.prescribing_doctor) && (
                <p className="text-[11px] text-muted-foreground">
                  {scanned.hospital_name}{scanned.hospital_name && scanned.prescribing_doctor ? " · " : ""}{scanned.prescribing_doctor}
                </p>
              )}
              {!scanned.times.length && (
                <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />อ่านช่วงเวลาไม่ได้ — ใส่เวลาแจ้งเตือนเองด้านล่าง
                </p>
              )}
              {scanIssues?.map((s, i) => (
                <p key={i} className="text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{s}
                </p>
              ))}
            </div>
          )}

          {/* Basic info */}
          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อยา *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น ยาลดความดัน, วิตามินซี"
              className="w-full h-10 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อการค้า</label>
              <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Norvasc, ..."
                className="w-full h-9 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ความแรง</label>
              <input value={strength} onChange={e => setStrength(e.target.value)} placeholder="5mg, 500mg"
                className="w-full h-9 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ใช้สำหรับ</label>
            <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="ลดความดัน, วิตามิน, ..."
              className="w-full h-9 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
          </div>
          <div>
            <label className="text-[11.5px] font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
              หมายเหตุจากฉลาก
              {scanned && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700">สแกนจากฉลาก</span>}
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="ข้อความวิธีใช้หรือคำเตือนบนฉลากยา"
              className="w-full rounded-[10px] border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500 resize-y" />
            {scanned && <p className="mt-1 text-[10.5px] text-muted-foreground">บันทึกอัตโนมัติจากฉลาก กรุณาตรวจสอบก่อนยืนยัน</p>}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isChronic} onChange={e => setIsChronic(e.target.checked)} className="rounded" />
            <span className="text-sm">ยาเรื้อรัง (กินต่อเนื่องระยะยาว)</span>
          </label>

          {/* Provider / doctor */}
          <div className="border-t pt-4 space-y-2">
            <p className="text-sm font-semibold">แหล่งที่มา / แพทย์ผู้สั่ง</p>
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">โรงพยาบาล/คลินิก/ร้านยา</label>
              <select value={providerId} onChange={e => setProviderId(e.target.value)}
                className="w-full h-9 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500">
                <option value="">ไม่ระบุ</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.hn ? ` (HN ${p.hn})` : ""}</option>)}
              </select>
              {!showNewProvider ? (
                <button onClick={() => setShowNewProvider(true)} className="text-xs text-brand-500 font-medium mt-1">+ เพิ่มใหม่</button>
              ) : (
                <div className="mt-2 p-2.5 rounded-[10px] border bg-muted/30 space-y-2">
                  <input value={newProvName} onChange={e => setNewProvName(e.target.value)} placeholder="ชื่อโรงพยาบาล/คลินิก/ร้านยา"
                    className="w-full h-8 rounded-[8px] border bg-background px-2 text-xs outline-none focus:border-brand-500" />
                  <div className="flex gap-2">
                    <select value={newProvType} onChange={e => setNewProvType(e.target.value as typeof newProvType)}
                      className="flex-1 h-8 rounded-[8px] border bg-background px-2 text-xs outline-none focus:border-brand-500">
                      <option value="hospital">โรงพยาบาล</option>
                      <option value="clinic">คลินิก</option>
                      <option value="pharmacy">ร้านยา</option>
                    </select>
                    {newProvType === "hospital" && (
                      <input value={newProvHn} onChange={e => setNewProvHn(e.target.value)} placeholder="HN"
                        className="w-24 h-8 rounded-[8px] border bg-background px-2 text-xs outline-none focus:border-brand-500" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createProvider} disabled={savingProvider}
                      className="h-8 px-3 rounded-[8px] bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium disabled:opacity-60">
                      {savingProvider ? "กำลังเพิ่ม…" : "เพิ่ม"}
                    </button>
                    <button onClick={() => setShowNewProvider(false)} className="h-8 px-3 rounded-[8px] border text-xs font-medium hover:bg-muted">ยกเลิก</button>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ชื่อแพทย์</label>
                <input value={doctorName} onChange={e => setDoctorName(e.target.value)} placeholder="พญ./นพ. ..."
                  className="w-full h-9 rounded-[10px] border bg-background px-3 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">HN</label>
                <input value={selectedProvider?.hn ?? "—"} disabled
                  className="w-full h-9 rounded-[10px] border bg-muted/40 px-3 text-sm text-muted-foreground outline-none" />
              </div>
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">คำสั่งแพทย์</label>
              <textarea value={doctorNotes} onChange={e => setDoctorNotes(e.target.value)} rows={2} placeholder="เช่น กินต่อเนื่อง 7 วัน, ห้ามหยุดเอง"
                className="w-full rounded-[10px] border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500 resize-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <label className="text-[11.5px] font-medium text-muted-foreground">เริ่มใช้ยา<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 h-9 w-full rounded-[8px] border bg-background px-2 text-sm" /></label>
            <label className="text-[11.5px] font-medium text-muted-foreground">กำหนดจบ (ถ้ามี)<input type="date" value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} className="mt-1 h-9 w-full rounded-[8px] border bg-background px-2 text-sm" /></label>
          </div>

          {/* Schedule */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">ตารางการทาน</p>
              {!isBedtime && <button onClick={addTime} className="text-xs text-brand-500 font-medium">+ เพิ่มเวลา</button>}
            </div>
            {/* Bedtime hides the time pickers rather than merely labeling
                them — "ไม่ต้องระบุเวลา" means the user isn't asked to touch a
                clock at all. A real HH:mm is still stored (seeded to 22:00
                only if times is still at its untouched default) so the LINE
                reminder still fires on a real time — same fix as iOS. */}
            {!isBedtime && times.map((t, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input type="time" value={t} onChange={e => setTimes(times.map((tt, j) => j === i ? e.target.value : tt))}
                  className="flex-1 h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
                {times.length > 1 && <button onClick={() => removeTime(i)} className="h-9 w-9 rounded-[8px] hover:bg-rose-50 flex items-center justify-center text-muted-foreground hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={isBedtime} onChange={e => {
                const on = e.target.checked
                setIsBedtime(on)
                if (on && times.length === 1 && times[0] === "08:00") setTimes(["22:00"])
              }} className="rounded" />
              <span className="text-sm">🌙 ยาก่อนนอน — ไม่ต้องระบุเวลาแม่นยำ</span>
            </label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">กี่เม็ดต่อครั้ง</label>
                <input type="number" min="0.5" step="0.5" value={doseQty} onChange={e => setDoseQty(e.target.value)}
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ช่วงเวลาอาหาร</label>
                <select value={mealRelation} onChange={e => setMealRelation(e.target.value as typeof mealRelation)}
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500">
                  <option value="before">ก่อนอาหาร</option>
                  <option value="after">หลังอาหาร</option>
                  <option value="with">พร้อมอาหาร</option>
                  <option value="any">ไม่ระบุ</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input type="checkbox" checked={reminder} onChange={e => setReminder(e.target.checked)} className="rounded" />
              <span className="text-sm">แจ้งเตือนผ่าน LINE</span>
            </label>
          </div>

          {/* Inventory */}
          <div className="border-t pt-4">
            <p className="text-sm font-semibold mb-2">ข้อมูลสต็อก</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">จำนวนต่อกล่อง</label>
                <input type="number" value={qtyPerPack} onChange={e => setQtyPerPack(e.target.value)} placeholder="30"
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">ทานไปแล้ว</label>
                <input type="number" value={alreadyTaken} onChange={e => setAlreadyTaken(e.target.value)} placeholder="0"
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div className="col-span-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-muted-foreground">คงเหลือ</span>
                <span className="text-sm font-bold text-brand-600">{computedRemaining} เม็ด</span>
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">แจ้งเตือนเมื่อเหลือ</label>
                <input type="number" value={lowAlert} onChange={e => setLowAlert(e.target.value)} placeholder="7"
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">วันหมดอายุ</label>
                <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)}
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">LOC</label>
                <input value={locCode} onChange={e => setLocCode(e.target.value)} placeholder="รหัสบนซองยา"
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="text-[11.5px] font-medium text-muted-foreground block mb-1">LOT</label>
                <input value={lotNo} onChange={e => setLotNo(e.target.value)} placeholder="เลขล็อตการผลิต"
                  className="w-full h-9 rounded-[8px] border bg-background px-2 text-sm outline-none focus:border-brand-500" />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted">ยกเลิก</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 h-10 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {existing ? "บันทึกการแก้ไข" : "บันทึก"}
            </button>
          </div>

          <p className="text-[10.5px] text-muted-foreground text-center">
            ⚠️ Slippy ช่วยแจ้งเตือน ไม่ใช่คำแนะนำทางการแพทย์ ปรึกษาแพทย์/เภสัชกรเสมอ
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Today's Dose Card ──────────────────────────────────────────────────────── */
function TodayDoseCard({ log, medication, onUpdate }: {
  log: Log; medication: Medication; onUpdate: (logId: string, status: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const isPending = log.status === "pending"
  const isTaken   = log.status === "taken" || log.status === "late"
  const isSkipped = log.status === "skipped"

  const mark = async (status: "taken" | "skipped") => {
    setLoading(true)
    try {
      await fetch("/api/medications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: log.id, status }),
      })
      onUpdate(log.id, status)
      toast.success(status === "taken" ? "✅ บันทึกแล้ว!" : "⏭️ ข้ามแล้ว")
    } catch { toast.error("เกิดข้อผิดพลาด") } finally { setLoading(false) }
  }

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors",
      isTaken  ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-500/5" :
      isSkipped ? "border-muted bg-muted/20 opacity-60" :
      "border-border bg-card")}>
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0",
        isTaken ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-muted")}>
        <HealthIcon className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-label={HEALTH_CATEGORY.labelTh} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{medication.name}</p>
        <p className="text-xs text-muted-foreground">
          {log.dose_taken} เม็ด
          {medication.medication_schedules[0]?.meal_relation !== "any" && ` · ${MEAL_LABEL[medication.medication_schedules[0]?.meal_relation]}`}
          {" · "}⏰ {fmtTime(log.scheduled_at)}
        </p>
      </div>
      {isPending && !loading && (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => mark("taken")}
            className="h-8 w-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={() => mark("skipped")}
            className="h-8 w-8 rounded-lg border hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
      {isTaken  && <span className="text-xs text-emerald-600 font-medium shrink-0">✓ ทานแล้ว</span>}
      {isSkipped && <span className="text-xs text-muted-foreground shrink-0">ข้าม</span>}
    </div>
  )
}

/* ─── Medication Card ────────────────────────────────────────────────────────── */
function MedicationCard({ med, adherence, onEdit, onRequestDelete }: {
  med: Medication; adherence: Adherence | undefined
  onEdit: () => void
  /** Opens the confirmation — this never deletes directly. */
  onRequestDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const inv     = med.medication_inventory[0] ?? null
  const sched   = med.medication_schedules[0]
  const lowStock = isLowStock(inv)
  const expiring = isExpiringSoon(inv)
  const adherePct = adherence?.adherence_pct ?? null
  const daysLeft = daysRemaining(inv, sched)
  const outDate  = runOutDate(daysLeft)

  // Live market-price lookup — never cached on the medication itself (see
  // the pipeline's own note on why), so this is per-card local state,
  // fetched only when someone actually asks for it.
  const [priceLoading, setPriceLoading] = useState(false)
  const [priceResult,  setPriceResult]  = useState<{ summary: string; sources: { title: string; url: string }[] } | null>(null)
  const [priceError,   setPriceError]   = useState<string | null>(null)

  const lookupPrice = async () => {
    setPriceLoading(true)
    setPriceError(null)
    try {
      const res = await fetch("/api/medications/price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: med.name, strength: med.strength }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "ค้นหาราคาไม่สำเร็จ")
      setPriceResult(json)
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : "ค้นหาราคาไม่สำเร็จ")
    } finally {
      setPriceLoading(false)
    }
  }

  // The label photo this medication was scanned or added from — GET
  // /api/medications/[id]/label resolves the stored path to a short-lived
  // signed URL, so nothing here ever holds a long-lived link to a private
  // file. hasLabel tracks the DB column so the upload/view affordance shows
  // the right state before the URL itself has been fetched.
  const [hasLabel,     setHasLabel]     = useState(!!med.image_url)
  const [labelUrl,     setLabelUrl]     = useState<string | null>(null)
  const [labelLoading, setLabelLoading] = useState(false)
  const labelInput = useRef<HTMLInputElement>(null)

  const viewLabel = async () => {
    setLabelLoading(true)
    try {
      const res = await fetch(`/api/medications/${med.id}/label`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "เปิดรูปไม่สำเร็จ")
      if (json.url) { setLabelUrl(json.url); window.open(json.url, "_blank", "noopener,noreferrer") }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปิดรูปไม่สำเร็จ")
    } finally {
      setLabelLoading(false)
    }
  }

  const uploadLabel = async (file: File) => {
    setLabelLoading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/medications/${med.id}/label`, { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "อัปโหลดไม่สำเร็จ")
      setHasLabel(true)
      setLabelUrl(json.url)
      toast.success("อัปโหลดฉลากยาแล้ว")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ")
    } finally {
      setLabelLoading(false)
    }
  }

  const deleteLabel = async () => {
    setLabelLoading(true)
    try {
      const res = await fetch(`/api/medications/${med.id}/label`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? "ลบไม่สำเร็จ")
      setHasLabel(false)
      setLabelUrl(null)
      toast.success("ลบรูปฉลากยาแล้ว")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ")
    } finally {
      setLabelLoading(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0">
          <HealthIcon className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-label={HEALTH_CATEGORY.labelTh} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold">{med.name}</p>
            {med.is_chronic && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">เรื้อรัง</span>}
            {lowStock  && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 font-medium flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />ยาเหลือน้อย</span>}
            {expiring  && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 font-medium">ใกล้หมดอายุ</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {med.strength && `${med.strength} · `}
            {sched ? `${sched.is_bedtime ? "🌙 ก่อนนอน" : sched.times.join(", ")} · ${sched.dose_qty} เม็ด` : "ไม่มีตาราง"}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {inv && (
            <span className={cn("text-xs", lowStock ? "text-rose-600 font-semibold" : "text-muted-foreground")}>
              {inv.qty_remaining} {inv.qty_unit}
              {daysLeft != null && ` · เหลือ ${daysLeft} วัน`}
            </span>
          )}
          {adherePct !== null && (
            <span className={cn("text-xs font-semibold", adherePct >= 80 ? "text-emerald-600" : adherePct >= 60 ? "text-amber-600" : "text-rose-600")}>
              {adherePct}%
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-2 text-sm">
          {med.purpose    && <p className="text-muted-foreground">🎯 {med.purpose}</p>}
          {med.notes      && <p className="rounded-lg bg-emerald-50/70 dark:bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">📄 <span className="font-semibold">หมายเหตุจากฉลาก:</span> {med.notes}</p>}
          {med.brand_name && <p className="text-muted-foreground">🏷️ {med.brand_name}</p>}
          {(med.provider || med.prescribed_by) && (
            <p className="text-muted-foreground">
              🏥 {med.provider?.name}{med.provider && med.prescribed_by ? " · " : ""}{med.prescribed_by}
            </p>
          )}
          {med.doctor_instructions && <p className="text-muted-foreground">📋 {med.doctor_instructions}</p>}
          {sched?.meal_relation !== "any" && <p className="text-muted-foreground">🍽️ {MEAL_LABEL[sched?.meal_relation ?? "any"]}{sched?.meal_note ? ` — ${sched.meal_note}` : ""}</p>}
          {inv?.expiry_date && <p className="text-muted-foreground">📅 หมดอายุ: {new Date(inv.expiry_date).toLocaleDateString("th-TH")}</p>}
          {daysLeft != null && sched && (
            <p className={cn(lowStock ? "text-rose-600 font-medium" : "text-muted-foreground")}>
              📦 ยาจะหมดในอีก {daysLeft} วัน (ประมาณ {outDate}) — จากอัตราทาน {sched.dose_qty * sched.times.length} เม็ด/วัน
            </p>
          )}
          {sched && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {sched.reminder_enabled ? <Bell className="w-3.5 h-3.5 text-brand-500" /> : <BellOff className="w-3.5 h-3.5" />}
              {sched.reminder_enabled ? "แจ้งเตือนผ่าน LINE" : "ปิดแจ้งเตือน"}
            </div>
          )}
          {adherence && (
            <p className="text-xs text-muted-foreground">
              📊 ทานสม่ำเสมอ {adherePct}% ({adherence.taken}/{adherence.total_doses} ครั้ง)
            </p>
          )}

          <div className="border-t pt-2.5">
            <input ref={labelInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadLabel(f); e.target.value = "" }} />
            {hasLabel ? (
              <div className="flex items-center gap-3">
                {labelUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element -- a signed URL to a private bucket, not a build-time asset */
                  <img src={labelUrl} alt="ฉลากยา" className="h-12 w-12 rounded-lg object-cover border shrink-0" />
                )}
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <button onClick={viewLabel} disabled={labelLoading} className="text-brand-600 hover:text-brand-700 disabled:opacity-60">
                    {labelLoading ? "กำลังเปิด…" : "🏷️ ดูฉลากยา"}
                  </button>
                  <button onClick={() => labelInput.current?.click()} disabled={labelLoading} className="text-muted-foreground hover:text-foreground disabled:opacity-60">
                    เปลี่ยนรูป
                  </button>
                  <button onClick={deleteLabel} disabled={labelLoading} className="text-rose-600 hover:text-rose-700 disabled:opacity-60">
                    ลบ
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => labelInput.current?.click()} disabled={labelLoading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60">
                {labelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>🏷️</span>}
                {labelLoading ? "กำลังอัปโหลด…" : "อัปโหลดฉลากยา"}
              </button>
            )}
          </div>

          <div className="border-t pt-2.5 flex items-center gap-4">
            <button onClick={onEdit}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <Pencil className="w-3.5 h-3.5" />แก้ไขข้อมูลยา
            </button>
            <button onClick={onRequestDelete}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700">
              <Trash2 className="w-3.5 h-3.5" />ลบยานี้
            </button>
          </div>

          <div className="border-t pt-2.5">
            {!priceResult && (
              <button onClick={lookupPrice} disabled={priceLoading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60">
                {priceLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>💰</span>}
                {priceLoading ? "กำลังค้นหาราคาตลาด…" : "ค้นหาราคาตลาด"}
              </button>
            )}
            {priceError && <p className="text-xs text-rose-600 mt-1.5">{priceError}</p>}
            {priceResult && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <p className="text-xs text-foreground/80 whitespace-pre-line">{priceResult.summary}</p>
                {priceResult.sources.length > 0 && (
                  <div className="space-y-0.5">
                    {priceResult.sources.map(s => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                        className="block text-[10px] text-brand-600 hover:underline truncate">🔗 {s.title || s.url}</a>
                    ))}
                  </div>
                )}
                <button onClick={lookupPrice} disabled={priceLoading}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60">
                  {priceLoading ? "กำลังค้นหาใหม่…" : "↻ ค้นหาใหม่"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main ────────────────────────────────────────────────────────────────────── */
export function MedicationsClient({ medications: initial, todayLogs: initialLogs, adherenceStats, userId: _userId }: {
  medications:    Medication[]
  todayLogs:      Log[]
  adherenceStats: Adherence[]
  userId:         string
}) {
  const [medications]                 = useState(initial)
  const [logs,        setLogs]        = useState(initialLogs)
  const [showAdd,     setShowAdd]     = useState(false)
  const [editingMed,  setEditingMed]  = useState<Medication | null>(null)
  /// Non-nil while the "ลบยานี้?" confirmation is up — never deletes on its own.
  const [deleteTarget, setDeleteTarget] = useState<Medication | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [view,         setView]         = useState<"today" | "all">("today")
  const [courseFilter, setCourseFilter] = useState<"active" | "paused" | "history">("active")

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/medications/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("ลบยาแล้ว")
      setDeleteTarget(null)
      window.location.reload()
    } catch {
      toast.error("ลบไม่สำเร็จ")
    } finally {
      setDeleting(false)
    }
  }

  // Scan-a-label flow: upload → propose (read-only) → the SAME add-medication
  // form, pre-filled, so nothing is ever written until it goes through the
  // one review step every path into `medications` already goes through.
  const [scanning,       setScanning]       = useState(false)
  const [scanResults,    setScanResults]    = useState<ScannedMedication[] | null>(null)
  const [scanIssues,     setScanIssues]     = useState<string[]>([])
  const [reviewing,      setReviewing]      = useState<ScannedMedication | null>(null)
  const scanInput = useRef<HTMLInputElement>(null)

  const scanLabel = async (file: File) => {
    setScanning(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/medications/scan", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "อ่านฉลากยาไม่สำเร็จ")
      const items = (json.items ?? []) as ScannedMedication[]
      setScanIssues((json.issues ?? []) as string[])
      if (!items.length) {
        toast.error("อ่านฉลากยาไม่พบรายการที่ใช้ได้")
        return
      }
      // One label, the common case: skip straight to the review form. More
      // than one (a photo catching two packs) shows a pick list first.
      if (items.length === 1) setReviewing(items[0])
      else setScanResults(items)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อ่านฉลากยาไม่สำเร็จ")
    } finally {
      setScanning(false)
    }
  }

  // Reorder list: which medications are low or about to run out, and how
  // much to buy — computed server-side from the same daily-rate math the
  // card's own run-out estimate uses (GET /api/medications/reorder), then
  // optionally pushed to the user's own LINE as a message they can forward.
  const [reorderOpen,    setReorderOpen]    = useState(false)
  const [reorderLoading, setReorderLoading] = useState(false)
  const [reorderSending, setReorderSending] = useState(false)
  const [reorderItems,   setReorderItems]   = useState<ReorderItem[] | null>(null)

  const openReorder = async () => {
    setReorderOpen(true)
    setReorderLoading(true)
    try {
      const res = await fetch("/api/medications/reorder")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "โหลดรายการไม่สำเร็จ")
      setReorderItems(json.items as ReorderItem[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "โหลดรายการไม่สำเร็จ")
      setReorderOpen(false)
    } finally {
      setReorderLoading(false)
    }
  }

  const sendReorderToLine = async () => {
    setReorderSending(true)
    try {
      const res = await fetch("/api/medications/reorder", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "ส่งไม่สำเร็จ")
      toast.success(`ส่งรายการสั่งซื้อ ${json.sent} รายการเข้า LINE แล้ว`)
      setReorderOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ")
    } finally {
      setReorderSending(false)
    }
  }

  const takenToday  = logs.filter(l => l.status === "taken" || l.status === "late").length
  const totalToday  = logs.length

  const handleLogUpdate = (logId: string, status: string) => {
    setLogs(prev => prev.map(l => l.id === logId ? { ...l, status, taken_at: status !== "skipped" ? new Date().toISOString() : null } : l))
  }

  const updateTimelineDose = async (logId: string, status: "taken" | "skipped") => {
    const res = await fetch("/api/medications", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logId, status }),
    })
    if (!res.ok) return toast.error("บันทึกรอบยาไม่สำเร็จ")
    handleLogUpdate(logId, status)
    toast.success(status === "taken" ? "บันทึกว่าทานแล้ว" : "บันทึกข้ามรอบ")
  }

  const adherenceMap = Object.fromEntries(adherenceStats.map(a => [a.medication_id, a]))

  return (
    <div className="p-6 lg:p-7 max-w-[800px] animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><HealthIcon className="h-5 w-5 text-rose-600 dark:text-rose-400" />{HEALTH_CATEGORY.labelTh}</h2>
          <p className="text-sm text-muted-foreground">ติดตามการทานยาและสต็อกยาของคุณ</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={scanInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) scanLabel(f); e.target.value = "" }} />
          <button onClick={() => scanInput.current?.click()} disabled={scanning}
            className="h-9 px-4 rounded-[10px] border bg-card hover:bg-muted text-sm font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-60">
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
            สแกนฉลากยา
          </button>
          <button onClick={openReorder}
            className="h-9 px-4 rounded-[10px] border bg-card hover:bg-muted text-sm font-medium transition-colors inline-flex items-center gap-1.5">
            <ShoppingCart className="w-3.5 h-3.5" /> รายการสั่งซื้อ
          </button>
          <button onClick={() => setShowAdd(true)}
            className="h-9 px-4 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> เพิ่มยา
          </button>
        </div>
      </div>

      <div className="mb-4 flex w-full rounded-xl bg-muted p-1" role="tablist" aria-label="มุมมองการจัดการยา">
        <button role="tab" aria-selected={view === "today"} onClick={() => setView("today")} className={cn("h-9 flex-1 rounded-lg text-[13px] font-medium", view === "today" && "bg-card text-teal-700 shadow-sm dark:text-teal-300")}>วันนี้</button>
        <button role="tab" aria-selected={view === "all"} onClick={() => setView("all")} className={cn("h-9 flex-1 rounded-lg text-[13px] font-medium", view === "all" && "bg-card text-teal-700 shadow-sm dark:text-teal-300")}>ยาทั้งหมด</button>
      </div>

      {/* Today's summary */}
      {view === "today" && (
        <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-500/5 dark:to-indigo-500/5 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm">วันนี้</p>
            <span className={cn("text-sm font-bold", takenToday === totalToday ? "text-emerald-600" : "text-amber-600")}>
              {takenToday}/{totalToday} โดส
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-4">
            <div className={cn("h-full rounded-full transition-all", takenToday === totalToday ? "bg-emerald-500" : "bg-brand-500")}
              style={{ width: `${totalToday ? (takenToday / totalToday * 100) : 0}%` }} />
          </div>
          <MedicationTimeline medications={medications} logs={logs} onUpdate={updateTimelineDose} />
        </div>
      )}

      {/* Medication list */}
      {view === "all" && (medications.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center py-14 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10"><HealthIcon className="h-7 w-7 text-rose-600 dark:text-rose-400" /></div>
          <p className="font-medium text-lg">ยังไม่มีรายการยา</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">เพิ่มยาที่กินประจำเพื่อรับการแจ้งเตือน</p>
          <button onClick={() => setShowAdd(true)}
            className="h-9 px-5 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors">
            เพิ่มยาแรก
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {([['active','กำลังใช้'],['paused','พักยา'],['history','ประวัติ']] as const).map(([key, label]) => <button key={key} onClick={() => setCourseFilter(key)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[11px]", courseFilter === key && "border-teal-600 bg-teal-600 text-white")}>{label}</button>)}
          </div>
          {medications.filter(m => {
            const status = m.medication_courses?.[0]?.status ?? "active"
            return courseFilter === "history" ? status === "stopped" || status === "completed" : status === courseFilter
          }).map(m => <MedicationCourseCard key={m.id} medication={m} onRefresh={() => window.location.reload()} />)}
        </div>
      ))}

      <p className="text-[10.5px] text-muted-foreground text-center mt-6">
        ⚠️ แอปนี้ช่วยแจ้งเตือนเท่านั้น ไม่ใช่คำแนะนำทางการแพทย์<br />
        กรุณาปรึกษาแพทย์หรือเภสัชกรก่อนเปลี่ยนแปลงการใช้ยา
      </p>

      {showAdd && <AddMedicationModal onClose={() => setShowAdd(false)} onCreate={() => window.location.reload()} />}

      {editingMed && (
        <AddMedicationModal
          existing={editingMed}
          onClose={() => setEditingMed(null)}
          onCreate={() => window.location.reload()}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-[15px] font-semibold">ลบ {deleteTarget.name}?</h3>
            <p className="text-xs text-muted-foreground">
              จะซ่อนยานี้จากรายการ — ประวัติการทานยาที่ผ่านมายังเก็บไว้เหมือนเดิม
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1 h-10 rounded-[10px] border text-sm font-medium hover:bg-muted disabled:opacity-60">
                ยกเลิก
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 h-10 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} ลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <AddMedicationModal
          scanned={reviewing}
          scanIssues={scanResults ? undefined : scanIssues}
          onClose={() => { setReviewing(null); setScanResults(null) }}
          onCreate={() => window.location.reload()}
        />
      )}

      {/* A photo with more than one label in frame — pick which one to review first. */}
      {scanResults && !reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setScanResults(null)} />
          <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">พบยา {scanResults.length} รายการในภาพนี้</h3>
              <button onClick={() => setScanResults(null)} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            {scanIssues.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                {scanIssues.map((s, i) => <p key={i} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{s}</p>)}
              </div>
            )}
            <div className="space-y-2">
              {scanResults.map((item, i) => (
                <button key={i} onClick={() => setReviewing(item)}
                  className="w-full text-left rounded-xl border p-3 hover:bg-muted/40 transition-colors flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-base shrink-0">💊</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.name}{item.strength ? ` ${item.strength}` : ""}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.times.length ? `${item.times.join(", ")} · ` : ""}{item.dose_qty} {item.qty_unit}/ครั้ง
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {reorderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setReorderOpen(false)} />
          <div className="relative bg-card border rounded-[16px] shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold flex items-center gap-1.5"><ShoppingCart className="w-4 h-4" />รายการสั่งซื้อยา</h3>
              <button onClick={() => setReorderOpen(false)} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>

            {reorderLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !reorderItems?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">ตอนนี้ยังไม่มียาที่ต้องสั่งซื้อเพิ่ม 🎉</p>
            ) : (
              <>
                <div className="space-y-2">
                  {reorderItems.map(it => (
                    <div key={it.medicationId} className="rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{it.name}{it.strength ? ` ${it.strength}` : ""}</p>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                          it.reason === "running_out_soon" ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600" : "bg-amber-50 dark:bg-amber-500/10 text-amber-600")}>
                          {it.reason === "running_out_soon" ? `⏰ อีก ${it.daysRemaining} วันหมด` : "📦 เหลือน้อย"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        ตอนนี้เหลือ {it.qtyRemaining} {it.qtyUnit} · แนะนำซื้อ <span className="font-semibold text-foreground">{it.suggestedQty} {it.qtyUnit}</span>
                      </p>
                    </div>
                  ))}
                </div>
                <button onClick={sendReorderToLine} disabled={reorderSending}
                  className="w-full h-10 rounded-[10px] bg-[#06C755] hover:brightness-95 text-white text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60">
                  {reorderSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  ส่งรายการนี้ผ่าน LINE
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
