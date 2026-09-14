import assert from "node:assert/strict"
import test from "node:test"

import { canSeedDemoData } from "./demo-access.ts"

test("demo seeding is disabled outside local development", () => {
  assert.equal(canSeedDemoData("production"), false)
  assert.equal(canSeedDemoData("test"), false)
})

test("demo seeding is available only to local development", () => {
  assert.equal(canSeedDemoData("development"), true)
})
