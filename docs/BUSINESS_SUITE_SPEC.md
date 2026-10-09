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
- **`GET /api/claims`** — list. Access is derived from the caller's **real membership**, not from anything the client sends: the route loads the caller's `organization_members.role` for the requested `orgId`, returns `403` for a non-member, and only returns every claim in the organisation if `canListOrganizationClaims(role)` (`web/src/lib/claims-auth.ts`) is true — roles `owner`, `admin`, `accountant` (the set also lists `manager`, which the database's role CHECK constraint can never produce, so that entry is dead). Everyone else sees only their own claims (`submitter_id = caller`). An earlier version trusted a client-supplied `role` query parameter, so any org member could pass anything other than `submitter` and read every claim; that was fixed in PR #24 (2026-10-03).
- **`GET /api/claims/[id]`** — single claim with its audit trail; relies entirely on RLS (no explicit check in the route), whose `ec_member_select` policy allows **any member of the organisation** to read any claim in it. So the list is role-scoped but detail-by-id is not: a non-reviewer who learns another member's claim id can still open it. See *Known gaps*.
- **`PATCH /api/claims/[id]`** (`approve` / `reject` / `mark_paid` / `under_review`) — loads the claim's own `organization_id`, then requires the caller to hold role `owner`, `admin` or `accountant` in **that** organisation (`403` otherwise, `404` for an unknown claim) before writing the status change and its `approval_events` row. Uses the admin client, so this check is the only enforcement. An earlier version had no authorization check at all (any signed-in user could change any claim in any organisation); fixed in PR #22 (2026-10-03). Note the approver set (`APPROVER_ROLES` in the route) and the list-all set (`CLAIM_REVIEWER_ROLES` in `claims-auth.ts`) are two separate constants that happen to agree today.

## Known gaps

- **Claim detail is not role-scoped.** `GET /api/claims/[id]` returns any claim to any organisation member who knows its id (RLS only requires membership), while the list endpoint now hides other members' claims from non-reviewers. Not fixed; whether detail-by-id should match the list's rule is a product decision.
- **Two constants define "who reviews claims"** (`APPROVER_ROLES` in `api/claims/[id]/route.ts`, `CLAIM_REVIEWER_ROLES` in `lib/claims-auth.ts`) and they can drift apart; `CLAIM_REVIEWER_ROLES` also contains an impossible `manager` role. Cosmetic today.
- No budget-setting endpoint was found; if one exists elsewhere, this document should be corrected to point at it.

## Revision note

2026-10-05: updated after PRs #22 and #24 closed the two authorization gaps this document originally recorded (unauthenticated `PATCH`, and the unchecked `role` list parameter). Status descriptions above reflect the code at `main` `1782f1b`.
