import assert from "node:assert/strict"
import test from "node:test"

import { parseActivityInput } from "./input.ts"

test("activity input defaults to a private draft", () => {
  assert.deepEqual(parseActivityInput({ title: "Kumamoto walk" }), {
    title: "Kumamoto walk",
    summary: "",
    category: "general",
    visibility: "private",
    status: "draft",
    locationName: null,
    startsAt: null,
    endsAt: null,
    sourceType: "manual",
    sourceUrl: null,
    tripId: null,
    groupId: null,
  })
})

test("activity input rejects invalid title, source URL, and backwards dates", () => {
  assert.throws(() => parseActivityInput({ title: " " }), /title/i)
  assert.throws(() => parseActivityInput({ title: "x".repeat(161) }), /title/i)
  assert.throws(() => parseActivityInput({ title: "A", sourceUrl: "/local" }), /sourceUrl/i)
  assert.throws(() => parseActivityInput({
    title: "A",
    startsAt: "2026-11-22T10:00:00Z",
    endsAt: "2026-11-22T09:00:00Z",
  }), /endsAt/i)
})
