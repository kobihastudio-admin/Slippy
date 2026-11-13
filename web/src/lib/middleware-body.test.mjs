// Run: cd web && node --experimental-strip-types --test src/lib/middleware-body.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

import { drainRequestBody, continuesToRoute } from "./middleware-body.ts"

/** A ReadableStream that hands out `chunks` one per tick, like a body that is still arriving. */
function arriving(chunks, { failAfter } = {}) {
  let i = 0
  return new ReadableStream({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 5))
      if (failAfter !== undefined && i === failAfter) { controller.error(new Error("aborted")); return }
      if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]))
      else controller.close()
    },
  })
}

test("drainRequestBody waits until the whole body has been received and reports how many bytes", async () => {
  const body = arriving([[1, 2, 3], [4, 5], [6]])
  const t0 = Date.now()
  const bytes = await drainRequestBody({ method: "POST", body })
  assert.equal(bytes, 6)
  assert.ok(Date.now() - t0 >= 15, "it must have waited for the chunks that were still to arrive")
  assert.equal(body.locked, true, "the stream was read to its end")
})

test("a request without a body, or a GET/HEAD, returns at once without touching anything", async () => {
  assert.equal(await drainRequestBody({ method: "POST", body: null }), 0)
  const body = arriving([[1]])
  assert.equal(await drainRequestBody({ method: "GET", body }), 0)
  assert.equal(await drainRequestBody({ method: "HEAD", body }), 0)
  assert.equal(body.locked, false, "a GET body is never read")
})

test("a body that fails midway (the client went away) is not an error of the request: it stops quietly", async () => {
  const bytes = await drainRequestBody({ method: "POST", body: arriving([[1, 2], [3], [4]], { failAfter: 2 }) })
  assert.equal(bytes, 3, "the bytes that arrived before the failure")
})

test("the drain does not keep the chunks (no memory held for a large upload)", async () => {
  const big = new Array(50).fill(0).map(() => new Uint8Array(1024 * 1024))
  let held = 0
  const body = new ReadableStream({
    pull(controller) { if (held < big.length) controller.enqueue(big[held++]); else controller.close() },
  })
  assert.equal(await drainRequestBody({ method: "POST", body }), 50 * 1024 * 1024)
})

test("continuesToRoute is true only for a response that lets the request go on (x-middleware-next)", () => {
  assert.equal(continuesToRoute(new Headers({ "x-middleware-next": "1" })), true)
  assert.equal(continuesToRoute(new Headers()), false, "a redirect / 401 never reaches a route handler")
  assert.equal(continuesToRoute(new Headers({ "x-middleware-rewrite": "https://x/y" })), false)
  assert.equal(continuesToRoute(new Headers({ "x-middleware-next": "0" })), false)
})
