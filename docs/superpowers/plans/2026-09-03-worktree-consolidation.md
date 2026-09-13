# Worktree Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are strictly sequential and share one working tree (`main`) — do not parallelize or dispatch independent subagents per task.

**Goal:** Land 5 active git worktrees (real, wanted feature work) onto `main` in dependency/risk order, resolving known file overlaps, verifying at every step, then push the consolidated `main` (58 pre-existing commits + all merged work) to `origin/main`.

**Architecture:** Each task rebases one worktree's branch onto the current tip of `main`, resolves any conflicts by keeping both sides' intent (not picking one), fast-forward-merges into the `main` worktree, then runs verify commands from the `main` worktree (which has `node_modules` installed — the other worktrees may not).

**Tech Stack:** Next.js 15 (`web/`), Fastify/tsc (`api/`), SwiftUI/Xcode (`ios/`), git worktrees.

**Spec:** [docs/superpowers/specs/2026-09-03-worktree-consolidation-design.md](../specs/2026-09-03-worktree-consolidation-design.md)

## Global Constraints

- Before **every** commit in this repo, run `git diff --cached --stat` and unstage (`git restore --staged <path>`) anything not intentionally part of the change — this repo's index has previously held unrelated pre-staged files.
- `journey_type` (on `journeys`) is canonical; `trip_type` (on `trips`, values `travel`/`food_order`/`sport`/`general`) is a sub-classifier valid only when `journey_type = 'trip'`. Apply this in Task 6.
- Re-check each worktree's actual current `git status`/diff immediately before acting on it — state may have moved since this plan was written (one worktree the design doc's earlier audit saw had already vanished by the time of a later check in the same session).
- Never `git push --force`, never `--no-verify`, never skip hooks.
- All paths below are relative to `/Users/chainimitsakhorn/Documents/Project/Slippy` unless a `cd` is shown.

---

### Task 1: Noise removal + commit main's own WIP

**Files:**
- Modify: `.gitignore` (add `web/tsconfig.tsbuildinfo`)
- Untrack: `web/tsconfig.tsbuildinfo`
- Commit (as-is, no code changes): `ios/Slippy/Services/TripDocumentStorageAPI.swift`, `ios/Slippy/Services/TripPhotoAPI.swift`, `ios/Slippy/Utils/Extensions.swift`, `ios/Slippy/ViewModels/HealthViewModel.swift`

**Interfaces:** Produces: a clean `main` (no dirty files, `tsconfig.tsbuildinfo` no longer tracked) that Task 2 rebases onto.

- [ ] **Step 1: Confirm starting state**

```bash
git status --short
git diff --cached --stat
```
Expected: the 4 iOS files + `web/tsconfig.tsbuildinfo` modified, nothing staged. If the index is non-empty, stop and inspect before continuing (see Global Constraints).

- [ ] **Step 2: Untrack the build artifact and gitignore it**

```bash
grep -qxF 'web/tsconfig.tsbuildinfo' .gitignore || echo 'web/tsconfig.tsbuildinfo' >> .gitignore
git rm --cached web/tsconfig.tsbuildinfo
git add .gitignore
git diff --cached --stat
```
Expected: only `.gitignore` (modified) and `web/tsconfig.tsbuildinfo` (deleted from index) staged.

- [ ] **Step 3: Commit the gitignore change**

```bash
git commit -m "$(cat <<'EOF'
chore: stop tracking web/tsconfig.tsbuildinfo

Build artifact was showing as a false conflict across multiple
worktrees.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Sanity-check the repo baseline before committing WIP**

```bash
cd web && npm run typecheck && npm run lint && cd ..
```
Expected: both pass (this is pre-existing `main` code, should already be green).

- [ ] **Step 5: Stage and commit main's own iOS WIP**

```bash
git add ios/Slippy/Services/TripDocumentStorageAPI.swift ios/Slippy/Services/TripPhotoAPI.swift ios/Slippy/Utils/Extensions.swift ios/Slippy/ViewModels/HealthViewModel.swift
git diff --cached --stat
```
Expected: exactly these 4 files staged.

```bash
git commit -m "$(cat <<'EOF'
wip(trips): in-progress edits to trip document/photo services

Committing pre-existing uncommitted work on main before consolidating
parallel worktrees.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify clean state**

```bash
git status --short
```
Expected: empty output.

---

### Task 2: Merge `trip-map-google-places`

