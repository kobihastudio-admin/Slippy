import type { MedicationCourse } from "./medication-lifecycle.ts"

type DbError = { code?: string; message: string }

export interface MedicationCourseDb {
  from(table: string): any
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: DbError | null }>
}

export interface TransitionMedicationCourseInput {
  courseId: string
  userId: string
  action: "pause" | "resume" | "stop" | "complete"
  effectiveAt: string
  reason?: string | null
  confirmedBy: "self" | "doctor" | "pharmacist" | "caregiver"
  idempotencyKey: string
}

export class MedicationCourseConflict extends Error {
  constructor(message = "สถานะคอร์สยามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่") {
    super(message)
    this.name = "MedicationCourseConflict"
  }
}

export class MedicationCourseNotFound extends Error {
  constructor() {
    super("ไม่พบคอร์สยาของผู้ใช้นี้")
    this.name = "MedicationCourseNotFound"
  }
}

async function defaultDb(): Promise<MedicationCourseDb> {
  const { createClient } = await import("@/lib/supabase/server")
  return await createClient() as unknown as MedicationCourseDb
}

function mapCourse(row: any): MedicationCourse {
  return {
    id: row.id,
    medicationId: row.medication_id,
    status: row.status,
    startDate: row.start_date,
    plannedEndDate: row.planned_end_date,
    actualEndAt: row.actual_end_at,
    prescribedBy: row.prescribed_by,
    doctorInstructions: row.doctor_instructions,
    instructionSource: row.instruction_source,
  }
}

export async function transitionMedicationCourse(
  input: TransitionMedicationCourseInput,
  db?: MedicationCourseDb,
): Promise<MedicationCourse> {
  const client = db ?? await defaultDb()

  // Keep defense-in-depth ownership scoping visible in application code even
  // though both RLS and the SECURITY DEFINER RPC enforce auth.uid() as well.
  const { data: owned, error: readError } = await client
    .from("medication_courses")
    .select("id")
    .eq("id", input.courseId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!owned) throw new MedicationCourseNotFound()

  const { data, error } = await client.rpc("transition_medication_course", {
    p_course_id: input.courseId,
    p_action: input.action,
    p_effective_at: input.effectiveAt,
    p_reason: input.reason ?? null,
    p_confirmed_by: input.confirmedBy,
    p_idempotency_key: input.idempotencyKey,
  })

  if (error) {
    if (error.code === "40001" || /invalid|stale|transition/i.test(error.message)) {
      throw new MedicationCourseConflict()
    }
    if (error.code === "P0002") throw new MedicationCourseNotFound()
    throw new Error(error.message)
  }
  if (!data) throw new Error("ไม่พบผลลัพธ์การเปลี่ยนสถานะคอร์สยา")
  return mapCourse(Array.isArray(data) ? data[0] : data)
}
