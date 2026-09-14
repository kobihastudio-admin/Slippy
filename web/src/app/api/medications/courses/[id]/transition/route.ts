import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { createClient } from "@/lib/supabase/server"
import {
  MedicationCourseConflict,
  MedicationCourseNotFound,
  transitionMedicationCourse,
} from "@/lib/medication-course-store"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTIONS = new Set(["pause", "resume", "stop", "complete"])
const CONFIRMERS = new Set(["self", "doctor", "pharmacist", "caregiver"])

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const effectiveAt = typeof body?.effectiveAt === "string" ? body.effectiveAt : ""
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : ""
  const action = typeof body?.action === "string" ? body.action : ""
  const confirmedBy = typeof body?.confirmedBy === "string" ? body.confirmedBy : ""

  if (!UUID.test(id) || !ACTIONS.has(action) || !CONFIRMERS.has(confirmedBy)
    || !effectiveAt || Number.isNaN(Date.parse(effectiveAt)) || !idempotencyKey) {
    return NextResponse.json({ error: "ข้อมูลยืนยันการเปลี่ยนสถานะไม่ครบหรือไม่ถูกต้อง" }, { status: 400 })
  }

  try {
    const db = await createClient()
    const course = await transitionMedicationCourse({
      courseId: id,
      userId: user.id,
      action: action as "pause" | "resume" | "stop" | "complete",
      effectiveAt,
      reason: typeof body?.reason === "string" ? body.reason : null,
      confirmedBy: confirmedBy as "self" | "doctor" | "pharmacist" | "caregiver",
      idempotencyKey,
    }, db)
    return NextResponse.json({ course })
  } catch (error) {
    if (error instanceof MedicationCourseConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof MedicationCourseNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "เปลี่ยนสถานะไม่สำเร็จ" }, { status: 500 })
  }
}
