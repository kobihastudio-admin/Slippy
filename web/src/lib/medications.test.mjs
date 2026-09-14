import assert from "node:assert/strict"
import test from "node:test"
import { updateMedication, deactivateMedication } from "./medications.ts"

/**
 * What these guard against, each silent when it breaks:
 *   • "delete" that quietly wipes a person's entire dose-taking history —
 *     the bug this whole fix exists for (iOS's old deleteMedication did a
 *     hard `.delete()`; medications/schedules/inventory/logs cascade off
 *     `medications.id` in 031_medication_tracking.sql).
 *   • an edit that re-inserts the schedule/inventory row instead of updating
 *     it in place — medication_logs.schedule_id would keep pointing at a row
 *     that no longer exists.
 *   • a write that isn't scoped to the caller's own user_id, which would let
 *     one user's PATCH/DELETE reach another user's medication if RLS were
 *     ever misconfigured — defense in depth, not the only gate.
 */

/**
 * Minimal in-memory Supabase-query-builder stand-in — same spirit as
 * trip-conversation.test.mjs's fakeDb, sized for the chains
 * lib/medications.ts actually uses: `.update(patch).eq(a).eq(b)` and
 * `.insert(row)`, both lazily executed on await (matching real
 * supabase-js, where nothing runs until the chain is awaited).
 */
function fakeDb(seed = {}) {
  const tables = {
    medications: seed.medications ?? [],
    medication_schedules: seed.medication_schedules ?? [],
    medication_inventory: seed.medication_inventory ?? [],
    medication_logs: seed.medication_logs ?? [],
  }
  const deletesCalled = []

  function builder(table) {
    const filters = []
    let pendingUpdate = null
    let pendingInsert = null

    function matching() {
      return tables[table].filter(r => filters.every(f => f(r)))
    }

    function exec() {
      if (pendingInsert) {
        const list = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert]
        const stored = list.map(row => {
          const s = { id: `${table}-${tables[table].length + 1}`, ...row }
          tables[table].push(s)
          return s
        })
        return Promise.resolve({ data: stored, error: null })
      }
      const rows = matching()
      if (pendingUpdate) {
        for (const r of rows) Object.assign(r, pendingUpdate)
      }
      return Promise.resolve({ data: rows, error: null })
    }

    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      update(patch) { pendingUpdate = patch; return api },
      insert(row) { pendingInsert = row; return api },
      // Never actually used by the fix under test — its whole point is that
      // it must not be. Present only so a regression that calls it fails
      // loudly instead of throwing "not a function".
      delete() { deletesCalled.push(table); return api },
      then(resolve, reject) { return exec().then(resolve, reject) },
    }
    return api
  }

  return { from: builder, _tables: tables, _deletesCalled: deletesCalled }
}

function seedMedication(overrides = {}) {
  return {
    medications: [{ id: "med-1", user_id: "user-1", name: "พารา", is_active: true, ...overrides.medication }],
    medication_schedules: overrides.schedule
      ? [{ id: "sched-1", medication_id: "med-1", user_id: "user-1", times: ["08:00"], dose_qty: 1, meal_relation: "any", reminder_enabled: true, ...overrides.schedule }]
      : [],
    medication_inventory: overrides.inventory
      ? [{ id: "inv-1", medication_id: "med-1", user_id: "user-1", qty_remaining: 30, qty_unit: "เม็ด", low_stock_alert: 7, ...overrides.inventory }]
      : [],
    medication_logs: overrides.logs ?? [{ id: "log-1", medication_id: "med-1", schedule_id: "sched-1", user_id: "user-1", status: "taken" }],
  }
}

// ── The core safety fix: deactivate, never delete ──────────────────────────

test("deactivateMedication sets is_active = false and never calls .delete()", async () => {
  const db = fakeDb(seedMedication({ schedule: {}, inventory: {} }))
  await deactivateMedication("med-1", "user-1", db)

  const med = db._tables.medications.find(m => m.id === "med-1")
  assert.equal(med.is_active, false)
  assert.equal(db._deletesCalled.length, 0, "must never issue a DELETE — see the file header on why")
})

