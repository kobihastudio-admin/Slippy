import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server.js"
import {
  getBearerToken,
  getVerifiedLineUserId,
  VERIFIED_LINE_USER_HEADER,
  verifyLineAccessToken,
} from "./liff-auth.ts"

test("getBearerToken accepts only Bearer authorization", () => {
  const valid = new NextRequest("https://slippy.test/api/liff/profile", {
    headers: { Authorization: "Bearer line-access-token" },
  })
  const invalid = new NextRequest("https://slippy.test/api/liff/profile", {
    headers: { Authorization: "Basic credentials" },
  })

  assert.equal(getBearerToken(valid), "line-access-token")
  assert.equal(getBearerToken(invalid), null)
})

test("getVerifiedLineUserId rejects a claimed identity mismatch", () => {
  const request = new NextRequest("https://slippy.test/api/liff/profile", {
    headers: { [VERIFIED_LINE_USER_HEADER]: "Uverified" },
  })

  assert.equal(getVerifiedLineUserId(request), "Uverified")
  assert.equal(getVerifiedLineUserId(request, "Uverified"), "Uverified")
  assert.equal(getVerifiedLineUserId(request, "Uattacker"), null)
})

test("verifyLineAccessToken returns the LINE profile for a valid token", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer valid-token")
    return Response.json({ userId: "Uverified", displayName: "Verified User" })
  }

  try {
    const profile = await verifyLineAccessToken("valid-token")
    assert.equal(profile?.userId, "Uverified")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("verifyLineAccessToken rejects an invalid token", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 })

  try {
    assert.equal(await verifyLineAccessToken("invalid-token"), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
