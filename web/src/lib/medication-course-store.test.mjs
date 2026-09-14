import assert from "node:assert/strict"
import test from "node:test"
import {
  MedicationCourseConflict,
  transitionMedicationCourse,
} from "./medication-course-store.ts"

function fakeDb({ rpcError = null } = {}) {
  const calls = []
  const db = {
    from(table) {
      const filters = []
      const query = {
        select() { return query },
        eq(column, value) { filters.push([column, value]); return query },
        async maybeSingle() {
          calls.push({ kind: "read", table, filters })
          return { data: { id: "course-1", user_id: "user-1" }, error: null }
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args })
      return rpcError
        ? { data: null, error: rpcError }
        : { data: { id: "course-1", medication_id: "med-1", user_id: "user-1", status: "paused", start_date: "2026-09-01", planned_end_date: null }, error: null }
    },
    _calls: calls,
  }
  return db
}

const input = {
  courseId: "course-1",
  userId: "user-1",
  action: "pause",
  effectiveAt: "2026-09-03T09:00:00+07:00",
  reason: "พักตามคำแนะนำแพทย์",
  confirmedBy: "doctor",
  idempotencyKey: "event-123",
}

test("scopes the course lookup to both course and authenticated user", async () => {
  const db = fakeDb()
  await transitionMedicationCourse(input, db)
  assert.deepEqual(db._calls[0], {
    kind: "read",
    table: "medication_courses",
    filters: [["id", "course-1"], ["user_id", "user-1"]],
  })
})

test("forwards lifecycle confirmation and idempotency key to the RPC", async () => {
  const db = fakeDb()
  const course = await transitionMedicationCourse(input, db)
  assert.equal(course.status, "paused")
  assert.deepEqual(db._calls[1].args, {
    p_course_id: "course-1",
    p_action: "pause",
    p_effective_at: "2026-09-03T09:00:00+07:00",
    p_reason: "พักตามคำแนะนำแพทย์",
    p_confirmed_by: "doctor",
    p_idempotency_key: "event-123",
  })
})

test("maps stale transition database errors to MedicationCourseConflict", async () => {
  const db = fakeDb({ rpcError: { code: "40001", message: "invalid or stale medication course transition" } })
  await assert.rejects(
    transitionMedicationCourse(input, db),
    error => error instanceof MedicationCourseConflict,
  )
})

test("never hard-deletes medication history", async () => {
  const db = fakeDb()
  await transitionMedicationCourse(input, db)
  assert.equal(db._calls.some(call => call.kind === "delete"), false)
})