test("deactivateMedication preserves the medication row and its dose history", async () => {
  const db = fakeDb(seedMedication({ schedule: {}, inventory: {} }))
  await deactivateMedication("med-1", "user-1", db)

  // The row itself still exists — soft delete, not gone.
  assert.equal(db._tables.medications.length, 1)
  assert.equal(db._tables.medications[0].id, "med-1")
  // Nothing cascaded: schedule, inventory, and — the part that actually
  // matters to someone — the dose log are all exactly as seeded.
  assert.equal(db._tables.medication_schedules.length, 1)
  assert.equal(db._tables.medication_inventory.length, 1)
  assert.equal(db._tables.medication_logs.length, 1)
  assert.deepEqual(db._tables.medication_logs[0], { id: "log-1", medication_id: "med-1", schedule_id: "sched-1", user_id: "user-1", status: "taken" })
})

test("deactivateMedication is scoped to the caller's own user_id", async () => {
  const db = fakeDb(seedMedication({}))
  await deactivateMedication("med-1", "someone-else", db)

  // Wrong user_id in the filter — matches nothing, changes nothing.
  const med = db._tables.medications.find(m => m.id === "med-1")
  assert.equal(med.is_active, true)
})

// ── Edit updates schedule/inventory by id, never re-inserts them ───────────

test("updateMedication with an existing scheduleId updates that row, not a new one", async () => {
  const db = fakeDb(seedMedication({ schedule: {} }))
  await updateMedication("med-1", "user-1", {
    name: "พารา 500", scheduleId: "sched-1", times: ["08:00", "20:00"], dose_qty: 2,
  }, db)

  assert.equal(db._tables.medication_schedules.length, 1, "must update in place, not insert a second row")
  const sched = db._tables.medication_schedules[0]
  assert.equal(sched.id, "sched-1")
  assert.deepEqual(sched.times, ["08:00", "20:00"])
  assert.equal(sched.dose_qty, 2)
})

test("updateMedication with an existing inventoryId updates that row, not a new one", async () => {
  const db = fakeDb(seedMedication({ inventory: {} }))
  await updateMedication("med-1", "user-1", {
    name: "พารา", inventoryId: "inv-1", qty_remaining: 12, low_stock_alert: 5,
  }, db)

  assert.equal(db._tables.medication_inventory.length, 1, "must update in place, not insert a second row")
  const inv = db._tables.medication_inventory[0]
  assert.equal(inv.id, "inv-1")
  assert.equal(inv.qty_remaining, 12)
  assert.equal(inv.low_stock_alert, 5)
})

test("updateMedication always edits the medication's own fields", async () => {
  const db = fakeDb(seedMedication({}))
  await updateMedication("med-1", "user-1", { name: "พารา 650", strength: "650mg", purpose: "ลดไข้" }, db)

  const med = db._tables.medications[0]
  assert.equal(med.name, "พารา 650")
  assert.equal(med.strength, "650mg")
  assert.equal(med.purpose, "ลดไข้")
})

test("updateMedication persists the verbatim label note after scan review", async () => {
  const db = fakeDb(seedMedication({}))
  const labelNote = "รับประทานครั้งละ 1 เม็ด หลังอาหารทันที"
  await updateMedication("med-1", "user-1", { name: "SERC", notes: labelNote }, db)

  assert.equal(db._tables.medications[0].notes, labelNote)
})

// ── A medication with no existing schedule/inventory gets one inserted ─────

test("updateMedication with no scheduleId inserts one, only when times is non-empty", async () => {
  const db = fakeDb(seedMedication({})) // no schedule seeded
  await updateMedication("med-1", "user-1", { name: "พารา", times: ["09:00"], dose_qty: 1 }, db)

  assert.equal(db._tables.medication_schedules.length, 1)
  assert.equal(db._tables.medication_schedules[0].medication_id, "med-1")
})

test("updateMedication with no scheduleId and no times inserts nothing", async () => {
  const db = fakeDb(seedMedication({}))
  await updateMedication("med-1", "user-1", { name: "พารา" }, db)

  assert.equal(db._tables.medication_schedules.length, 0)
})

test("updateMedication with no inventoryId inserts one, only when qty_remaining > 0", async () => {
  const db = fakeDb(seedMedication({}))
  await updateMedication("med-1", "user-1", { name: "พารา", qty_remaining: 30 }, db)

  assert.equal(db._tables.medication_inventory.length, 1)
  assert.equal(db._tables.medication_inventory[0].qty_remaining, 30)
})

test("updateMedication is scoped to the caller's own user_id", async () => {
  const db = fakeDb(seedMedication({}))
  await updateMedication("med-1", "someone-else", { name: "ชื่อปลอม" }, db)

  const med = db._tables.medications[0]
  assert.equal(med.name, "พารา", "a mismatched user_id must not change anyone's row")
})
