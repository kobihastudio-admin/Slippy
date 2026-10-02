# AI Assistant

Status: **derived from code** (`web/src/app/api/chat/route.ts`, `web/src/components/ui/support-chat.tsx`, `web/src/components/layout/app-shell.tsx`, `web/src/lib/plans.ts`, `api/src/routes/line.ts`). Where this document and the code disagree, the code is right. The memory and embedding pieces it relies on are covered in AI_MEMORY_SPEC.md; this document is the assistant surface itself — where it appears, who can use it, and what it is built from.

## Where it lives

There is **one real AI Assistant**, and it exists only on the web dashboard — a floating chat widget (`SupportChat`, mounted in `app-shell.tsx` as `<SupportChat orgId={org.id} />`, so it is present on every signed-in page) that calls `POST /api/chat`. There is no AI Assistant page on mobile web or LIFF; `web/src/app/liff/chat` and `api/liff/chat` are a **different, unrelated feature** — human-to-human messaging between a LINE user and their connected friends (`conversations`/`messages`), not an AI conversation.

**"Nova" on LINE does not reach the Assistant.** The bot's `/ai`, `nova`, "คุยกับ Nova 🤖" and a "สวัสดี nova" message (`api/src/routes/line.ts`) only send one fixed, canned introduction with quick-reply buttons — "a full conversational AI-coaching engine is planned," per the code's own comment. It never calls Claude, never builds Life Graph or memory context, and never reaches `POST /api/chat`. Treat Nova as marketing/placeholder copy, not an AI integration. (LINE_OA_SPEC.md previously described this as "routes to the chat assistant," which overstated what it does — that document should be read alongside this correction.)

## Access gate

`hasFeature(plan, "aiAssistant")` (`lib/plans.ts`): **off** for `free` and `starter`, **on** for every paid tier from `pro` upward (`team`, `premium`, `business`, `enterprise`). `POST /api/chat` enforces this itself — a `free`/`starter` organisation gets `403` with `{ error: "...ต้องอัปเกรดเป็นแผน Pro ขึ้นไป", upgradeRequired: true }`, which `SupportChat` reads to show an upgrade prompt rather than a generic error.

## Request flow (`POST /api/chat`)

Full detail (dual web/iOS auth, membership check, context assembly, the model call, and post-reply memory extraction) is in AI_MEMORY_SPEC.md's *Wiring into the chat endpoint* section — not repeated here. In outline: authenticate → verify org membership → check the plan gate above → assemble Life Graph context (`buildLifeContext`, this file) and AI Memory context (Fastify `/life/memory-context`) → one non-streaming Claude call (`claude-haiku-4-5`, 800 max tokens, system = fixed Thai persona + both context blocks) → reply → fire-and-forget memory extraction from the exchange.

## System prompt (`BASE_SYSTEM`)

A fixed Thai-language persona naming itself "Slippy AI Life Assistant." States its role (answer questions about spending/vendors/documents/behaviour, analyse spending patterns, help find documents, explain Slippy itself) and ground rules: answer mainly in Thai, concisely; cite the user's real Life Graph data when available; say plainly when there is no data rather than inventing it; markdown is allowed; when unsure, point to `support@slippy.app`. It also hard-codes a few product facts (upload channels, file size/type limits, the LINE `/connect` flow, VAT/WHT names, the `/split` command) directly into the prompt rather than looking them up — a product change to any of those facts means editing this string, not just the underlying feature.

## Life Graph context (`buildLifeContext`, in the same route file)

A second, route-local implementation of "life context," separate from `ai-memory.ts`'s memory search. For the organisation: last 30 days of expense `life_events` (≤20), top 5 `life_merchants` by total spend, up to 10 recent `life_memories`, and up to 3 unread `life_insights`. Returns an empty string (skipping the whole section) if there are no events and no merchants — a brand-new organisation gets no Life Graph block rather than an empty one. Rendered as a Thai markdown section: total 30-day spend, item count, top-3 categories by amount, top-3 frequent merchants with visit counts, recent insight titles/bodies, and up to 5 memories (only those whose `value.name` is present are rendered — other memory shapes are silently skipped here, unlike `buildMemoryContext` in AI_MEMORY_SPEC.md which renders more shapes).

## Known gaps

- This document does not re-derive the request flow already detailed in AI_MEMORY_SPEC.md — read both together for the full picture of one `/api/chat` call.
- `buildLifeContext`'s memory rendering (only `value.name`) versus `ai-memory.ts`'s `buildMemoryContext` (name, category, or a generic fallback) are two different renderers over the same `life_memories` rows; a memory that would show in one context block may not show in the other.
- The roadmap mentions a planned "AI Coach" / "Nova" conversational engine (see the Rich Menu intro text) — this document describes what exists today, not that plan; see ROADMAP_2025_2028.md once written.