**Files:** touched by the branch's own 4 commits (Google Places search endpoint, trip map pin icon, itinerary fetch fix, package-lock update) — not modified by this task directly beyond the merge.

**Interfaces:** Consumes: clean `main` from Task 1. Produces: `main` with trip map/places work merged, still green.

- [ ] **Step 1: Re-verify current worktree state**

```bash
git -C .worktrees/trip-map-google-places status --short
git -C .worktrees/trip-map-google-places log main..HEAD --oneline
```
Expected: clean working tree, 4 commits ahead of old `main` position (re-confirm count against current `main` — may differ from the 38/4 recorded in the design doc if `main` has moved).

- [ ] **Step 2: Rebase onto current main**

```bash
git -C .worktrees/trip-map-google-places rebase main
```
Expected: no known file overlaps with any other worktree — should rebase cleanly. If conflicts appear, they were not anticipated by the design doc; stop, inspect with `git -C .worktrees/trip-map-google-places status`, resolve by keeping both sides' changes where they touch different logic, `git -C .worktrees/trip-map-google-places add <file>`, `git -C .worktrees/trip-map-google-places rebase --continue`.

- [ ] **Step 3: Fast-forward main to the rebased branch**

```bash
git merge --ff-only sdd-trip-map-google-places
```
Expected: "Fast-forward" merge, no merge commit needed.

- [ ] **Step 4: Verify**

```bash
cd web && npm run typecheck && npm run build && npm run test:trips && cd ..
cd api && npm run build && cd ..
```
Expected: all pass.

- [ ] **Step 5: Confirm state**

```bash
git log --oneline -6
git status --short
```
Expected: the 4 trip-map commits now on `main`, clean tree.

---

### Task 3: Merge `medication-tracking-expansion`

**Files:** touched by the branch's own 13 commits (medical_providers table, MedicalProvider model, provider CRUD, LOC/LOT fields, bedtime toggle, pack calculator, DOB field, LINE reminder sync).

**Interfaces:** Consumes: `main` from Task 2. Produces: `main` with the medication provider/LOC-LOT/bedtime data-model foundation that Task 4 builds on.

- [ ] **Step 1: Re-verify current worktree state**

```bash
git -C .worktrees/medication-tracking-expansion status --short
git -C .worktrees/medication-tracking-expansion log main..HEAD --oneline
```
Expected: only `web/tsconfig.tsbuildinfo` dirty (already gitignored as of Task 1 — confirm with `git -C .worktrees/medication-tracking-expansion status --short` showing nothing once ignored), ~13 commits ahead.

