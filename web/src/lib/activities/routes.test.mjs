import assert from "node:assert/strict"
import test from "node:test"

import { feedHref } from "./routes.ts"

test("Feed points at the canonical activity route", () => {
  assert.equal(feedHref("a-1"), "/activities/a-1")
})
