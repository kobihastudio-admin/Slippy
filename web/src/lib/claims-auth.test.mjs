import assert from "node:assert/strict"
import test from "node:test"

import { canListOrganizationClaims } from "./claims-auth.ts"

test("claim list organization-wide access is derived from stored membership roles", () => {
  assert.equal(canListOrganizationClaims("owner"), true)
  assert.equal(canListOrganizationClaims("admin"), true)
  assert.equal(canListOrganizationClaims("accountant"), true)
  assert.equal(canListOrganizationClaims("manager"), true)
})

test("submitter and untrusted request role values cannot list organization claims", () => {
  assert.equal(canListOrganizationClaims("submitter"), false)
  assert.equal(canListOrganizationClaims("viewer"), false)
  assert.equal(canListOrganizationClaims(""), false)
  assert.equal(canListOrganizationClaims(null), false)
  assert.equal(canListOrganizationClaims("manager&role=admin"), false)
})
