# Life Graph

Status: **derived from code** (`api/src/services/life-graph.ts`, `api/src/routes/life.ts`, `web/src/app/api/life/*`, `web/src/app/api/personal/score/route.ts`, plus a read-only check of `compute_life_score` in the database). Where this document and the code disagree, the code is right.

The Life Graph turns approved documents into structured records — merchants, events, memories, insights, a score — that the rest of the product (dashboard, chat assistant, LIFF) reads back. It is populated as a side effect of document approval, not by its own user-facing write path.

## Population (`populateLifeGraph`)

Reached three ways, and **not every approval path triggers it**:

1. **Auto-approval** — the OCR pipeline calls it directly when a document is auto-approved (`pipeline/index.ts`). Since both auto-approve thresholds are 1.0 (see OCR_ENGINE_SPEC.md), this almost never fires in practice.
2. **Manual approval on the web** — `review-client.tsx`'s approve action sets the document's status, then separately calls `POST /api/life/populate`, which forwards to the Fastify `/life/populate` route with `x-internal-key`. This is a best-effort side call: its own failure is swallowed and never affects the approval itself.
3. **`POST /life/populate`** (Fastify) directly, for any document already `approved`/`pushed`.

**`/approve DOCID` on LINE does not call any of these** — it only updates `documents.status`. A document approved through the bot does not populate the Life Graph unless something else (a later web view, a retry) triggers it.

For a given document:

1. **Merchant** (`life_merchants`) — `upsert_life_merchant()` (`SECURITY DEFINER` SQL function) keys on organisation + name, folding in tax id, address, category, amount and date. Skipped if `vendor_name` is empty.
2. **Event** (`life_events`) — one `event_type: "expense"` row per document, de-duplicated by `(source_type: "document", source_id: documentId)` so re-running population is idempotent. Carries `merchant_id`, `amount`, a Thai-labelled `category` (see *Category labels*), and VAT/payment metadata.
3. **Memories** (`life_memories`) — two upserts keyed on `(organization_id, memory_type, key)`: a `merchant_visit` memory per merchant (name, last amount, category) and a `category_spend` memory per document category (last amount, Thai label). `observation_count` is always written as `1` — see *Known gaps*.

All three steps run best-effort inside one `try/catch`; a failure is logged and swallowed, never surfaced to the document or the uploader.

## Insights (`generateInsights`)

Reachable via `POST /life/insights/:orgId`, and from the dashboard's "generate insights" action (`web/src/components/life/life-client.tsx`). Compares the last 30 days of `life_events` (`event_type = "expense"`) against the prior 30 days and writes rows to `life_insights`, each expiring after 7 days:

- **Spending change** — only raised if the swing is at least 10%, phrased in Thai as an increase (🔴) or decrease (🟢).
- **Top category** — the category with the largest 30-day spend, as a percentage of total.
- **Frequent merchant** — only raised at 3+ visits in 30 days; looks up the merchant's name from `life_merchants`.

No insight is written if there is no spending at all in the last 30 days.

## Scoring — two separate, differently-weighted systems

**Organisation-level "Life Score"** (`GET/POST /api/life/score`) calls the SQL function `compute_life_score(org_id)`, which is the one actually in use. It computes four 0–100 components and an overall weighted score, and persists a snapshot to `life_score_snapshots` (one row per organisation per day, upserted):

| Component | Weight | Based on |
|---|---|---|
| Wealth | 40% | Document approval rate (≤40 pts) + document volume (≤20 pts) + 30-day expense events (≤20 pts) + whether a budget is configured (20 pts) |
| Lifestyle | 25% | Personal/health documents in the last 30 days (≤50 pts) + whether any linked user has a completed personal profile (50 pts) |
| Journey | 20% | `life_journeys` count × 20 pts, capped at 100 |
| Social | 15% | `split_bills` count × 15 pts (≤60) + `posts` count × 8 pts (≤40) |

A **second, unrelated implementation** — the TypeScript `computeLifeScore()` in `life-graph.ts` — also exists, with only two components (an approval/volume-based "wealth" score and an event-type-diversity score) and different math entirely. Nothing in the codebase calls it (see *Known gaps*); do not confuse the two when reading the schema or the code.

**Personal "Vita" score** (`GET/POST /api/personal/score`, `lib/vita-scores.ts`, `computeVitaScores()`) is a **third, separate system**: per-user (not per-organisation) longevity and wealth scores from health averages, lifestyle stats and financial stats, persisted to `personal_profiles.longevity_score`/`wealth_score` and a 30-day history in `score_snapshots`. `score_snapshots` (personal) and `life_score_snapshots` (organisation) are different tables — do not conflate them.

## Category labels (`mapCategory`)

A private lookup in `life-graph.ts` maps the OCR pipeline's `doc_category` values to short Thai labels for event descriptions and insights (e.g. `tax_invoice_full` → "ใบกำกับภาษี", `consumer_receipt` → "อาหาร/บริการ"). An unrecognised category falls back to itself, then to "อื่นๆ".

## Related but out of scope here

- **AI Memory** (`/life/memory-context`, `/life/extract-memory`, `services/ai-memory.ts`) shares the route file (`routes/life.ts`) but is conceptually separate — see AI_MEMORY_SPEC.md.
- **Activity Graph** (`activities`, `life_events`'s sibling for social/travel activity rather than spending) is covered by [operations/activity-graph-rollout.md](operations/activity-graph-rollout.md) and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
- **Semantic search** (`search_documents_semantic`, `search_memories`, the `documents.embedding` column) was not traced here.
- **`vita_cards`** exists in the schema but was not found wired into any current web route in this pass; if it is iOS-only or unused, that should be confirmed and recorded here.

## Known gaps

- **`/approve` on LINE never populates the Life Graph** (see above) — only the web review UI's approve button does, plus the near-dead auto-approve path. A document approved entirely through LINE (a common flow — see LINE_OA_SPEC.md) never gets a `life_events` row, a merchant upsert, or memories from that approval.
- `computeLifeScore()` (TypeScript, in `life-graph.ts`) is dead code: exported, but not called from any route or script found in this pass. The organisation Life Score actually served to users is entirely the SQL `compute_life_score`.
- Every `life_memories` upsert writes `observation_count: 1` rather than incrementing the existing value, so the column does not currently track how many times something was actually observed — each upsert resets it.
- This document does not detail `life_merchants`' own fields (e.g. geocoding, `find_nearby_merchants`/`find_nearby_cached`) — those belong to the location-search feature, not document-driven Life Graph population.
