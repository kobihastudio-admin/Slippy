# Document Ingestion Architecture

How a receipt / slip / tax invoice gets from a user into the Life Graph, for
every channel. Written alongside the 2026-07-29 refactor that unified them.

## The problem this replaced

Each channel had grown its own trigger, and they had silently diverged:

| Channel | Trigger | Status before |
|---|---|---|
| LINE bot | `queueExtraction()` → BullMQ | **Broken.** No worker process existed in the container deployment (`api` runs `tsx src/index.ts`; there is no `workers` service in `docker-compose.yml`), so jobs were enqueued into a queue nobody consumed. |
| Email (Postmark) | `queueExtraction()` → BullMQ | **Broken**, same reason. |
| Web app | `runPipeline()` inline in the HTTP request | Worked. |
| iOS app | same inline route as web | Worked. |

Two channels accepted a user's receipt, replied "processing…", and then dropped
it forever. Nothing alerted on it because the documents simply stayed `pending`.

## The contract

One function, used by every channel:

```ts
ingestDocument(documentId, organizationId, opts) → { mode, ok, error? }
```

```
Channel                     ingestDocument                    Worker
───────                     ──────────────                    ──────
upload file to storage
insert documents row   ──▶  ① enqueue (BullMQ)          ──▶   runPipeline()
                            │   durable · retried ×3          └─▶ notify channel
                            │   idempotent per document
                            │
                            └─ ② queue unreachable?
                                 run runPipeline() INLINE
                                 (degraded, but never lost)
```

**Why the inline fallback matters.** A receipt that a user handed us must never
be silently dropped because Redis was down — which is exactly the failure mode
that hid for six weeks. Losing durability is acceptable; losing the document is
not. `ingestDocument` never throws, so a channel handler can always answer its
user.

## Guarantees

- **Never lost** — queue or inline, the pipeline runs.
- **Never double-run** — a healthy queue means the pipeline does *not* also run
  in-request; the worker owns it.
- **Idempotent** — job id is `extract-{documentId}`, so a duplicate webhook
  delivery collapses into one job.
- **Reprocessable** — `force: true` mints a unique job id. Without it BullMQ
  de-duplicates a retry against the *completed* job still held by
  `removeOnComplete.age` (24h), and "อ่านซ้ำ" / `/retry` would appear to do
  nothing. Every reprocess path sets it.
- **Context preserved** — the iOS on-device OCR hint and user/QR-confirmed
  fields travel with the job; the worker forwards them to `runPipeline`.

## Where the workers run

Hosted **in the API process** (`src/index.ts`), not a second container: the NAS
has 3.8 GB of RAM and the web build already competes for it. `RUN_WORKERS=0`
opts out so `npm run workers` can be run standalone later without both
deployments consuming the same queue. Concurrency defaults to 2
(`EXTRACTION_CONCURRENCY`) because the worker now shares memory with the API and
each job holds decoded page images while it waits on the model.

## Webhook safety

`ingestDocument` is **not awaited** in the email route, and the LINE route
answers `200` before handling events. Otherwise an inline fallback (tens of
seconds) would exceed the provider's webhook timeout, and the resulting retry
would re-upload every attachment as a duplicate document.

## Observability

`GET /health/queue` reports queue reachability and job counts, so a dead queue
is visible in monitoring instead of only showing up as documents that never
leave `pending`.

## Tests

`npm run verify:ingest` — the contract, with the queue and pipeline injected
(no Redis, no DB, no LLM): queued path doesn't double-run, broken queue falls
back inline, hint/confirmed/force reach both paths, failures are reported rather
than thrown.
