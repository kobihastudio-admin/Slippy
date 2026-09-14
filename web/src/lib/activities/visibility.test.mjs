import test from "node:test"
import assert from "node:assert/strict"
import { canDiscoverActivity, canJoinRegistration } from "./visibility.ts"

test("private activity is hidden from a stranger", () => {
  assert.equal(
    canDiscoverActivity(
      { ownerId: "owner", visibility: "private", status: "published" },
      { userId: "stranger" },
    ),
    false,
  )
})

test("only published public activity is discoverable anonymously", () => {
  assert.equal(
    canDiscoverActivity(
      { ownerId: "owner", visibility: "public", status: "published" },
      { userId: null },
    ),
    true,
  )
  assert.equal(
    canDiscoverActivity(
      { ownerId: "owner", visibility: "public", status: "cancelled" },
      { userId: null },
    ),
    false,
  )
})

test("expired, revoked, and full registration links cannot join", () => {
  const now = new Date("2026-09-03T00:00:00Z")
  assert.equal(
    canJoinRegistration(
      { expiresAt: "2026-09-02T00:00:00Z", revokedAt: null, maxUses: 1, useCount: 0 },
      now,
    ),
    false,
  )
  assert.equal(
    canJoinRegistration(
      { expiresAt: null, revokedAt: "2026-09-01T00:00:00Z", maxUses: 1, useCount: 0 },
      now,
    ),
    false,
  )
  assert.equal(
    canJoinRegistration(
      { expiresAt: null, revokedAt: null, maxUses: 1, useCount: 1 },
      now,
    ),
    false,
  )
})
