"use client"

import { CalendarDays, Pause, Pill, Play, Square, Stethoscope } from "lucide-react"
import { useState } from "react"
import { MedicationLifecycleDialog, type LifecycleAction } from "./medication-lifecycle-dialog"

type Course = {
  id: string
  status: "active" | "paused" | "stopped" | "completed"
  start_date: string
  planned_end_date: string | null
  prescribed_by: string | null
  doctor_instructions: string | null
  instruction_source: "label" | "doctor" | "pharmacist" | "user"
}

const STATUS = {
  active: ["กำลังใช้", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"],
  paused: ["พักยา", "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"],
  stopped: ["หยุดแล้ว", "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"],
  completed: ["จบคอร์ส", "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"],
} as const

export function MedicationCourseCard({ medication, onRefresh }: {
  medication: {
    id: string; name: string; strength: string | null; purpose: string | null
    medication_courses?: Course[]
    medication_inventory: Array<{ qty_remaining: number; qty_unit: string }>
  }
  onRefresh: () => void
}) {
  const course = medication.medication_courses?.[0]
  const [action, setAction] = useState<LifecycleAction | null>(null)
  if (!course) return null
  const [statusText, statusClass] = STATUS[course.status]
  const dueReview = course.status === "active" && !!course.planned_end_date && course.planned_end_date <= new Date().toISOString().slice(0, 10)
  const inventory = medication.medication_inventory[0]

  return <>
    <article className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-100 to-sky-100 text-teal-700 dark:from-teal-950 dark:to-sky-950"><Pill className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-[14px] font-semibold">{medication.name}{medication.strength ? ` ${medication.strength}` : ""}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>{dueReview ? "ครบกำหนด — รอยืนยัน" : statusText}</span></div>
          {medication.purpose && <p className="mt-0.5 text-[11px] text-muted-foreground">{medication.purpose}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
            <span><CalendarDays className="mr-1 inline h-3 w-3" />เริ่ม {new Date(course.start_date).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</span>
            {course.planned_end_date && <span>ถึง {new Date(course.planned_end_date).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</span>}
            {inventory && <span>เหลือ {inventory.qty_remaining} {inventory.qty_unit}</span>}
          </div>
          {course.doctor_instructions && <div className="mt-2 rounded-lg bg-teal-50/70 px-2.5 py-2 text-[10.5px] text-teal-800 dark:bg-teal-950/30 dark:text-teal-200"><Stethoscope className="mr-1 inline h-3 w-3" /><b>{course.instruction_source === "label" ? "สแกนจากฉลาก" : "คำแนะนำที่บันทึก"}</b> · {course.doctor_instructions}</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-3">
        {course.status === "active" && <><button onClick={() => setAction("pause")} className="h-8 rounded-lg border px-2.5 text-[11px]"><Pause className="mr-1 inline h-3 w-3" />พักยา</button><button onClick={() => setAction("complete")} className="h-8 rounded-lg border px-2.5 text-[11px]">จบคอร์ส</button><button onClick={() => setAction("stop")} className="h-8 rounded-lg border border-rose-200 px-2.5 text-[11px] text-rose-600"><Square className="mr-1 inline h-3 w-3" />หยุดยา</button></>}
        {course.status === "paused" && <><button onClick={() => setAction("resume")} className="h-8 rounded-lg bg-teal-600 px-2.5 text-[11px] text-white"><Play className="mr-1 inline h-3 w-3" />กลับมาใช้</button><button onClick={() => setAction("stop")} className="h-8 rounded-lg border border-rose-200 px-2.5 text-[11px] text-rose-600">หยุดถาวร</button></>}
      </div>
    </article>
    {action && <MedicationLifecycleDialog courseId={course.id} action={action} onClose={() => setAction(null)} onDone={onRefresh} />}
  </>
}
