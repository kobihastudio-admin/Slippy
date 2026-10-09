import assert from "node:assert/strict"
import test from "node:test"

import { getPublicOrigin } from "./public-origin.ts"

process.env.NEXT_PUBLIC_APP_URL = "https://dev.slippyai.app"

const h = (obj) => ({ get: (k) => obj[k.toLowerCase()] ?? null })

test("uses the forwarded public host and scheme", () => {
  assert.equal(
    getPublicOrigin(h({ "x-forwarded-host": "dev.slippyai.app", "x-forwarded-proto": "https" })),
    "https://dev.slippyai.app",
  )
})

test("falls back to the Host header when nothing is forwarded", () => {
  assert.equal(getPublicOrigin(h({ host: "dev.slippyai.app" })), "https://dev.slippyai.app")
})

test("uses http for localhost with an explicit port", () => {
  assert.equal(getPublicOrigin(h({ host: "localhost:3000" })), "http://localhost:3000")
})

test("takes the first value of a comma-separated forwarded list", () => {
  assert.equal(
    getPublicOrigin(h({ "x-forwarded-host": "dev.slippyai.app, internal:3000", "x-forwarded-proto": "https, http" })),
    "https://dev.slippyai.app",
  )
})

test("ignores an unknown forwarded scheme", () => {
  assert.equal(
    getPublicOrigin(h({ "x-forwarded-host": "dev.slippyai.app", "x-forwarded-proto": "javascript" })),
    "https://dev.slippyai.app",
  )
})

test("rejects a malformed host and uses the configured app URL", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.slippyai.app/"
  try {
    assert.equal(getPublicOrigin(h({ host: "evil.com/path?x=1" })), "https://dev.slippyai.app")
    assert.equal(getPublicOrigin(h({})), "https://dev.slippyai.app")
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = saved
  }
})

test("a spoofed host that is not the configured app host is ignored", () => {
  assert.equal(
    getPublicOrigin(h({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })),
    "https://dev.slippyai.app",
  )
  assert.equal(getPublicOrigin(h({ host: "bf6801baa76d:3000" })), "https://dev.slippyai.app")
})
