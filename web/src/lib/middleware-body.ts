/**
 * Why middleware waits for the request body (see docs/superpowers/specs/2026-11-13-trip-document-upload-design.md).
 *
 * `src/middleware.ts` runs on the Node.js runtime (ioredis needs raw sockets). Next 15.5 clones every request body in
 * front of middleware, and on the Node.js runtime it calls the clone's `finalize()` after the middleware WITHOUT awaiting
 * it (next/dist/server/next-server.js). If the body is still arriving when the middleware returns (a large file, a slow
 * connection, or simply a middleware that awaits a network call), the route handler is handed a request body that was
 * already partly read, and building the Request throws
 * `TypeError: Response body object should not be disturbed or locked`. The visitor gets an HTML 500 page instead of JSON;
 * the client then reports "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง". Small bodies that arrive before the middleware finishes are fine,
 * which is why only bigger or slower uploads failed.
 *
 * Draining the middleware's own copy of the body to its end before the middleware returns makes the clone complete first.
 * Reproduced and verified on a minimal Next 15.5.18 app with a Node.js-runtime middleware: 12 of 12 combinations of
 * file size (0.3 / 12 MB), middleware delay and upload speed pass with the drain, the control without it fails exactly
 * when the middleware finishes before the body does.
 */

/**
 * Reads `request.body` (the middleware's copy) to its end and returns how many bytes arrived. It keeps nothing (a large
 * upload is not held in memory twice) and never fails the request: if the client goes away midway the read just stops.
 */
export async function drainRequestBody(request: { method: string; body: ReadableStream<Uint8Array> | null }): Promise<number> {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) return 0
  const reader = request.body.getReader()
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value?.byteLength ?? 0
    }
  } catch {
    // aborted upload: whatever arrived is all there is; the route (or Next) deals with the incomplete body
  }
  return bytes
}

/** True for a middleware response that lets the request go on to a route handler (`NextResponse.next()` family). */
export function continuesToRoute(headers: Headers): boolean {
  return headers.get("x-middleware-next") === "1"
}
