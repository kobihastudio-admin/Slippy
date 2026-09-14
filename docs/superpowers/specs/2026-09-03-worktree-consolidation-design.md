# Worktree consolidation & merge-to-main design

Status: approved, executing
Origin: brainstorming session 2026-09-03, in response to 6 parallel git worktrees with overlapping edits and 58 unpushed commits on `main`.

## Problem

`slippy` had 6 active `git worktree`s doing real, wanted feature work in parallel, several editing the same files (`HealthView.swift`, `HealthViewModel.swift`, `medications-client.tsx`, `web/tsconfig.tsbuildinfo`) with no coordination. `main` itself carried 58 unpushed commits plus its own small uncommitted diff. Risk: work loss, silent conflicts, divergent schema decisions (see below) landing inconsistently.

## Schema decision (input constraint, not itself part of this plan's execution)

`journey_type` (on `journeys`, values include `trip`/`event`/…) is the canonical, broader Life Graph concept. `trip_type` (on `trips`/split-bill, values `travel`/`food_order`/`sport`/`general`) becomes a sub-classifier valid **only** when `journey_type = 'trip'`. This replaces the current ad-hoc bridge at `web/src/app/api/trips/route.ts:99` (`journey_type: trip_type === "travel" ? "trip" : "event"`). Journey and Trip are explicitly different concepts (Journey is the umbrella). This rule governs how the `codex-activity-first` branch's new `activity_graph` schema (step 5) must integrate with the existing `trips`/`journeys` tables — it is not itself a step to execute, it's a constraint the step-5 merge must satisfy.

## Verified worktree state (as audited 2026-09-03, re-verify at execution time — this is a live/moving target; one worktree seen in an earlier pass had already vanished by the time of the next check)

| Worktree | Branch | Ahead/behind main | Dirty files |
|---|---|---|---|
| `trip-map-google-places` | `sdd-trip-map-google-places` | 38 / 4 | none (clean) |
| `medication-tracking-expansion` | `sdd-medication-tracking-expansion` | 33 / 13 | `web/tsconfig.tsbuildinfo` only (build artifact) |
| `medication-course-lifecycle` | `codex/medication-course-lifecycle` | 3 / 3 | real WIP: `HealthModels.swift`, `HealthViewModel.swift`, `AddMedicationView.swift`, `HealthView.swift`, `medications/page.tsx`, `medications-client.tsx`, `package-lock.json`, 3 new web files |
| `travel-health-taxonomy` | `codex/travel-health-taxonomy` | 0 / 0 (= main tip) | real WIP: `JourneyStyle.swift`, `HealthView.swift`, `medications-client.tsx`, `trip-detail-client.tsx`, `trips-client.tsx`, 3 new files (ActivityTaxonomy.swift, activity-taxonomy.ts/.test.mjs) |
| `codex-activity-first` | `codex/activity-first` | 5 / 13 | `web/tsconfig.tsbuildinfo` only |
| `.claude/worktrees/youthful-poincare-df541c` | (detached, no branch) | 58 / 0 | none — mirrors main's own ahead-of-origin count exactly; almost certainly a leftover Claude Code internal worktree, **not real feature work**. Do not merge or remove without confirming with the user first. |

`main` itself: small uncommitted diff on `TripDocumentStorageAPI.swift`, `TripPhotoAPI.swift`, `Extensions.swift`, `HealthViewModel.swift` (+4 lines).

## Execution order

Ordering principle: smallest/most isolated first, most architecturally invasive last, so risk and rework increase gradually and each step verifies against a known-good `main`. Re-check each worktree's actual current diff immediately before acting on it — state may have moved since the table above.

**Step 0 — noise removal + main's own WIP**
- Add `web/tsconfig.tsbuildinfo` to `.gitignore`; `git rm --cached` it on `main`.
- Commit `main`'s own current small diff as its own commit.
- Verify: `cd web && npm run typecheck && npm run lint`.

**Step 1 — `trip-map-google-places`**
- Rebase onto `main`. No known file overlaps.
- Verify: `cd web && npm run typecheck && npm run build && npm run test:trips`. `cd api && npm run build`.
- Merge to `main`.

**Step 2 — `medication-tracking-expansion`**
- Rebase onto `main` (now includes step 1).
- Verify: `cd web && npm run typecheck && npm run build && npm run test:medications`.
- Merge to `main`. This is the data-model foundation (providers, LOC/LOT, bedtime, DOB) that step 3 builds on.

**Step 3 — `medication-course-lifecycle`**
- Commit its uncommitted WIP inside the worktree as a proper commit first.
- Rebase onto `main` (now includes steps 1–2). Resolve `HealthViewModel.swift`/`HealthView.swift` overlap by manual reconciliation (both sides are wanted work — merge intents, don't pick one side).
- Verify: `cd web && npm run typecheck && npm run build && npm run test:medications`. iOS: `xcodebuild` compile check on the affected targets (Health).
- Merge to `main`.

**Step 4 — `travel-health-taxonomy`**
- Commit its uncommitted WIP inside the worktree as a proper commit first.
- Rebase onto `main` (now includes steps 1–3). Resolve `HealthView.swift`/`medications-client.tsx`/trip-client overlaps against what step 3 just landed (manual reconciliation).
- Verify: `cd web && npm run typecheck && npm run build && npm run test:trips && npm run test:medications`. iOS: compile check.
- Merge to `main`.

**Step 5 — `codex-activity-first`**
- Rebase onto `main` (now includes steps 1–4; this branch is 13 commits stale, expect the most rework here).
- Apply the schema decision above to the `activity_graph` migration and to `web/src/app/api/trips/route.ts` before merging.
- Verify: `cd web && npm run typecheck && npm run build && npm run test:trips`. `cd api && npm run build`. Review the migration against current `supabase/migrations/` for drift/gaps per the branch's own "migration baseline blocker" note.
- Merge to `main`.

**Step 6 — push**
- Push `main` (58 pre-existing commits + all merged work) to `origin/main`.

## Out of scope / flagged, not auto-resolved
- `.claude/worktrees/youthful-poincare-df541c`: flag to the user; do not remove without explicit confirmation.
- Sub-project A (reconciling DESIGN_BRIEF.md / BUSINESS_MODEL.md / README.md / INCIDENT_RESPONSE.md / empty docs/ stubs / unified north-star IA doc): separate spec, not covered here.

## Notes for the implementation plan
- Before every commit on `main` in this repo, run `git diff --cached --stat` and unstage anything unintentional — this repo's index has previously held unrelated pre-staged files (see memory `doc-hub-git-staging-gotcha`).
- `api`'s `npm run verify` chain hits live services (DB, vendor APIs) — use targeted `web` test scripts plus `build`/`typecheck` as the fast per-step gate; reserve full `api verify` for before the final push, not every step, unless a step touches `api/`.
