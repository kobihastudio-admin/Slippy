import assert from "node:assert/strict"
import test from "node:test"
import {
  allowedLifecycleActions,
  courseDisplayState,
  groupDoseTimeline,
  summarizeRound,
  todayProgress,
} from "./medication-lifecycle.ts"

const occurrence = (overrides = {}) => ({
  id: "dose-1",
  courseId: "course-1",
  slotId: "slot-1",
  medicationId: "med-1",
  medicationName: "SERC 24 mg",
  doseQty: 1,
  unit: "เม็ด",
  scheduledAt: "2026-09-03T08:00:00+07:00",
  timeLabel: "08:00",
  periodLabel: "morning",
  status: "pending",
  courseStatus: "active",
  ...overrides,
})

test("active and paused courses expose only valid next actions", () => {
  assert.deepEqual(allowedLifecycleActions("active"), ["pause", "stop", "complete"])
  assert.deepEqual(allowedLifecycleActions("paused"), ["resume", "stop"])
  assert.deepEqual(allowedLifecycleActions("stopped"), [])
  assert.deepEqual(allowedLifecycleActions("completed"), [])
})

test("a round is due until every medication has a terminal status", () => {
  assert.equal(summarizeRound([
    occurrence({ id: "taken", status: "taken" }),
    occurrence({ id: "pending", medicationId: "med-2" }),
  ]).status, "due")
})

test("taken and intentionally skipped medicines complete the round independently", () => {
  const summary = summarizeRound([
    occurrence({ id: "taken", status: "taken" }),
    occurrence({ id: "skipped", medicationId: "med-2", status: "skipped" }),
  ])
  assert.equal(summary.status, "complete")
  assert.equal(summary.taken, 1)
  assert.equal(summary.resolved, 2)
})

test("timeline groups same-time medicines together and orders bedtime last", () => {
  const groups = groupDoseTimeline([
    occurrence({ id: "bed", timeLabel: "ก่อนนอน", periodLabel: "bedtime", scheduledAt: "2026-09-03T22:00:00+07:00" }),
    occurrence({ id: "morning-a" }),
    occurrence({ id: "morning-b", medicationId: "med-2", slotId: "slot-2" }),
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].timeLabel, "08:00")
  assert.deepEqual(groups[0].occurrences.map(item => item.id), ["morning-a", "morning-b"])
  assert.equal(groups[1].timeLabel, "ก่อนนอน")
})

test("paused courses are excluded from today's active dose timeline", () => {
  assert.equal(groupDoseTimeline([
    occurrence({ courseStatus: "paused" }),
  ]).length, 0)
})

test("progress counts doses rather than medication cards", () => {
  assert.deepEqual(todayProgress([
    occurrence({ id: "a", status: "taken" }),
    occurrence({ id: "b", slotId: "slot-2", status: "late" }),
    occurrence({ id: "c", slotId: "slot-3", status: "skipped" }),
    occurrence({ id: "d", slotId: "slot-4", status: "pending" }),
  ]), { taken: 2, resolved: 3, total: 4, percent: 50 })
})

test("an active course at its planned end waits for confirmation", () => {
  assert.equal(courseDisplayState({
    status: "active",
    startDate: "2026-08-01",
    plannedEndDate: "2026-09-03",
  }, "2026-09-03"), "due_for_review")
})

test("a future active course is shown as upcoming", () => {
  assert.equal(courseDisplayState({
    status: "active",
    startDate: "2026-09-10",
    plannedEndDate: null,
  }, "2026-09-03"), "upcoming")
})
