import assert from "node:assert/strict"
import test from "node:test"

import { canListOrganizationClaims, canViewClaim } from "./claims-auth.ts"

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

test("a claim is readable by reviewers and by its own submitter only", () => {
  assert.equal(canViewClaim("owner", "u1", "u2"), true)
  assert.equal(canViewClaim("accountant", "u1", "u2"), true)
  assert.equal(canViewClaim("viewer", "u1", "u1"), true)
  assert.equal(canViewClaim("viewer", "u1", "u2"), false)
  assert.equal(canViewClaim(null, "u1", "u2"), false)
  assert.equal(canViewClaim("viewer", null, "u2"), false)
  assert.equal(canViewClaim("viewer", "u1", null), false)
})
