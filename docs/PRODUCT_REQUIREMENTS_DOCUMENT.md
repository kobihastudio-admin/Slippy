# Product Requirements (as built)

Status: **derived from code and the existing docs** — the feature specs in this folder, `BUSINESS_MODEL.md` (the owner's stated intent), `web/src/lib/plans.ts`, the production schema (126 public tables) and the four clients, as of 2026-10-12. A PRD normally states what should be built; this one records what **is** built, what the owner has said it should become, and where the two differ. Requirements marked *(owner)* come from `BUSINESS_MODEL.md` and are not enforced by code. Where this document and the code disagree, the code is right.

## 1. What the product is today
Slippy reads receipts and slips with AI and books them (documents, VAT/WHT, approvals, accounting export), and around that core offers shared-money and daily-life features: split bills, trips with itineraries and settlements, sport groups, medication tracking, a Life Graph with an assistant and memory, and a social layer. It runs as a Next.js web app, a Fastify API with queue workers, a LINE bot with LIFF mini-apps, and native iOS (plus Watch and share extension), Android and Expo clients, on Supabase.

*(owner)* `BUSINESS_MODEL.md` positions it as an **AI Life Assistant platform, not an OCR app**, with six phases (see ROADMAP_2025_2028.md). The public landing page, however, sells accounting automation only (LANDING_PAGE_SPEC.md).

## 2. Users (inferred from roles, schema and channels — no research is in the repo)
| User | Evidence | Needs the product meets |
|---|---|---|
| Individual (personal finance, health) | personal org type, `personal_*`, medication and health tables | scan slips, see spending, medication reminders, tasks |
| Small-business owner / accountant | `organization_members` roles owner, admin, accountant, viewer; Business Suite | document intake, approval, VAT/WHT, claims, accounting sync |
| Group of friends / family | trips, split bills, friends, chat, LINE groups | share costs, plan a trip together, settle up |
| Sport group organizer and players | `sport_groups`, sessions, court slots, Watch app | schedule sessions, split court costs, track play |
| LINE-first user | `line_connections`, bot commands, LIFF | do all of the above from chat |
| Platform admin | `/admin`, ops page, audit log | monitor queues, errors, orgs, plans |

## 3. Functional requirements (what exists)
Each line points to the document that holds the detail.
- **Documents and OCR**: intake from web, LINE, email, mobile; extraction, validation, review, approval — OCR_ENGINE_SPEC.md, document-ingestion.md.
- **Accounting and tax**: VAT/WHT reports, vendors, accounting connectors — API_SPEC.md, BUSINESS_SUITE_SPEC.md.
- **Business Suite**: expense claims with role-gated approval, budgets (in organization metadata), vendor management — BUSINESS_SUITE_SPEC.md.
- **Split bills**: bills, item claims, payment proofs, LINE `/split` — SPLIT_BILL_SPEC.md.
- **Journey**: trips, day-by-day itinerary with photos and booking details, expenses and settlement, checklist, notes, live location and calls, Google Maps hand-off, and — in PR #34, applied to the database but not yet merged to `main` — itinerary editing and place voting — JOURNEY_MODULE_SPEC.md.
- **Life Graph, AI memory, assistant**: LIFE_GRAPH_SPEC.md, AI_MEMORY_SPEC.md, AI_ASSISTANT_SPEC.md.
- **Social**: friends, follows, feed, LIFF community — SOCIAL_GRAPH_SPEC.md.
- **LINE**: bot commands, push, LIFF auth — LINE_OA_SPEC.md.
- **Sport and health**: SPORT_GROUPS_LINE.md and the medication code (`lib/medication*.ts`).
- **Platform**: auth and onboarding, billing (Stripe), privacy (consents, export/delete), admin — API_SPEC.md, SECURITY_ARCHITECTURE.md, DEPLOYMENT_ARCHITECTURE.md.

## 4. Monetization
**Built** (`lib/plans.ts`, `pricing_plans`, Stripe routes): Free (15 documents/month), Pro ฿199, Premium ฿499, Team ฿999, Business ฿2,990, Enterprise by contact; yearly billing at 20% off; paid add-ons for specific tax filings; quotas enforced from `pricing_plans.doc_quota`.
*(owner)* Target revenue mix: consumer subscription 40–50%, business SaaS 30–40%, marketplace 20–30%, creator economy 5–10% as a growth engine. The marketplace and creator parts are schema only today (CREATOR_ECONOMY_SPEC.md); the AI coach and financial marketplace have no code.

## 5. Success metrics
*(owner)* North star **WALU — Weekly Active Life Users**: users who interact with their Life Graph at least once a week. Secondary: MAU, subscription conversion, creator revenue, business plan revenue, marketplace revenue. Every feature should raise revenue, retention, WALU or enrich the Life Graph.
**In code**: only the constant `NORTH_STAR_METRIC = "WALU"`; no query computes it. The admin ops page shows organization and user counts, documents by status in the last 24h, queue depth, stuck documents, unresolved errors and Stripe failures; `ai_usage_log` records model usage per document phase. There is no activation, retention or conversion reporting.

## 6. Non-functional requirements (as built)
- **Security and privacy**: row-level security on tenant data, signature-verified webhooks, internal-key API tier, verified LIFF identity, PDPA positioning and consent tables — SECURITY_ARCHITECTURE.md. Known open gaps are listed in each spec's *Known gaps*.
- **Reliability**: a recovery sweep re-ingests documents stranded in `processing`; the queue and workers run inside the API process; one NAS hosts web, API, Redis and the tunnel (no redundancy) — DEPLOYMENT_ARCHITECTURE.md.
- **Localization**: Thai first (Thai receipts, tax IDs, PromptPay); English on the landing page; UI strings are inline.
- **Platforms**: web, iOS, Android, Expo, LINE. Parity is uneven (iOS far ahead; Android and Expo cover scanning and viewing only).

## 7. Decisions the owner needs to make
1. **Positioning**: AI Life Assistant (business model) or accounting automation (landing page)? Marketing, pricing copy and onboarding should say the same thing.
2. **Free quota**: 15 (code) or 50 (landing page) documents per month.
3. **Creator economy and marketplace**: build (the affiliate link has no redirect, referrals are not recorded) or remove the schema.
4. **WALU**: define the events that count as "interacting with the Life Graph" and compute it, or drop it as the north star.
5. **Client strategy**: keep Android and Expo as products or park them; the web and iOS already diverge from them.
6. **Two splitting models** (split bills vs trip settlements): keep both or converge (DOMAIN_DRIVEN_DESIGN.md).
