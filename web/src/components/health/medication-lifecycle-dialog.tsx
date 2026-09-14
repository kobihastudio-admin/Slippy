"use client"

import { useState } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"

export type LifecycleAction = "pause" | "resume" | "stop" | "complete"

const LABEL: Record<LifecycleAction, string> = {
  pause: "พักยาชั่วคราว", resume: "กลับมาใช้ยา", stop: "หยุดยาถาวร", complete: "จบคอร์สยา",
}

export function MedicationLifecycleDialog({ courseId, action, onClose, onDone }: {
  courseId: string
  action: LifecycleAction
  onClose: () => void
  onDone: () => void
}) {
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 16))
  const [reason, setReason] = useState("")
  const [confirmedBy, setConfirmedBy] = useState("self")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/medications/courses/${courseId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, effectiveAt: new Date(effectiveAt).toISOString(), reason: reason || null, confirmedBy, idempotencyKey: crypto.randomUUID() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ")
      toast.success(`${LABEL[action]}แล้ว`)
      onDone()
    } catch (error) { toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ") }
    finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center p-4">
    <button className="absolute inset-0 bg-black/45" onClick={onClose} aria-label="ปิด" />
    <div className="relative w-full max-w-sm space-y-4 rounded-2xl border bg-card p-5 shadow-2xl">
      <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold">ยืนยัน: {LABEL[action]}</h3><button onClick={onClose}><X className="h-4 w-4" /></button></div>
      <p className="rounded-xl bg-amber-50 p-3 text-[11.5px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Slippy บันทึกและสรุปข้อมูลตามที่คุณยืนยัน ไม่ได้แนะนำให้เปลี่ยนยา กรุณาอ้างอิงแพทย์หรือเภสัชกร</p>
      <label className="block text-xs">มีผลตั้งแต่<input type="datetime-local" value={effectiveAt} onChange={e => setEffectiveAt(e.target.value)} className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-xs" /></label>
      <label className="block text-xs">เหตุผล (ไม่บังคับ)<textarea value={reason} onChange={e => setReason(e.target.value)} className="mt-1 min-h-16 w-full rounded-lg border bg-background p-2 text-xs" /></label>
      <label className="block text-xs">ยืนยันโดย<select value={confirmedBy} onChange={e => setConfirmedBy(e.target.value)} className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-xs"><option value="self">ตนเอง</option><option value="doctor">แพทย์</option><option value="pharmacist">เภสัชกร</option><option value="caregiver">ผู้ดูแล</option></select></label>
      <div className="flex gap-2"><button onClick={onClose} className="h-9 flex-1 rounded-lg border text-xs">ยกเลิก</button><button onClick={submit} disabled={saving} className="h-9 flex-1 rounded-lg bg-teal-600 text-xs font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}ยืนยัน</button></div>
    </div>
  </div>
}
