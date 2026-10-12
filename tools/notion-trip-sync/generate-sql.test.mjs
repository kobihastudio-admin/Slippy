import assert from "node:assert/strict"
import test from "node:test"

import { generate, lit } from "./generate-sql.mjs"

const snapshot = {
  journeyId: "80a16ea3-97d7-45cb-956f-6809419e37bd",
  days: [{ key: "day-1", day_number: 1, date: "2026-11-21", title: "Fukuoka", city: "Fukuoka", summary: "arrive",
    items: [{ key: "hotel-blossom", type: "hotel", title: "Blossom's", location: "Hakata", status: "confirmed", amount: 190224 }] }],
  checklist: [{ key: "passport", title: "Passport", category: "Documents", is_done: true }],
  notes: [{ key: "todo", title: "To check", body: "O'Brien $5", tag: "todo", is_pinned: true }],
  candidates: [{ key: "v:kushida", kind: "place", day_number: 1, title: "Kushida Shrine", status: "wanted" }],
}

test("insert-only never overwrites existing rows", () => {
  const sql = generate(snapshot)
  assert.match(sql, /^-- generated insert-only sync/)
  assert.ok(!sql.includes("DO UPDATE"))
  assert.equal((sql.match(/DO NOTHING/g) ?? []).length, 6)   // day, item, checklist, note, candidate, activity mirror
  assert.match(sql, /BEGIN;/)
  assert.match(sql, /COMMIT;/)
})

test("update mode overwrites content fields but leaves group-owned state alone", () => {
  const sql = generate(snapshot, { mode: "update" })
  assert.match(sql, /trip_checklist_items[\s\S]*DO UPDATE SET title = EXCLUDED.title, category = EXCLUDED.category, sort_order = EXCLUDED.sort_order/)
  assert.ok(!/DO UPDATE SET[^;]*is_done/.test(sql), "is_done must not be overwritten")
  assert.ok(!/DO UPDATE SET[^;]*status = EXCLUDED.status[^;]*sort_order = EXCLUDED.sort_order[\s\S]*trip_place_candidates/.test(sql))
  const candidate = sql.split("INSERT INTO trip_place_candidates")[1].split(";")[0]
  assert.ok(!candidate.includes("status = EXCLUDED.status"), "candidate status is decided in the app")
})

test("strings are dollar-quoted so quotes and dollars are safe", () => {
  assert.equal(lit("O'Brien"), "$s$O'Brien$s$")
  assert.equal(lit(null), "NULL")
  assert.equal(lit(5), "5")
  assert.equal(lit(true), "true")
  assert.throws(() => lit("evil $s$ break"), /contains/)
  assert.ok(generate(snapshot).includes("$s$O'Brien $5$s$"))
})

test("rows without a key or with a duplicate key are rejected", () => {
  assert.throws(() => generate({ ...snapshot, checklist: [{ title: "x" }] }), /missing a string "key"/)
  assert.throws(() => generate({ ...snapshot, notes: [snapshot.notes[0], snapshot.notes[0]] }), /duplicate note key/)
  assert.throws(() => generate({ ...snapshot, journeyId: "nope" }), /uuid/)
})
