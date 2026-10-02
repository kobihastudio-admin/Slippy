# Business Suite

Status: **derived from code** (`web/src/app/api/claims/*`, `web/src/app/api/budget/route.ts`, `web/src/app/api/tax/*`, `web/src/components/layout/sidebar.tsx`), plus a read-only check of `expense_claims`' RLS policies. Where this document and the code disagree, the code is right.

"Business Suite" is the organisation-scoped financial toolkit built on top of the document pipeline: VAT/WHT tax reports, a budget vs. actual view, and an expense-claim approval workflow. Vendor management (`vendors`, see DATABASE_SCHEMA.md) and the OCR pipeline itself are covered elsewhere; this document is the three features above.

## Hidden behind the nav, not behind access control

`sidebar.tsx` gates `/budget` and `/claims` with `SHOW_BUDGET = false` / `SHOW_CLAIMS = false` (both dated 22 Aug 2026, "ยังไม่ได้ใช้" — not yet used). The surrounding comment states the convention explicitly: **every route, page and API still works; only the way in is hidden**, so re-enabling either is a one-line flag flip, not a feature build. Do not treat "hidden from the nav" as "inaccessible" — both API routes below are live and reachable by anyone who can reach the URL, regardless of what the sidebar shows.

## Tax reports (`/api/tax/vat`, `/api/tax/wht`)

Computes VAT (ภ.พ.30) or WHT (ภ.ง.ด.3/53) figures for a given org/year/month — input VAT from purchases, output VAT from sales, net VAT due, and a due date. **Tries the Fastify API server first** (`GET ${API_BASE_URL}/tax/vat`, `x-internal-key` + `x-user-id`, a 3-second timeout), and only falls back to computing locally from the `documents` table (`computeFromSupabase`, using the regular RLS-bound client) if that call throws or times out — so the API server is the primary path and the local computation is a resilience fallback, not an alternate implementation chosen by request shape. A `history=N` query param returns the last N months as an array instead of one month.

## Budget vs. actual (`/api/budget`)

Budgets are **not their own table** — they live in `organizations.metadata->budgets`, keyed by month (`"2026-06": { total, categories: {...} }`), set and read as arbitrary JSON rather than structured columns. `GET` compares the configured budget for a month against actual spend, computed on the fly from `documents` (`status IN ('approved','pushed')`, `doc_date` within the month), broken down by `doc_category`. No `POST`/`PATCH` to set a budget was found in this pass — if one exists, it was not located; the admin panel's `system_config`/`pricing_plans` editor is a different thing (global settings, not per-organisation budgets).

## Expense claims (`expense_claims`, `business_projects`, `approval_events`)

A submit → review → pay workflow, independent of document approval: `submitted → under_review → approved/rejected → paid`. Each claim can reference a `business_projects` row (cost-centre style grouping) and/or a scanned `documents` row as supporting evidence. Every status change is appended to `approval_events` (actor, action, comment) as an audit trail — never overwritten.

- **`POST /api/claims`** — submit; checks `isOrgMember(user, orgId)` before inserting (admin client).
- **`GET /api/claims`** — list; the code comment says "submitter sees own; admin/manager sees all org," but the actual scoping is coarser: it filters to the caller's own claims only when the request explicitly passes `role=submitter`; any other (or missing) `role` value returns every claim in the organisation with no role check at all — not just admin/manager. Because this route uses the **regular, RLS-bound** client, the real ceiling is `expense_claims`' own SELECT policy (`ec_member_select`): any member of the organisation, not specifically an admin or manager. So in practice, **any org member can see every other member's claims** by passing a non-`"submitter"` role — the comment's "admin/manager" distinction is not enforced anywhere.
- **`GET /api/claims/[id]`** — single claim with its audit trail; relies entirely on RLS (no explicit org check in the route), same ceiling as above.
- **`PATCH /api/claims/[id]`** (`approve` / `reject` / `mark_paid` / `under_review`) — **has no authorization check of any kind.** It uses the admin client, updates by `.eq("id", id)` alone, and never verifies the caller is a member of the claim's organisation, let alone an approver. Any authenticated user who can reach this endpoint and knows or guesses a claim id can approve, reject, or mark it paid. See *Known gaps* — this is more exposed than the GET-list issue above, because it has zero scoping rather than an overly-broad one.

## Known gaps

- **`PATCH /api/claims/[id]` is unauthenticated against the organisation** (any signed-in user, any org, can mutate any claim's status) — a real finding, not fixed here. Needs at minimum an `isOrgMember` check against the claim's `organization_id`, and arguably a real approver/manager role check given the route explicitly offers `approve`/`reject`/`mark_paid`.
- **`GET /api/claims`'s `role` parameter does not gate anything** — it only changes whether the caller's own filter is applied; it is not itself verified against the caller's actual role in the organisation. The practical exposure is bounded by RLS (org members only), but that is wider than "admin/manager" as the comment claims.
- No budget-setting endpoint was found; if one exists elsewhere, this document should be corrected to point at it.
