// Static guard: src/middleware.ts must keep draining the request body before a request goes on to a route.
// Run: cd web && node --test src/lib/middleware-wiring.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const src = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8")

test("middleware is a thin wrapper: handleRequest first, then drain the body only when the request continues to a route", () => {
  const m = src.match(/export async function middleware\(request: NextRequest\) \{([\s\S]*?)\n\}/)
  assert.ok(m, "exported middleware wrapper missing")
  assert.match(m[1], /const response = await handleRequest\(request\)/)
  assert.match(m[1], /if \(continuesToRoute\(response\.headers\)\) await drainRequestBody\(request\)/)
  assert.match(m[1], /return response/)
})

test("the old handler body is kept as handleRequest, and the helpers are imported", () => {
  assert.match(src, /async function handleRequest\(request: NextRequest\)/)
  assert.match(src, /import \{ continuesToRoute, drainRequestBody \} from "@\/lib\/middleware-body"/)
  assert.equal((src.match(/export async function middleware/g) ?? []).length, 1)
})

test("the runtime stays nodejs (the rate limiter needs raw sockets) and the matcher is untouched", () => {
  assert.match(src, /runtime: "nodejs"/)
  assert.match(src, /"\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\|\.\*\\\\\.\(\?:svg\|png\|jpg\|jpeg\|gif\|webp\)\$\)\.\*\)"/)
})
