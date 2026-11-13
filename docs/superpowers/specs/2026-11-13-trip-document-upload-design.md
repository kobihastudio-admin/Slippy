# Uploads through middleware: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ไฟล์อาจใหญ่เกินไป"

Status: root cause found and reproduced; fix written and tested locally (tests, type-check, a Next 15.5.18 repro). NOT committed, NOT deployed: each needs its own approval. Date: 2026-11-13 (Asia/Bangkok).
Files: `web/src/lib/middleware-body.ts` (+ `middleware-body.test.mjs`, `middleware-wiring.test.mjs`), `web/src/middleware.ts`, `web/src/components/trips/trip-journey-client.tsx`.

## 1. Report

Uploading a file in the trip document manager on the web shows "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ไฟล์อาจใหญ่เกินไป". The user also reported that the native app has no document management/upload.

## 2. Cause

- The web container log has `TypeError: Response body object should not be disturbed or locked` at `NextRequestAdapter.fromNodeNextRequest` for
  `POST /api/trips/[id]/documents`, twice on 2026-11-13 at 04:07Z (the user's attempts). The route answered with Next's HTML 500 page; the client's
  `res.json()` failed and showed its generic fallback text. The size was not the problem: the route's own limit is 15 MB and answers JSON (413).
- `src/middleware.ts` runs on the **Node.js runtime** (`runtime: "nodejs"`, ioredis). Next 15.5 clones every request body in front of middleware and, on the Node.js
  runtime, calls the clone's `finalize()` after the middleware **without awaiting it** (`next/dist/server/next-server.js`, `requestData.body.finalize()`; the Edge path awaits it).
  If the body is still arriving when the middleware returns, the route handler gets a body that was already partly read and building the Request throws.
  The real middleware awaits Supabase auth and a Redis rate limit before returning, so a body that takes longer than that to arrive (a larger file or a slower connection) fails;
  small files that arrive first work, which is why it looked like a size problem.
- Every route that takes a request body is exposed, not only trip documents (trip photos, `import-document`, `expenses/scan`, medication scans, `liff/scan`, …).

## 3. Reproduction (minimal Next 15.5.18 app, outside the repo)

Node.js-runtime middleware with an awaited delay, a route that reads `formData()` like the real one; uploads with curl at limited speeds, and on Node 20.20.2 (the production runtime) as well:
- Control (no fix): HTTP 500 with the HTML page and the same stack as production exactly when the middleware finishes before the body does (12 MB at delay 100 ms or at 2 MB/s; 0.3 MB at delay 100 ms and 2 MB/s); no failure when the body completes first or the middleware does not await.
- With the fix: 12 of 12 combinations of size (0.3 / 12 MB), delay (0 / 100 / 800 ms) and speed (100M / 2M per second) pass; over the 25 MB middleware clone limit the route's own 400 answers; three uploads aborted midway leave the server answering; 12 parallel uploads pass; no TypeError in the log.
- Note: an Edge-runtime middleware (the default) did not fail, which is why a first repro with the default runtime found nothing.

## 4. Fix

- `drainRequestBody(request)` (`lib/middleware-body.ts`) reads the middleware's own copy of the body to its end, keeping nothing, and never fails the request (an aborted upload just stops the read).
  `middleware()` in `src/middleware.ts` became a wrapper: `handleRequest` (the previous function, unchanged) first, then, only when the response lets the request go on to a route (`x-middleware-next: 1`),
  the drain. Redirects, 401s and 429s return at once as before. The runtime, the matcher, authentication and the rate limit are not touched.
- The client's fallback message now says what happened: "ไฟล์ใหญ่เกินไป" only for a 413, otherwise "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (รหัส N) — ลองอัปโหลดใหม่อีกครั้ง".
- Cost: an upload now waits in the middleware for its own body, which the route would have waited for anyway; memory is not held twice (the drain discards chunks).

## 5. Verified

`middleware-body.test.mjs` (5), `middleware-wiring.test.mjs` (3: the wrapper shape, runtime and matcher untouched), `friend-invite.test.mjs` (7), `tsc --noEmit` over `web` clean, and the repro above with the REAL helper file.

## 6. Not verified

- The fix has not been run in the real app with a real session (middleware redirects every anonymous request, so a real upload needs a signed-in user); no `next build` of the real app yet (the deploy recipe does it); not deployed.
- Whether LINE/other clients behave differently behind the Cloudflare tunnel (HTTP/2 to the edge, HTTP/1.1 to the container) is unproven; the mechanism does not depend on it.

## 7. The native app

The user reported that the native app has no document manager/upload. The code has one: on the real trip screen (`JourneyWorkspaceView`, opened from the Trips list) the Overview tab has "Travel Wallet" (opens `TripDocumentsView`: list, "+" to pick a file, upload,
open, delete) in two places and "สแกนเอกสาร" (opens `TripImportDocumentSheet`, which reads a ticket/booking with AI), and `TripDetailView` has both in its menu. Both are in committed code. "Travel Wallet" uploads straight to the private
`trip-documents` bucket (15 MB, participants only; 13 rows exist) with the user's session and is NOT affected by this middleware bug; "สแกนเอกสาร" posts to `/api/trips/[id]/import-document` and IS (same cause). Why the section was not seen on the
device is not established (the buttons sit lower on the Overview tab, one is named in English, and the Trips toolbar has a separate "Journey Prototype" screen that is a demo without production data).

## 8. Approval needed

1. Commit and push the files above. 2. Deploy web (the usual thin-layer recipe; `next build` of the real app is part of it). 3. A manual upload test by the user after the deploy: a 5 MB and a 12 MB PDF/JPG into a trip's documents, on the web.
