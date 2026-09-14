import test from "node:test"
import assert from "node:assert/strict"

import { profileTabs, profilePlanLabel } from "./profile-sections.ts"

test("profile only exposes sections with an available user action", () => {
  assert.deepEqual(profileTabs.map((tab) => tab.key), ["info", "security"])
})

test("profile plan labels stay short enough for compact layouts", () => {
  assert.equal(profilePlanLabel("free"), "Free")
  assert.equal(profilePlanLabel("pro"), "Pro")
  assert.equal(profilePlanLabel("enterprise"), "Enterprise")
})
