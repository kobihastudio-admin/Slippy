# API

Status: **derived from code** (`api/src/index.ts` and the route files it registers). Where this document and the code disagree, the code is right. This is the Fastify server's shape and auth model — individual route bodies are covered by their own domain doc (LINE_OA_SPEC.md, document-ingestion.md, SPLIT_BILL_SPEC.md, JOURNEY_MODULE_SPEC.md) where one exists.

## Server setup (`api/src/index.ts`)

- **CORS**: origin = the app's own web URL, `credentials: true`.
- **Multipart**: 20 MB file size limit.
- **Rate limiting**: Redis-backed (shares the BullMQ connection), 120 requests/minute globally. An `allowList` is meant to exempt Stripe webhooks from it — **see Known gaps, this does not currently work**.
- **Raw body capture**: the JSON content-type parser buffers the raw body onto `req.rawBody` before parsing, because LINE and Stripe webhook signatures are computed over the exact bytes received, not a re-serialized object.
- **Error handler**: any thrown error not carrying its own `statusCode` becomes a generic `500 "Internal server error"` — the real message is logged server-side but not leaked to the caller.

## Auth tiers

Four distinct trust levels, by registration order:

1. **Webhook routes — no shared auth.** Registered at root scope (not inside the `x-internal-key` plugin below) because each verifies its own provider signature: `stripeRoutes`, `lineRoutes`, `emailRoutes`, all under the `/webhooks` prefix. LINE verifies `x-line-signature` (HMAC-SHA256); Stripe verifies `stripe-signature`; email verifies a URL token (`EMAIL_WEBHOOK_TOKEN`) set in the Postmark webhook URL itself.
2. **Internal routes — `x-internal-key`.** A single shared secret, checked in a `preHandler` hook on a scoped plugin; everything registered inside it requires the header to match `INTERNAL_API_KEY` or gets `401`. This is how the Next.js web app calls the Fastify API server-to-server (see `INTERNAL_API_KEY`/`API_BASE_URL` in the web app's own env).
3. **Device-authenticated routes.** `userAuthedScope` verifies the caller's Supabase access token directly (not the internal key — an app bundle is not a secret) and sets `req.userId`. Used for calls that come straight from iOS/watchOS, which has no cookie jar to share with a browser session.
4. **Public, unauthenticated.** `GET /health`, `GET /health/queue`, the static icon, and the `/liff/*` redirect helper.

## Internal routes (require `x-internal-key`)

| Prefix / path | Module | Covered in |
|---|---|---|
| `/documents/*` | `documentsRoutes` | — |
| `/integrations/*` | `integrationsRoutes` | — |
| `/tax/*` | `taxRoutes` | — |
| `/life/*` (no extra prefix) | `lifeRoutes` | AI_MEMORY_SPEC.md, LIFE_GRAPH_SPEC.md |
| `/sport/notify` | `sportNotifyRoutes` | — |
| `/trip/notify` | `tripNotifyRoutes` | — |
| `/travel-doc/read` | `travelDocRoutes` | — |
| `/medication-label/read` | `medicationLabelRoutes` | — |
| `/medication-price/lookup` | `medicationPriceRoutes` | — |
| `/pdf/render` | `pdfRoutes` | — |
| `/trips/preorder/notify` | `tripPreorderNotifyRoutes` | JOURNEY_MODULE_SPEC.md |
| `/split/notify` | `splitNotifyRoutes` | SPLIT_BILL_SPEC.md |

## Device-authenticated routes

`/v1/sport-play/*` (`sportPlayRoutes`) — called directly from the iPhone/Apple Watch app. A comment in `index.ts` notes this used to live inside the `x-internal-key` plugin, which meant every watch call got `401` (an app bundle cannot hold that secret) until it was moved here and `req.userId` wired up.

## Health

- **`GET /health`** — liveness only: `{ status: "ok", ts }`.
- **`GET /health/queue`** — deep health, public, no auth. Reports: BullMQ queue reachability, whether workers run in-process or externally (`RUN_WORKERS`), a count of documents stuck in `status = "processing"` for more than 10 minutes (the symptom of a worker that died mid-extraction — invisible otherwise, since the queue itself still looks healthy), running AI token-usage totals, 30-minute abuse signals (reporting only — no automatic ban, since an untuned threshold would lock out paying customers before it stops real abuse), and whether the Document AI fallback is actually configured (checked against known placeholder values like `"YOUR_PROCESSOR_ID"`, which had previously sat silently unconfigured for months).

## Background workers

Covered in full in [document-ingestion.md](document-ingestion.md): in-process by default (`RUN_WORKERS`), the stranded-document recovery sweep (`services/recover-stranded.ts`, every 5 minutes), and the queue/inline ingestion contract.

## Known gaps

- **The Stripe rate-limit exemption does not work.** `stripeRoutes` is registered under the `/webhooks` prefix, so its real path is `POST /webhooks/stripe` — but the rate-limit `allowList` checks `req.url.startsWith("/stripe")`, which that path never matches. The comment states the intent plainly ("Stripe's own retry/burst behavior... must never get throttled by us"), but as written, Stripe webhook calls share the same 120/min global limit as everything else. Under a retry burst this could cause Stripe calls to be rate-limited and keep retrying. Not fixed here — flagged for a decision.
- This document lists `/documents`, `/integrations`, `/tax` only by prefix; their individual endpoints were not enumerated field-by-field.
