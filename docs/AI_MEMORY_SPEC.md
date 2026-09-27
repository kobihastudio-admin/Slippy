# AI Memory

Status: **derived from code** (`api/src/services/ai-memory.ts`, `api/src/routes/life.ts`, `web/src/app/api/chat/route.ts`). Where this document and the code disagree, the code is right.

AI Memory is `life_memories` plus a small service that embeds, stores, searches and — via Claude — extracts facts from chat. It exists to give the AI Assistant (`web/src/app/api/chat/route.ts`) a persistent, per-organisation context beyond the current conversation. It is a separate concern from the Life Graph's document-driven population (see LIFE_GRAPH_SPEC.md), though both write to the same `life_memories` table.

## Storage (`storeMemory`)

One row per `(organization_id, memory_type, key)`, upserted (`onConflict`). Each row carries a `value` (arbitrary JSON), an `embedding` (pgvector), `observation_count`, and `source` (defaults to `"system"`; the chat extraction path passes `"chat"`). Called from two places: the Life Graph's document population (`memory_type: "merchant_visit"` / `"category_spend"` — see LIFE_GRAPH_SPEC.md) and `extractMemoriesFromChat` below.

## Embeddings (`embed`)

Anthropic has no embedding API, so this is the one place the codebase calls OpenAI directly:

- **With `OPENAI_API_KEY`** — `text-embedding-3-small` (input capped at 8000 characters).
- **Without it** — a zero vector (`Array(1536).fill(0)`). The system is designed to work either way: a zero vector makes pgvector similarity meaningless, so search falls back to plain text matching instead (see below). A failed OpenAI call is caught and logged, not thrown.

## Search (`searchMemories`)

- **If `OPENAI_API_KEY` is set:** embed the query, call the SQL function `search_memories(org_id, embedding, limit, threshold=0.5)`. If it errors or returns nothing, execution falls through to the text search rather than returning empty.
- **Otherwise (or on the fallback):** a case-insensitive `ilike` match on `key` for up to 5 words from the query (each word must be longer than 1 character); every result reports a fixed placeholder `similarity: 0.5`, since no real vector comparison happened.

`buildMemoryContext(orgId, query)` wraps this: fetches up to 8 memories and renders them as a short Thai-language block (`## AI Memory (สิ่งที่ระบบจำเกี่ยวกับคุณ)`), one line per memory — a merchant name, a spend category with its last amount, or a generic `key: value` fallback for anything else. Returns an empty string (not the header) when there is nothing to show.

## Extraction from chat (`extractMemoriesFromChat`)

After a chat exchange, a Haiku call (`claude-haiku-4-5`, 200 max tokens) is asked to pull memorable preferences/patterns/goals out of the exchange, constrained to return a JSON array (`[{"type", "key", "value"}]`, or `[]` if nothing qualifies). Each extracted fact is stored via `storeMemory` with `source: "chat"`. The whole function is wrapped in one `try/catch` that swallows any failure — a bad JSON parse, a missing key, or an API error all just mean no memory is stored this time.

## Wiring into the chat endpoint

`POST /api/chat` (`web/src/app/api/chat/route.ts`) is the AI Assistant's own endpoint (see also LINE's `/ai` / "nova" command, which is a different entry point — not traced here; see LINE_OA_SPEC.md). Sequence per request:

1. **Auth, twice.** A Supabase session (web) or a bearer access token validated via the service-role client's `getUser(token)` (iOS, which has no shared cookie jar) — both paths are required; an unauthenticated caller gets `401` before anything else runs. This replaced an earlier version that attached Life Graph context only when a session existed but still called Claude regardless, which meant an unauthenticated request got a free, unlimited completion.
2. **Membership + plan check.** The caller must belong to `orgId` (`403` otherwise), and the organisation's plan must have the `aiAssistant` feature (`hasFeature`), or the response asks for an upgrade.
3. **Life Graph context** (`buildLifeContext`, defined in this same route file) — last 30 days of expense events, top 5 merchants, and recent memories/insights, best-effort (a failure here does not block chat).
4. **AI Memory context** — a call to the Fastify `POST /life/memory-context` (via `INTERNAL_API_KEY`), keyed on the last user message; best-effort, same as above.
5. **The Claude call** — `claude-haiku-4-5` (an unpinned alias, unlike the OCR pipeline's pinned `claude-haiku-4-5-20251001` — see OCR_ENGINE_SPEC.md), system prompt = a fixed Thai persona (`BASE_SYSTEM`) concatenated with the two context blocks above, 800 max tokens, no streaming.
6. **Extraction, after replying** — a fire-and-forget call to `POST /life/extract-memory` with the last user message and the assistant's reply.

`routes/life.ts` (Fastify) is the only thing standing between the web route and `ai-memory.ts`: `POST /life/memory-context` calls `buildMemoryContext`, `POST /life/extract-memory` calls `extractMemoriesFromChat`. Both endpoints have no auth of their own beyond `x-internal-key` — they trust the web layer to have already checked the caller.

## Known gaps

- `search_memories`'s SQL definition (the pgvector query itself, and what `p_threshold` filters out) was not read for this document.
- The fallback text search only matches against `key`, not `value` — a memory whose distinguishing text lives in `value` (which is most of them, per `buildMemoryContext`'s own rendering) is not found by keyword search when no OpenAI key is configured.
- This document does not cover the AI Assistant's own prompt design, Life Graph context shape, or the LINE "nova" entry point in depth — see AI_ASSISTANT_SPEC.md (once written) and LINE_OA_SPEC.md.
