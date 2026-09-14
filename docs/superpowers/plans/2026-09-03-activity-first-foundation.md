# Activity-first foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-destructive Activity Graph foundation for activities, discovery, registration, and secure references.

**Architecture:** `activities` is the canonical activity record; the Feed is a query over it. Trip itinerary, documents, notes, photos, groups, and expenses remain in their own existing tables and link to activities through additive foreign keys/reference rows.

**Tech Stack:** PostgreSQL/Supabase RLS, Next.js App Router, TypeScript/Node test, SwiftUI.

**Spec:** `docs/superpowers/specs/2026-09-03-activity-first-information-architecture.md`

## Execution status

- [x] Tasks 1–6 complete on `codex/activity-first`. The SQL migrations passed in isolated PostgreSQL integration tests; the repository's legacy local Supabase reset remains blocked by the historical `041_avatars_storage.sql` storage-schema incompatibility. Web and unsigned Native iOS builds both completed after the Activity Feed work.
- [ ] Task 7 pending. Production database deployment remains intentionally blocked until the remote migration-history baseline is reconciled and a recoverable backup destination is approved.

## Global Constraints

- Default activity visibility is `private`; RLS, not UI filtering, enforces access.
- No existing trip, document, finance, group, or profile table may be dropped.
- Stable references are `activity_id`, `trip_id`, `group_id`, `registration_id`, and `resource_id`.
- Existing `/trips`, map behavior, and iOS trip deep links remain valid.
- Backups need an approved destination, retention, encryption owner, and restore test before production data moves.

