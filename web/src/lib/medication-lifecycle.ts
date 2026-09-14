export type CourseStatus = "active" | "paused" | "stopped" | "completed"
export type LifecycleAction = "pause" | "resume" | "stop" | "complete"
export type DoseStatus = "pending" | "taken" | "late" | "skipped" | "missed"
export type DosePeriod = "morning" | "midday" | "evening" | "bedtime" | "custom"

export interface MedicationCourse {
  id: string
  medicationId: string
  status: CourseStatus
  startDate: string
  plannedEndDate: string | null
  actualEndAt?: string | null
  prescribedBy?: string | null
  doctorInstructions?: string | null
  instructionSource?: "label" | "doctor" | "pharmacist" | "user"
}

export interface DoseSlot {
  id: string
  courseId: string
  timeValue: string
  periodLabel: DosePeriod
  doseQty: number
  mealRelation?: string
  mealNote?: string | null
  reminderEnabled: boolean
}

export interface DoseOccurrence {
  id: string
  courseId: string
  slotId: string
  medicationId: string
  medicationName: string
  doseQty: number
  unit: string
  scheduledAt: string
  timeLabel: string
  periodLabel: DosePeriod
  status: DoseStatus
  courseStatus: CourseStatus
}

export interface DoseTimelineGroup {
  key: string
  timeLabel: string
  periodLabel: DosePeriod
  scheduledAt: string
  occurrences: DoseOccurrence[]
  summary: RoundSummary
}

export interface RoundSummary {
  status: "complete" | "due" | "upcoming" | "missed"
  taken: number
  resolved: number
  total: number
}

const terminalStatuses = new Set<DoseStatus>(["taken", "late", "skipped", "missed"])

export function allowedLifecycleActions(status: CourseStatus): LifecycleAction[] {
  if (status === "active") return ["pause", "stop", "complete"]
  if (status === "paused") return ["resume", "stop"]
  return []
}

export function summarizeRound(occurrences: DoseOccurrence[], now = new Date()): RoundSummary {
  const taken = occurrences.filter(item => item.status === "taken" || item.status === "late").length
  const resolved = occurrences.filter(item => terminalStatuses.has(item.status)).length
  const allMissed = occurrences.length > 0 && occurrences.every(item => item.status === "missed")
  const allResolved = occurrences.length > 0 && resolved === occurrences.length
  const startsLater = occurrences.length > 0 && occurrences.every(item => new Date(item.scheduledAt) > now)
  return {
    status: allMissed ? "missed" : allResolved ? "complete" : startsLater ? "upcoming" : "due",
    taken,
    resolved,
    total: occurrences.length,
  }
}

export function groupDoseTimeline(occurrences: DoseOccurrence[], now = new Date()): DoseTimelineGroup[] {
  const active = occurrences.filter(item => item.courseStatus === "active")
  const groups = new Map<string, DoseOccurrence[]>()

  for (const item of active) {
    const date = item.scheduledAt.slice(0, 10)
    const key = `${date}:${item.periodLabel === "bedtime" ? "bedtime" : item.timeLabel}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      timeLabel: items[0].periodLabel === "bedtime" ? "ก่อนนอน" : items[0].timeLabel,
      periodLabel: items[0].periodLabel,
      scheduledAt: items[0].scheduledAt,
      occurrences: items,
      summary: summarizeRound(items, now),
    }))
    .sort((a, b) => {
      if (a.periodLabel === "bedtime" && b.periodLabel !== "bedtime") return 1
      if (b.periodLabel === "bedtime" && a.periodLabel !== "bedtime") return -1
      return a.scheduledAt.localeCompare(b.scheduledAt)
    })
}

export function todayProgress(occurrences: DoseOccurrence[]) {
  const active = occurrences.filter(item => item.courseStatus === "active")
  const taken = active.filter(item => item.status === "taken" || item.status === "late").length
  const resolved = active.filter(item => terminalStatuses.has(item.status)).length
  return {
    taken,
    resolved,
    total: active.length,
    percent: active.length ? Math.round((taken / active.length) * 100) : 0,
  }
}

export function courseDisplayState(
  course: Pick<MedicationCourse, "status" | "startDate" | "plannedEndDate">,
  today = new Date().toISOString().slice(0, 10),
): CourseStatus | "upcoming" | "due_for_review" {
  if (course.status !== "active") return course.status
  if (course.startDate > today) return "upcoming"
  if (course.plannedEndDate && course.plannedEndDate <= today) return "due_for_review"
  return "active"
}
