"use client"

import { Check, Clock3, Pill, SkipForward } from "lucide-react"
import { cn } from "@/lib/utils"

type TimelineMedication = {
  id: string
  name: string
  strength: string | null
  medication_schedules: Array<{ dose_qty: number; meal_relation: string; meal_note: string | null }>
  medication_courses?: Array<{
    status: string
    doctor_instructions: string | null
    instruction_source: string
  }>
}

export type TimelineLog = {
  id: string
  medication_id: string
  scheduled_at: string
  taken_at: string | null
  status: string
  dose_taken: number
}

const period = (hour: number) => hour < 11 ? "รอบเช้า" : hour < 16 ? "รอบกลางวัน" : hour < 21 ? "รอบเย็น" : "ก่อนนอน"
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })

export function MedicationTimeline({ medications, logs, onUpdate }: {
  medications: TimelineMedication[]
  logs: TimelineLog[]
  onUpdate: (logId: string, status: "taken" | "skipped") => void
}) {
  const groups = new Map<string, TimelineLog[]>()
  for (const log of logs) {
    const med = medications.find(item => item.id === log.medication_id)
    if (med?.medication_courses?.[0]?.status === "paused") continue
    const key = timeOf(log.scheduled_at)
    groups.set(key, [...(groups.get(key) ?? []), log])
  }

  if (!groups.size) return (
    <div className="rounded-2xl border border-dashed bg-card px-5 py-10 text-center">
      <Pill className="mx-auto mb-2 h-7 w-7 text-teal-600" />
      <p className="text-sm font-semibold">วันนี้ยังไม่มีรอบยา</p>
      <p className="mt-1 text-xs text-muted-foreground">ยาที่พักอยู่จะไม่ถูกนับเป็นขาดยา</p>
    </div>
  )

  return <div className="relative space-y-3 before:absolute before:bottom-5 before:left-[19px] before:top-5 before:w-px before:bg-teal-200 dark:before:bg-teal-900">
    {[...groups.entries()].map(([time, items]) => {
      const resolved = items.filter(item => ["taken", "late", "skipped"].includes(item.status)).length
      const done = resolved === items.length
      const hour = new Date(items[0].scheduled_at).getHours()
      return <section key={time} className={cn("relative ml-10 rounded-2xl border bg-card p-3.5 shadow-sm", done && "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10")}>
        <span className={cn("absolute -left-[30px] top-5 h-4 w-4 rounded-full border-4 border-background", done ? "bg-emerald-500" : "bg-amber-500")} />
        <header className="mb-2.5 flex items-center justify-between gap-3 border-b pb-2.5">
          <div className="flex items-baseline gap-2">
            <strong className="text-[17px] tracking-tight text-slate-900 dark:text-slate-50">{time}</strong>
            <span className="text-[11px] text-muted-foreground">{period(hour)}</span>
          </div>
          <span className={cn("rounded-full px-2 py-1 text-[10.5px] font-medium", done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>
            {done ? <><Check className="mr-1 inline h-3 w-3" />ครบ {resolved}/{items.length}</> : `รอยืนยัน ${items.length - resolved} รายการ`}
          </span>
        </header>
        <div className="divide-y">
          {items.map(log => {
            const med = medications.find(item => item.id === log.medication_id)
            if (!med) return null
            const schedule = med.medication_schedules[0]
            const course = med.medication_courses?.[0]
            const taken = log.status === "taken" || log.status === "late"
            const skipped = log.status === "skipped"
            return <div key={log.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/40"><Pill className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{med.name}{med.strength ? ` ${med.strength}` : ""}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {schedule?.dose_qty ?? log.dose_taken ?? 1} เม็ด{schedule?.meal_note ? ` · ${schedule.meal_note}` : ""}
                </p>
                {course?.doctor_instructions && <p className="mt-0.5 truncate text-[10.5px] text-teal-700 dark:text-teal-300">ฉลากยา · {course.doctor_instructions}</p>}
              </div>
              {taken || skipped ? <div className={cn("text-right text-[11px] font-medium", taken ? "text-emerald-600" : "text-muted-foreground")}>
                {taken ? "ทานแล้ว" : "ข้ามรอบ"}<br/><span className="font-normal">{log.taken_at ? timeOf(log.taken_at) : "บันทึกแล้ว"}</span>
              </div> : <div className="flex shrink-0 gap-1.5">
                <button onClick={() => onUpdate(log.id, "skipped")} aria-label={`ข้าม ${med.name}`} className="grid h-8 w-8 place-items-center rounded-lg border text-muted-foreground hover:bg-muted"><SkipForward className="h-3.5 w-3.5" /></button>
                <button onClick={() => onUpdate(log.id, "taken")} className="h-8 rounded-lg bg-teal-600 px-2.5 text-[11px] font-semibold text-white hover:bg-teal-700">ทานแล้ว</button>
              </div>}
            </div>
          })}
        </div>
      </section>
    })}
  </div>
}