---

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/102_activity_graph.sql` | Additive Activity Graph schema, indexes, RLS, registration-token join function. |
| `supabase/migrations/103_activity_trip_projection.sql` | Idempotent itinerary projection and reconciliation view. |
| `web/src/lib/activities/types.ts` | Activity transport/input types. |
| `web/src/lib/activities/visibility.ts` | Pure visibility, registration, and input-normalization rules. |
| `web/src/lib/activities/visibility.test.mjs` | Privacy and registration contract tests. |
| `web/src/app/api/activities/**` | Authenticated activity CRUD and registration-link endpoints. |
| `web/src/app/(app)/activities/page.tsx` | Feed view and canonical activity links. |
| `ios/Slippy/{Models,Services,Views}/Activities/**` | Native iOS activity list backed by the same API fields. |
| `docs/operations/activity-graph-rollout.md` | Reconciliation, backup, rollback, and deployment runbook. |

## Task 1: Test and implement pure activity policy

**Files:** Create `web/src/lib/activities/types.ts`, `web/src/lib/activities/visibility.ts`, `web/src/lib/activities/visibility.test.mjs`.

**Interfaces:**

```ts
export type ActivityVisibility = "private" | "group" | "public"
export type ActivityStatus = "draft" | "published" | "cancelled" | "completed"
export function canDiscoverActivity(activity: ActivityPolicy, viewer: Viewer): boolean
export function canJoinRegistration(link: RegistrationLink, now: Date): boolean
export function normalizeCreateActivityInput(input: unknown): CreateActivityInput
```

- [ ] **Step 1: Write failing tests**

```js
test("private activity is hidden from a stranger", () => {
  assert.equal(canDiscoverActivity({ ownerId: "owner", visibility: "private", status: "published" }, { userId: "stranger" }), false)
})
test("only published public activity is discoverable anonymously", () => {
  assert.equal(canDiscoverActivity({ ownerId: "owner", visibility: "public", status: "published" }, { userId: null }), true)
  assert.equal(canDiscoverActivity({ ownerId: "owner", visibility: "public", status: "cancelled" }, { userId: null }), false)
})
test("expired, revoked, and full registration links cannot join", () => {
  const now = new Date("2026-09-03T00:00:00Z")
  assert.equal(canJoinRegistration({ expiresAt: "2026-09-02T00:00:00Z", revokedAt: null, maxUses: 1, useCount: 0 }, now), false)
})
```

- [ ] **Step 2: Verify RED** — run `node --experimental-strip-types --test web/src/lib/activities/visibility.test.mjs`; expected failure: module/functions absent.
- [ ] **Step 3: Implement minimum policy** — owner/participant always sees; public only sees published; group only sees a listed member; join rejects expired/revoked/full; normalize defaults to `summary: ""`, `category: "general"`, `visibility: "private"`, `status: "draft"`.
- [ ] **Step 4: Verify GREEN** — rerun the exact command; expected 3 passing tests.
- [ ] **Step 5: Commit** — `git add web/src/lib/activities && git commit -m "feat(activities): add visibility contract"`.

## Task 2: Add additive Activity Graph migration

**Files:** Create `supabase/migrations/102_activity_graph.sql`.

**Interfaces:**

```sql
activities(id, owner_id, trip_id, group_id, title, summary, category,
  visibility, status, location_name, starts_at, ends_at, source_type, source_url)
activity_occurrences(activity_id, starts_at, ends_at, sort_order)
activity_participants(activity_id, user_id, role, rsvp_status)
activity_resources(activity_id, resource_id, resource_type, resource_role)
activity_registration_links(activity_id, token_hash, expires_at, max_uses, use_count, revoked_at)
activity_interests(activity_id, user_id, state)
join_activity_registration(raw_token text)
```

- [ ] **Step 1: Write failing schema assertion**

```sql
select to_regclass('public.activities'), to_regclass('public.activity_registration_links');
```

- [ ] **Step 2: Verify RED** — `supabase db query --sql "select to_regclass('public.activities');"`; expected `null`.
- [ ] **Step 3: Implement schema** — create all six tables with UUID PKs and indexes; `activities.visibility` check must allow only private/group/public and default private; `activities.status` check must allow only draft/published/cancelled/completed. Enable RLS. Public SELECT must require `visibility='public' AND status='published'`. Store `digest(raw_token, 'sha256')`, never raw token. `join_activity_registration` must be `security definer`, set `search_path = public`, atomically increment use count and return no token.
- [ ] **Step 4: Verify GREEN** — `supabase db reset && supabase db query --sql "select to_regclass('public.activities'), to_regclass('public.activity_registration_links');"`; expected both non-null.
- [ ] **Step 5: Commit** — `git add supabase/migrations/102_activity_graph.sql && git commit -m "feat(activities): add activity graph schema"`.

## Task 3: Project existing trip data without moving it

**Files:** Create `supabase/migrations/103_activity_trip_projection.sql`.

**Interfaces:** add nullable `activity_id uuid references activities(id) on delete set null` to `trip_itinerary_items`; create `activity_trip_reconciliation(journey_id, itinerary_item_count, linked_activity_count, unlinked_item_count)`.

- [ ] **Step 1: Write failing query**

```sql
select journey_id, unlinked_item_count
from activity_trip_reconciliation
where unlinked_item_count <> 0;
```

- [ ] **Step 2: Verify RED** — `supabase db query --sql "select to_regclass('public.activity_trip_reconciliation');"`; expected null.
- [ ] **Step 3: Implement projection** — for every `trip_itinerary_items` row with null `activity_id`, insert one private Activity owned by the parent `life_journeys.user_id`, copy title/type/location/starts/ends/status, update only that row’s new `activity_id`, and define the reconciliation view. Do not delete or overwrite existing itinerary fields.
- [ ] **Step 4: Verify GREEN** — `supabase db reset && supabase db query --sql "select count(*) from activity_trip_reconciliation where unlinked_item_count <> 0;"`; expected 0 in seeded local data.
- [ ] **Step 5: Commit** — `git add supabase/migrations/103_activity_trip_projection.sql && git commit -m "feat(activities): project trip itinerary"`.

## Task 4: Expose secure web APIs

**Files:** Create `web/src/app/api/activities/route.ts`, `web/src/app/api/activities/[id]/route.ts`, `web/src/app/api/activities/[id]/registration-links/route.ts`, `web/src/app/join/[token]/route.ts`; modify `web/src/lib/activities/visibility.ts`.

**Interfaces:**

```txt
POST /api/activities -> 201 { activity }
GET /api/activities?scope=mine|group|explore -> { activities }
PATCH /api/activities/:id -> { activity }
POST /api/activities/:id/registration-links -> { url, expiresAt, maxUses }
POST /join/:token -> { activityId, joined }
```

- [ ] **Step 1: Write failing normalization test**

```js
test("create input defaults to private draft", () => {
  assert.deepEqual(normalizeCreateActivityInput({ title: "Kumamoto walk" }), {
    title: "Kumamoto walk", summary: "", category: "general", visibility: "private", status: "draft"
  })
})
```

- [ ] **Step 2: Verify RED** — run the Task 1 Node test; expected missing normalization function or default mismatch.
- [ ] **Step 3: Implement APIs** — use `createClient()` for user-scoped queries. Validate title (1–160 chars), known visibility/status, optional absolute source URL, and `endsAt >= startsAt`. Return 401 when unauthenticated; return generic 404 for inaccessible rows and invalid/revoked/expired registration links. An owner-only route may generate a raw token once, hash it before insert, and return it only as a URL.
- [ ] **Step 4: Verify GREEN** — `node --experimental-strip-types --test web/src/lib/activities/visibility.test.mjs && npm run typecheck --workspace=web`; expected exit 0.
- [ ] **Step 5: Commit** — `git add web/src/lib/activities web/src/app/api/activities web/src/app/join && git commit -m "feat(activities): add secure APIs"`.

## Task 5: Add web navigation and Feed

**Files:** Create `web/src/app/(app)/activities/page.tsx`, `web/src/components/activities/activity-feed.tsx`; modify `web/src/components/layout/sidebar.tsx`, `web/src/lib/activities/visibility.ts`.

**Interfaces:** `ActivityFeed` takes `ActivitySummary[]`; `feedHref(activityId)` returns `/activities/${activityId}`.

- [ ] **Step 1: Write failing route helper test**

```js
test("Feed points at the canonical activity route", () => {
  assert.equal(feedHref("a-1"), "/activities/a-1")
})
```

- [ ] **Step 2: Verify RED** — run Task 1 test command; expected missing `feedHref`.
- [ ] **Step 3: Implement UI** — add a sibling Activities entry under the existing Trips & Activities group without deleting `/trips`. Render My Feed, Group, Explore tabs from the API, card visibility/time/source badge, and canonical detail URL. Explore must omit private exact location/resource details. Keep web Google map and the Apple Maps open action unchanged.
- [ ] **Step 4: Verify GREEN** — `npm run typecheck --workspace=web && npm run build --workspace=web`; expected exit 0.
- [ ] **Step 5: Commit** — `git add 'web/src/app/(app)/activities/page.tsx' web/src/components/activities web/src/components/layout/sidebar.tsx web/src/lib/activities && git commit -m "feat(activities): add feed navigation"`.

## Task 6: Surface activities in native iOS

**Files:** Create `ios/Slippy/Models/ActivityModels.swift`, `ios/Slippy/Services/ActivityAPI.swift`, `ios/Slippy/Views/Activities/ActivitiesView.swift`; modify `ios/Slippy/Views/Trips/TripsView.swift`.

**Interfaces:**

```swift
struct ActivitySummary: Codable, Identifiable { let id: String; let title: String; let visibility: ActivityVisibility; let status: ActivityStatus }
enum ActivityAPI { static func list(scope: ActivityScope) async throws -> [ActivitySummary] }
```

- [ ] **Step 1: Create failing compile reference** — temporarily reference `ActivitySummary(id: "a1", title: "Kumamoto walk", visibility: .private, status: .draft)` from the new view.
- [ ] **Step 2: Verify RED** — `xcodebuild -project ios/Slippy.xcodeproj -scheme Slippy -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -quiet build`; expected undefined symbol/type failure.
- [ ] **Step 3: Implement iOS UI** — map API values exactly; list results only and leave visibility enforcement to server/RLS. Add an Activities path from Trips but preserve existing journey, MapKit, and Google deep-link actions.
- [ ] **Step 4: Verify GREEN** — rerun exact Xcode command; expected exit 0.
- [ ] **Step 5: Commit** — `git add ios/Slippy/Models/ActivityModels.swift ios/Slippy/Services/ActivityAPI.swift ios/Slippy/Views/Activities/ActivitiesView.swift ios/Slippy/Views/Trips/TripsView.swift && git commit -m "feat(ios): add activities view"`.

## Task 7: Produce a controlled rollout and verify integration

**Files:** Create `docs/operations/activity-graph-rollout.md`.

- [ ] **Step 1: Write the acceptance checklist**

```markdown
- [ ] No unexpected rows in `activity_trip_reconciliation`.
- [ ] Private activity is absent from Explore, public API, map, and public join preview.
- [ ] Public published activity is discoverable without private resources.
- [ ] Raw registration tokens do not appear in database queries or logs.
- [ ] Existing trip route, web Google Map/Apple Maps action, and iOS MapKit/Google link still work.
- [ ] Backup destination, retention, encryption owner, and restore operator are approved.
```

- [ ] **Step 2: Verify automated suite** — run `node --experimental-strip-types --test web/src/lib/activities/visibility.test.mjs web/src/lib/trips/trip-conversation.test.mjs web/src/lib/trips/location-sharing.test.mjs web/src/lib/trips/calls.test.mjs && npm run typecheck --workspace=web && npm run build --workspace=web && xcodebuild -project ios/Slippy.xcodeproj -scheme Slippy -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -quiet build`; expected all exit 0.
- [ ] **Step 3: Verify staging data** — run `supabase db push && supabase db query --sql "select * from activity_trip_reconciliation where unlinked_item_count <> 0;"`; expected no rows. Do not apply to production before a recoverable baseline backup is approved.
- [ ] **Step 4: Browser smoke test** — verify `/trips`, `/activities`, My/Group/Explore scope separation, registration join, the Kyushu trip, Google map, and Apple Maps action in authenticated staging.
- [ ] **Step 5: Commit** — `git add docs/operations/activity-graph-rollout.md && git commit -m "docs(activities): add rollout runbook"`.

## Plan self-review

- **Spec coverage:** Tasks 1–3 implement canonical records, privacy, references, and non-destructive trip linkage. Tasks 4–5 implement Feed/discovery/registration/navigation. Task 6 preserves platform parity. Task 7 covers data reconciliation, backup boundary, browser checks, maps, and rollout.
- **Placeholder scan:** No TBD, TODO, or implicit implementation steps remain.
- **Type consistency:** TypeScript uses `ActivityVisibility`, `ActivityStatus`, and `activityId`; SQL uses `activity_id`; Swift maps the API `id` to `ActivitySummary.id`.
