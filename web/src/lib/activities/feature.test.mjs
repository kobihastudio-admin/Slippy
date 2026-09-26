import assert from "node:assert/strict"
import test from "node:test"

import { activitiesDisabledBody, isActivitiesEnabled } from "./feature.ts"

test("Activities are enabled by default", () => {
  assert.equal(isActivitiesEnabled(undefined), true)
  assert.equal(isActivitiesEnabled(""), true)
})

test("Only the exact value 0 disables Activities", () => {
  assert.equal(isActivitiesEnabled("0"), false)
  for (const value of ["1", "true", "false", "off", " 0", "00", "no"]) {
    assert.equal(isActivitiesEnabled(value), true, `"${value}" must not disable`)
  }
})

test("Disabled response does not reveal that the feature exists", () => {
  assert.deepEqual(activitiesDisabledBody, { error: "Not found" })
})

// Static guard: every Activities entry point must consult the flag, so a new
// handler added later without the guard fails here instead of silently bypassing
// the kill switch.
import { readFileSync } from "node:fs"

const GUARDED = [
  ["src/app/api/activities/route.ts", 2],
  ["src/app/api/activities/[id]/route.ts", 1],
  ["src/app/api/activities/[id]/registration-links/route.ts", 1],
  ["src/app/join/[token]/route.ts", 1],
  ["src/app/(app)/activities/page.tsx", 1],
  ["src/app/(app)/activities/[id]/page.tsx", 1],
]

for (const [file, expected] of GUARDED) {
  test(`${file} checks ACTIVITIES_ENABLED`, () => {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8")
    const guards = source.split("isActivitiesEnabled(process.env.ACTIVITIES_ENABLED)").length - 1
    const handlers = (source.match(/export (?:default )?async function /g) ?? []).length
    assert.equal(guards, expected)
    assert.equal(handlers, expected, "every exported handler needs a guard")
  })
}

test("Sidebar hides the Activities entry when the public flag is 0", () => {
  const source = readFileSync(new URL("../../components/layout/sidebar.tsx", import.meta.url), "utf8")
  assert.match(source, /isActivitiesEnabled\(process\.env\.NEXT_PUBLIC_ACTIVITIES_ENABLED\)/)
})
