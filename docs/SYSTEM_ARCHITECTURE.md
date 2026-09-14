# System Architecture

## Platform Flow

```text
LINE OA / LIFF ─┐
Web             ├─> Next.js API / Fastify API ─> Supabase
Mobile / Native ┘              │                    │
                               ├─ OCR Pipeline      ├─ Life Graph
                               ├─ LINE Services     ├─ AI Memory
                               ├─ Integrations      └─ Realtime
                               └─ Notifications
```

## Runtime Boundaries

- `web`: Next.js user interface, authenticated web APIs, and LIFF APIs.
- `api`: Fastify webhooks, OCR/extraction, accounting connectors, and workers.
- `supabase`: PostgreSQL, Auth, Storage, RLS, RPC functions, and Realtime.
- `mobile`, `ios`, `android`: clients over the same Supabase and API contracts.

Fastify protected routes require `x-internal-key`. Webhook routes verify their
provider signatures. Browser clients must not receive the Supabase service key
or internal API key.

## Document Pipeline

```text
Upload -> Storage -> documents row -> extraction
       -> validation -> approved/reviewing
       -> Life Graph population -> AI Memory/Insights
```

Only approved or pushed documents populate the Life Graph. Corrections and OCR
error patterns feed the extraction learning loop.

## Identity

- Supabase `users` is the application identity core.
- `organization_members` controls organization access.
- `line_connections` maps a verified LINE user to a Slippy user and org.
- LIFF access tokens are verified server-side before private LIFF APIs run.
- Client-provided `lineUserId` is compatibility data, not authentication.

## Domain Modules

- Wealth: documents, tax, budget, claims, accounting integrations.
- Social: friendships, conversations, communities, split bills.
- Journey: trips, itinerary, settlements, saved places.
- Lifestyle: sport groups and recurring sessions.
- Health: measurements, medication schedules, inventory, reminders.
- Intelligence: Life Graph, Life Score, memories, insights, assistant.

## Deployment Processes

Deploy these as separate processes:

1. Next.js Web and LIFF.
2. Fastify API.
3. BullMQ workers when queue-based extraction/push is enabled.
4. Supabase database, storage, auth, and scheduled functions.

All processes must use the same migration version and compatible environment
variables. Apply migrations before deploying code that references new columns.