If `web/tsconfig.tsbuildinfo` still shows as modified (worktree hasn't picked up the new `.gitignore` yet because it predates the rebase), untrack it there too:
```bash
git -C .worktrees/medication-tracking-expansion rm --cached web/tsconfig.tsbuildinfo 2>/dev/null || true
```

- [ ] **Step 2: Rebase onto current main**

```bash
git -C .worktrees/medication-tracking-expansion rebase main
```
Expected: clean rebase (no file overlap with Task 1/2's changes). If conflicts appear in `.gitignore` or `tsconfig.tsbuildinfo`, resolve by taking main's version (`git -C .worktrees/medication-tracking-expansion checkout --ours -- .gitignore web/tsconfig.tsbuildinfo` is wrong direction during rebase — during rebase "ours" is the branch being replayed onto, i.e. main's side; use `git -C .worktrees/medication-tracking-expansion checkout --theirs -- <file>` only if the conflict is purely the tsconfig noise, otherwise inspect manually), then `add` + `rebase --continue`.

- [ ] **Step 3: Fast-forward main**

```bash
git merge --ff-only sdd-medication-tracking-expansion
```

- [ ] **Step 4: Verify**

```bash
cd web && npm run typecheck && npm run build && npm run test:medications && cd ..
```
Expected: all pass. This branch adds `MedicalProvider`/LOC-LOT/bedtime fields — `test:medications` (`src/lib/medications.test.mjs`) is the direct coverage.

- [ ] **Step 5: Confirm state**

```bash
git log --oneline -14
git status --short
```

---

### Task 4: Merge `medication-course-lifecycle`

**Files:**
- Commit inside worktree first: `ios/Slippy/Models/HealthModels.swift`, `ios/Slippy/ViewModels/HealthViewModel.swift`, `ios/Slippy/Views/Health/AddMedicationView.swift`, `ios/Slippy/Views/Health/HealthView.swift`, `web/src/app/(app)/health/medications/page.tsx`, `web/src/components/health/medications-client.tsx`, `package-lock.json`, new: `web/src/components/health/medication-course-card.tsx`, `medication-lifecycle-dialog.tsx`, `medication-timeline.tsx`

**Interfaces:** Consumes: `main` from Task 3, including `MedicalProvider`/LOC-LOT/bedtime fields on the medication data model. Produces: `main` with course lifecycle (start/end, refill tracking) layered on top.

**Known overlap:** `HealthViewModel.swift` and `HealthView.swift` were also touched by Task 1's committed main-WIP and will be touched again by Task 5 (`travel-health-taxonomy`). Reconciliation policy: this task's changes are course-lifecycle *behavior* (new methods/state for course start/end/refill); Task 1's were unrelated small edits already merged; Task 5's will be presentation/taxonomy (icons/category labels). Keep all three — if a rebase conflict lands in the same function, merge by including both the course-lifecycle logic and whatever the pre-existing (already-merged) code does around it; do not delete either side's additions.

- [ ] **Step 1: Re-verify current worktree state**

```bash
git -C .worktrees/medication-course-lifecycle status --short
git -C .worktrees/medication-course-lifecycle log main..HEAD --oneline
```

- [ ] **Step 2: Commit the worktree's uncommitted WIP**

```bash
git -C .worktrees/medication-course-lifecycle add \
  ios/Slippy/Models/HealthModels.swift \
  ios/Slippy/ViewModels/HealthViewModel.swift \
  ios/Slippy/Views/Health/AddMedicationView.swift \
  ios/Slippy/Views/Health/HealthView.swift \
  "web/src/app/(app)/health/medications/page.tsx" \
  web/src/components/health/medications-client.tsx \
  web/src/components/health/medication-course-card.tsx \
  web/src/components/health/medication-lifecycle-dialog.tsx \
  web/src/components/health/medication-timeline.tsx \
  package-lock.json
git -C .worktrees/medication-course-lifecycle diff --cached --stat
```
Expected: exactly the files above staged (not `web/tsconfig.tsbuildinfo`).

```bash
git -C .worktrees/medication-course-lifecycle commit -m "$(cat <<'EOF'
feat(medications): wire course lifecycle UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Rebase onto current main**

```bash
git -C .worktrees/medication-course-lifecycle rebase main
```
If conflicts in `HealthViewModel.swift`/`HealthView.swift`: open the file, keep both the course-lifecycle additions from this branch and whatever is already on `main` from Task 1/3, following the reconciliation policy above. Then:
```bash
git -C .worktrees/medication-course-lifecycle add <resolved-file>
git -C .worktrees/medication-course-lifecycle rebase --continue
```

- [ ] **Step 4: Fast-forward main**

```bash
git merge --ff-only codex/medication-course-lifecycle
```

- [ ] **Step 5: Verify**

```bash
cd web && npm run typecheck && npm run build && npm run test:medications && cd ..
xcodebuild build -project ios/Slippy.xcodeproj -scheme Slippy -destination 'generic/platform=iOS Simulator' -quiet
```
Expected: all pass.

- [ ] **Step 6: Confirm state**

```bash
git log --oneline -5
git status --short
```

---

### Task 5: Merge `travel-health-taxonomy`

**Files:**
- Commit inside worktree first: `ios/Slippy/Models/JourneyStyle.swift`, `ios/Slippy/Views/Health/HealthView.swift`, `web/src/components/health/medications-client.tsx`, `web/src/components/trips/trip-detail-client.tsx`, `web/src/components/trips/trips-client.tsx`, new: `ios/Slippy/Models/ActivityTaxonomy.swift`, `web/src/lib/activity-taxonomy.ts`, `web/src/lib/activity-taxonomy.test.mjs`

**Interfaces:** Consumes: `main` from Task 4, including the just-landed course-lifecycle UI in `HealthView.swift`/`medications-client.tsx`. Produces: `main` with a unified category/icon taxonomy applied across trips, itinerary, documents, expenses, and medications (presentation layer only — no data migration, per the source doc's own description).

**Known overlap:** same `HealthView.swift`/`medications-client.tsx` files Task 4 just changed. This task is presentation-layer (icons/labels); Task 4's was behavior (course lifecycle state/actions). Reconciliation: apply this task's icon/label/category changes on top of Task 4's already-merged structure — don't revert Task 4's course-lifecycle UI elements, just re-skin them with the shared taxonomy.

- [ ] **Step 1: Re-verify current worktree state**

```bash
git -C .worktrees/travel-health-taxonomy status --short
```

- [ ] **Step 2: Commit the worktree's uncommitted WIP**

```bash
git -C .worktrees/travel-health-taxonomy add \
  ios/Slippy/Models/JourneyStyle.swift \
  ios/Slippy/Models/ActivityTaxonomy.swift \
  ios/Slippy/Views/Health/HealthView.swift \
  web/src/components/health/medications-client.tsx \
  web/src/components/trips/trip-detail-client.tsx \
  web/src/components/trips/trips-client.tsx \
  web/src/lib/activity-taxonomy.ts \
  web/src/lib/activity-taxonomy.test.mjs
git -C .worktrees/travel-health-taxonomy diff --cached --stat
git -C .worktrees/travel-health-taxonomy commit -m "$(cat <<'EOF'
feat(taxonomy): apply shared travel/health activity taxonomy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Rebase onto current main**

```bash
git -C .worktrees/travel-health-taxonomy rebase main
```
This branch was recorded at 0 ahead/0 behind main's older tip — it will now be rebasing across Tasks 2-4's commits, so expect real conflicts in `HealthView.swift` and `medications-client.tsx`. Resolve per the policy above: keep Task 4's course-lifecycle structure, apply this branch's taxonomy re-skinning on top.
```bash
git -C .worktrees/travel-health-taxonomy add <resolved-file>
git -C .worktrees/travel-health-taxonomy rebase --continue
```

- [ ] **Step 4: Fast-forward main**

```bash
git merge --ff-only codex/travel-health-taxonomy
```

- [ ] **Step 5: Verify**

```bash
cd web && npm run typecheck && npm run build && npm run test:trips && npm run test:medications && cd ..
xcodebuild build -project ios/Slippy.xcodeproj -scheme Slippy -destination 'generic/platform=iOS Simulator' -quiet
```

- [ ] **Step 6: Confirm state**

```bash
git log --oneline -3
git status --short
```

---

### Task 6: Merge `codex-activity-first`

**Files:**
- Modify per schema decision: `web/src/app/api/trips/route.ts:99`
- Create: `supabase/migrations/20260903120000_journey_type_trip_type_constraint.sql`

**Interfaces:** Consumes: `main` from Task 5. Produces: `main` with the activity-graph schema/APIs/iOS feed view merged, plus `journey_type='trip'` enforced as the only valid pairing with a non-default `trip_type` (DB-level CHECK constraint on `public.life_journeys`).

- [ ] **Step 1: Re-verify current worktree state**

```bash
git -C .worktrees/codex-activity-first status --short
git -C .worktrees/codex-activity-first log main..HEAD --oneline
```
Expected: only `web/tsconfig.tsbuildinfo` dirty; this branch was recorded 13 commits behind `main` — re-confirm against current `main` (now 5 tasks further ahead than at design time).

- [ ] **Step 2: Rebase onto current main**

```bash
git -C .worktrees/codex-activity-first rebase main
```
This is the most stale branch (originally 13 behind, more now) — expect conflicts. Resolve non-schema conflicts by inspection (keep both sides' intent). For any conflict touching `journey_type`/`trip_type` logic, don't resolve yet — take the branch's version as a starting point and defer the schema fix to Step 4 below.
```bash
git -C .worktrees/codex-activity-first add <resolved-file>
git -C .worktrees/codex-activity-first rebase --continue
```

- [ ] **Step 3: Fast-forward main**

```bash
git merge --ff-only codex/activity-first
```

- [ ] **Step 4: Apply the journey_type/trip_type schema decision**

Verified against `supabase/migrations/025_life_graph.sql:52`, `030_trip_management.sql:9-10`, `089_trip_bootstrap_rpc.sql:44-48`, `095_trip_journey_privacy.sql`: `trip_type` (`CHECK (trip_type IN ('travel','food_order','sport','general'))`, default `'general'`) and `journey_type` (`NOT NULL DEFAULT 'trip'`) are **both columns on the same table**, `public.life_journeys` — not separate tables. The `create_trip_full` RPC already hardcodes `journey_type = 'trip'` for every row it creates, and migration 095's RLS policies already branch on `journey_type = 'trip'` vs `<> 'trip'`. The decision is already the DB's real convention — the one place that contradicts it is the ad-hoc bridge in `web/src/app/api/trips/route.ts:99`, which sets `journey_type = 'event'` for any `trip_type` other than `'travel'` (i.e. `food_order`/`sport`/`general` trips get miscategorized as non-trip journeys).

Fix the web route:

```typescript
// Before (contradicts the RPC's convention — line 99):
journey_type:    trip_type === "travel" ? "trip" : "event",
```
```typescript
// After (matches create_trip_full's convention — trip_type never implies
// journey_type='event'; anything created via this trips endpoint is a trip):
journey_type:    "trip",
```

Add a new migration enforcing the rule at the DB level (both columns live on `life_journeys`, so a same-table CHECK is sufficient — no cross-table constraint needed):

Create `supabase/migrations/20260903120000_journey_type_trip_type_constraint.sql`:
```sql
-- trip_type is only meaningful when journey_type='trip'; enforce at the DB
-- level now that both the create_trip_full RPC and the trips API route
-- agree on this convention.
ALTER TABLE public.life_journeys
  ADD CONSTRAINT life_journeys_trip_type_requires_trip_journey
  CHECK (trip_type = 'general' OR journey_type = 'trip');
```
(`trip_type` defaults to `'general'`, so this permits any non-trip journey to carry the default while requiring `journey_type='trip'` for any row that sets a real `trip_type` value.)

Apply this migration the way prior manually-applied migrations in this repo were applied (psql pooler / SQL editor — see memory `datagoth-dbd-api-findings` for precedent; `supabase db push` is known to refuse due to existing drift), and confirm no existing row violates it first:
```sql
SELECT id, trip_type, journey_type FROM public.life_journeys
WHERE trip_type <> 'general' AND journey_type <> 'trip';
```
Expected: 0 rows (if any exist, fix that data before adding the constraint — do not add the constraint against violating data).

- [ ] **Step 5: Verify**

```bash
cd web && npm run typecheck && npm run build && npm run test:trips && cd ..
cd api && npm run build && cd ..
```

- [ ] **Step 6: Commit the schema-decision fix**

```bash
git add web/src/app/api/trips/route.ts supabase/migrations/20260903120000_journey_type_trip_type_constraint.sql
git diff --cached --stat
git commit -m "$(cat <<'EOF'
fix(activities): make journey_type canonical, trip_type a sub-classifier

trip_type (travel/food_order/sport/general) is now only meaningful
when journey_type='trip', matching create_trip_full's existing
convention. Removes the trips API's contradictory journey_type='event'
inference and adds a DB-level CHECK constraint on life_journeys.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Note:** the CHECK constraint migration must be applied to the live Supabase DB separately (psql pooler / SQL editor — `supabase db push` is known to refuse due to existing migration drift); committing it to git tracks it, but does not apply it. Apply it manually after this task, before Task 7's push, and re-run the "0 violating rows" query above against production data first.

- [ ] **Step 7: Confirm state**

```bash
git log --oneline -10
git status --short
```

---

### Task 7: Push to origin

**Interfaces:** Consumes: fully consolidated, verified `main` from Task 6.

- [ ] **Step 1: Final full verify pass**

```bash
cd web && npm run typecheck && npm run lint && npm run build && npm run test:trips && npm run test:medications && npm run test:calls && npm run test:location-sharing && npm run test:security && npm run test:vat && cd ..
cd api && npm run build && npm run verify && cd ..
```
Expected: all pass. `api`'s `npm run verify` chain hits live services (DB, vendor APIs) — this is the one point in the plan where that's worth the cost, since it's the last gate before `origin`.

- [ ] **Step 2: Review what's about to be pushed**

```bash
git log origin/main..main --oneline
git diff origin/main..main --stat
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Confirm**

```bash
git status --short
git log --oneline -1
```
Expected: "Your branch is up to date with 'origin/main'."

---

## Out of scope (do not do as part of this plan)

- `.claude/worktrees/youthful-poincare-df541c` — flagged as a likely leftover Claude Code internal worktree, not real feature work. Do not merge or remove; ask the user first.
- Sub-project A (DESIGN_BRIEF.md / BUSINESS_MODEL.md / README.md / INCIDENT_RESPONSE.md / empty `docs/` stubs / unified north-star IA doc) — separate spec and plan.
