# Medication Course Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add course-based medication lifecycle tracking, a time-first daily dose timeline, and shared start/pause/resume/stop behavior to Web and Native iOS without losing legacy medication history.

**Architecture:** Preserve `medications` as durable drug identity and introduce `medication_courses` plus append-only `medication_course_events`. Add stable dose slots and course-linked logs, expose lifecycle transitions through one transactional Supabase RPC, then consume the same read/write contract from Next.js and SwiftUI. Roll out additively: legacy columns remain and current rows are backfilled.

**Tech Stack:** Supabase Postgres/RLS/RPC, Next.js 15 + React 19 + TypeScript, SwiftUI + Supabase Swift, Node test runner, Xcode 26 simulator build, built-in image generation for the final visual mockup.

**Spec:** `docs/superpowers/specs/2026-09-03-medication-course-lifecycle-design.md`

## Global Constraints

- Default UI is a time-based `วันนี้` timeline; `ยาทั้งหมด` is the management/history view.
- Course status values are exactly `active`, `paused`, `stopped`, and `completed`.
- Reaching `planned_end_date` never changes status automatically; UI shows `ครบกำหนด — รอยืนยัน`.
- Slippy can summarize sourced instructions and flag ambiguity, but cannot diagnose or recommend a dose/lifecycle change.
- Every lifecycle change requires explicit user confirmation and retains an append-only event.
- Paused periods create no future dose occurrences and never count as missed adherence.
- Web and iOS use the same database contract and Thai status language.
- Existing medication, schedule, inventory, and log records must remain readable throughout rollout.
- Do not stage or commit unrelated journey/split/profile refactor files already present in the working tree.

---

### Task 1: Pure lifecycle and timeline contract

**Files:**
- Create: `web/src/lib/medication-lifecycle.ts`
- Create: `web/src/lib/medication-lifecycle.test.mjs`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: legacy medication schedule/log values from existing API responses.
- Produces: `CourseStatus`, `MedicationCourse`, `DoseSlot`, `DoseOccurrence`, `groupDoseTimeline()`, `summarizeRound()`, and `allowedLifecycleActions()` for API/UI tasks.

- [ ] **Step 1: Write failing lifecycle tests**

Cover these exact assertions with Node's `node:test`:

```ts
assert.deepEqual(allowedLifecycleActions("active"), ["pause", "stop", "complete"])
assert.deepEqual(allowedLifecycleActions("paused"), ["resume", "stop"])
assert.equal(summarizeRound([taken, pending]).status, "due")
assert.equal(summarizeRound([taken, skipped]).status, "complete")
assert.equal(groupDoseTimeline(occurrences)[0].timeLabel, "08:00")
assert.equal(groupDoseTimeline(pausedOccurrences).length, 0)
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --experimental-strip-types --test web/src/lib/medication-lifecycle.test.mjs`

Expected: FAIL because `medication-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure contract**

Define discriminated unions and pure functions. Timeline grouping must sort explicit `HH:mm` values first and `bedtime` last, retain every medication occurrence in the group, and calculate a round as complete only when all occurrences are `taken`, `late`, or `skipped`.

- [ ] **Step 4: Add the package test command and verify**

Add:

```json
"test:medication-lifecycle": "node --experimental-strip-types --test src/lib/medication-lifecycle.test.mjs"
```

Run:

```bash
npm run test:medication-lifecycle --workspace=web
npm run test:medications --workspace=web
```

Expected: all tests pass.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add web/package.json web/src/lib/medication-lifecycle.ts web/src/lib/medication-lifecycle.test.mjs
git commit -m "feat(medications): add lifecycle timeline contract"
```

---

### Task 2: Additive Supabase lifecycle schema and transition RPC

**Files:**
- Create: `supabase/migrations/20260903090000_medication_course_lifecycle.sql`

**Interfaces:**
- Consumes: existing `users`, `medications`, `medication_schedules`, `medication_inventory`, and `medication_logs` tables.
- Produces: `medical_providers`, `medication_courses`, `medication_course_events`, `medication_dose_slots`; nullable `course_id` compatibility keys; and `transition_medication_course(uuid,text,timestamptz,text,text,text)`.

- [ ] **Step 1: Write migration assertions before the migration**

Create a temporary local verification query during execution that asserts:

```sql
select to_regclass('public.medication_courses') is not null;
select to_regclass('public.medication_course_events') is not null;
select count(*) = 0 from medication_courses where status not in ('active','paused','stopped','completed');
select count(*) = 0 from medications m
where m.is_active and not exists (
  select 1 from medication_courses c where c.medication_id = m.id
);
```

Run against a reset local Supabase database before adding the migration; expected first two assertions are false.

- [ ] **Step 2: Create tables, constraints, indexes, and RLS**

Migration requirements:

```sql
create table medication_courses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medications(id) on delete restrict,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','stopped','completed')),
  start_date date not null default current_date,
  planned_end_date date,
  actual_end_at timestamptz,
  provider_id uuid,
  prescribed_by text,
  doctor_instructions text,
  instruction_source text not null default 'user' check (instruction_source in ('label','doctor','pharmacist','user')),
  resume_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_end_date is null or planned_end_date >= start_date)
);
```

Add a partial unique index on `(user_id, medication_id)` where status is `active` or `paused`. Create ownership RLS policies using both `USING (user_id = auth.uid())` and `WITH CHECK (user_id = auth.uid())`. Create equivalent owner-scoped RLS for providers, events, and slots. Add `course_id` as nullable to schedules/logs for compatibility and index every foreign key used by timeline reads.

- [ ] **Step 3: Add provider, slot, event, inventory, and profile fields**

Create `medical_providers` with `name`, `type`, and `hn`; create stable `medication_dose_slots` with `time_value`, `period_label`, `dose_qty`, meal fields, sort order, reminder flag, and active flag. Add `loc_code`, `lot_no`, and reuse `qty_per_pack` on inventory. Add `date_of_birth` to `users` if missing.

- [ ] **Step 4: Backfill one course per active medication**

Use one deterministic `INSERT ... SELECT` from active medications, taking the earliest active schedule start and latest nullable schedule end. Backfill `medication_schedules.course_id` and `medication_logs.course_id` through medication ownership. Convert each legacy schedule time to one dose-slot row with `ON CONFLICT DO NOTHING`. Do not delete or make legacy keys non-null in this migration.

- [ ] **Step 5: Implement the transactional transition RPC**

`transition_medication_course` must:

1. lock the owned course `FOR UPDATE`;
2. reject invalid source/target transitions;
3. insert an event keyed by `(course_id, idempotency_key)`;
4. update status/end/review fields;
5. mark only future pending logs skipped/cancelled as defined by the schema;
6. return the updated course row.

Grant execute to `authenticated`, revoke from `anon`, and set `search_path = public` explicitly.

- [ ] **Step 6: Reset and verify locally**

Run:

```bash
supabase db reset
supabase db lint --level warning
```

Then run the assertions from Step 1 plus RLS checks with two users and transition checks for active→paused→active→stopped, duplicate idempotency keys, and invalid stopped→active.

- [ ] **Step 7: Commit only the migration**

```bash
git add supabase/migrations/20260903090000_medication_course_lifecycle.sql
git commit -m "feat(medications): add course lifecycle schema"
```

---

### Task 3: Web lifecycle API and shared read model

**Files:**
- Create: `web/src/lib/medication-course-store.ts`
- Create: `web/src/lib/medication-course-store.test.mjs`
- Create: `web/src/app/api/medications/courses/[id]/transition/route.ts`
- Modify: `web/src/app/api/medications/route.ts`
- Modify: `web/src/lib/medications.ts`
- Modify: `web/src/lib/medications.test.mjs`

**Interfaces:**
- Consumes: Task 2 RPC and Task 1 domain types.
- Produces: authenticated course transition route and medication response containing `medication_courses`, `medication_dose_slots`, `medication_course_events`, schedules, inventory, and today occurrences.

- [ ] **Step 1: Write failing store tests**

Tests must prove the store scopes reads/writes by `user_id`, forwards the idempotency key to the RPC, maps stale-state database errors to `MedicationCourseConflict`, and never hard-deletes medication history.

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test web/src/lib/medication-course-store.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the injectable store**

Export:

```ts
transitionMedicationCourse(input: {
  courseId: string
  userId: string
  action: "pause" | "resume" | "stop" | "complete"
  effectiveAt: string
  reason?: string | null
  confirmedBy: "self" | "doctor" | "pharmacist" | "caregiver"
  idempotencyKey: string
}, db?: MedicationCourseDb): Promise<MedicationCourse>
```

- [ ] **Step 4: Add authenticated route validation**

The route obtains the user from the existing server auth helper, validates UUID/action/date/source, rejects missing idempotency key with 400, returns 401 for no user, 409 for stale/invalid transitions, and 200 with the updated course.

- [ ] **Step 5: Extend create/edit/list contracts**

Medication creation writes identity, course, slots, schedule compatibility row, and inventory in a rollback-safe RPC or compensates before returning an error. Editing identity never overwrites a historical course. The list query returns active/paused courses and today logs while the history filter can request ended courses.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm run test:medication-lifecycle --workspace=web
npm run test:medications --workspace=web
node --experimental-strip-types --test web/src/lib/medication-course-store.test.mjs
npm run typecheck --workspace=web
```

- [ ] **Step 7: Commit Task 3 files only**

```bash
git add web/src/lib/medication-course-store.ts web/src/lib/medication-course-store.test.mjs web/src/app/api/medications/courses/[id]/transition/route.ts web/src/app/api/medications/route.ts web/src/lib/medications.ts web/src/lib/medications.test.mjs
git commit -m "feat(medications): expose course lifecycle API"
```

---

### Task 4: Web Today timeline and medication-course management

**Files:**
- Create: `web/src/components/health/medication-timeline.tsx`
- Create: `web/src/components/health/medication-course-card.tsx`
- Create: `web/src/components/health/medication-lifecycle-dialog.tsx`
- Modify: `web/src/components/health/medications-client.tsx`
- Modify: `web/src/app/(app)/health/medications/page.tsx`

**Interfaces:**
- Consumes: Task 1 grouping helpers and Task 3 API response/routes.
- Produces: responsive `วันนี้ / ยาทั้งหมด` UI with per-dose confirmation, filters, lifecycle dialogs, and sourced Slippy guidance.

- [ ] **Step 1: Add component behavior tests to the pure contract suite**

Add fixtures asserting same-time drugs remain independent, a skipped dose completes its round without incrementing taken count, planned-end active courses show `due_for_review`, and paused courses appear only in the pause banner/management tab.

- [ ] **Step 2: Verify new assertions fail, then extend helpers**

Run Task 1 tests. Implement only missing selectors such as `courseDisplayState()` and `todayProgress()` until they pass.

- [ ] **Step 3: Build the compact time-first timeline**

Use 15–16 px body text, compact 12–13 px metadata, and avoid full-height hero artwork. Every time block shows time/period, medications, dose, source instruction summary, and independent status control. Header progress counts dose occurrences rather than medications.

- [ ] **Step 4: Build the management tab and transitions**

Filters: `กำลังใช้`, `พักยา`, `ประวัติ`. Cards show status, next dose, remaining stock, course dates, and a detail disclosure. Dialog actions collect effective date, optional reason, and confirmer; show an explicit final confirmation; send a UUID idempotency key; then refresh state.

- [ ] **Step 5: Keep scanner review fields separated**

Move OCR verbatim text into `doctor_instructions`, retain `notes` for personal notes, and show the exact `สแกนจากฉลาก` source badge. Add start/planned-end dates, provider, LOT/LOC, pack size, already-used calculator, and bedtime slot label without expanding the default list cards.

- [ ] **Step 6: Verify responsive web**

Run:

```bash
npm run test:medication-lifecycle --workspace=web
npm run test:medications --workspace=web
npm run typecheck --workspace=web
npm run build --workspace=web
```

Use a signed-in browser session to verify 390 px and desktop widths, timeline completion, all four lifecycle states, scan-review source labels, keyboard focus, and dark mode.

- [ ] **Step 7: Commit Task 4 files only**

```bash
git add web/src/components/health/medication-timeline.tsx web/src/components/health/medication-course-card.tsx web/src/components/health/medication-lifecycle-dialog.tsx web/src/components/health/medications-client.tsx 'web/src/app/(app)/health/medications/page.tsx'
git commit -m "feat(medications): add time-first course UI"
```

---

### Task 5: Native iOS shared lifecycle contract and data operations

**Files:**
- Modify: `ios/Slippy/Models/HealthModels.swift`
- Create: `ios/Slippy/Models/MedicationLifecycle.swift`
- Modify: `ios/Slippy/ViewModels/HealthViewModel.swift`
- Modify: `ios/Slippy/Services/MedicationScanAPI.swift`

**Interfaces:**
- Consumes: Task 2 Supabase tables/RPC and Task 3 response semantics.
- Produces: Codable shared models, course transition methods, course-aware dose logging, and notification synchronization.

- [ ] **Step 1: Add compile-time fixtures**

Add DEBUG-only JSON fixtures decoded through `JSONDecoder` for all course statuses, slot period labels, nullable legacy `course_id`, and event types. Assert them through a small pure `MedicationLifecycle.allowedActions(status:)` implementation.

- [ ] **Step 2: Extend Codable models**

Add `MedicationCourse`, `MedicationCourseEvent`, `MedicationDoseSlot`, and nested relations with explicit snake-case `CodingKeys`. Preserve decoding when course arrays are absent so staged database rollout cannot blank the medication screen.

- [ ] **Step 3: Add course-aware load/log methods**

Load medications with course/slot/event/inventory embeds. Generate or retrieve the stable occurrence before logging. Send course, slot, scheduled time, actual dose, and status; duplicate taps update the same occurrence rather than insert another log.

- [ ] **Step 4: Add lifecycle transition RPC wrapper**

Export `transitionCourse(id:action:effectiveAt:reason:confirmedBy:)`. Generate one UUID per user attempt and retain it across network retry. On 409-equivalent PostgREST failure, reload before showing the Thai conflict message.

- [ ] **Step 5: Synchronize local notifications**

Notification identifiers include course and slot IDs. Remove future notifications on pause/stop/complete; schedule only confirmed active future slots after start date; never restart automatically at `resume_review_at`.

- [ ] **Step 6: Compile Native iOS**

```bash
cd ios
./scripts/build-simulator.sh
```

Expected: `BUILD SUCCEEDED`, including Watch target.

- [ ] **Step 7: Commit Task 5 files only**

```bash
git add ios/Slippy/Models/HealthModels.swift ios/Slippy/Models/MedicationLifecycle.swift ios/Slippy/ViewModels/HealthViewModel.swift ios/Slippy/Services/MedicationScanAPI.swift
git commit -m "feat(ios): add medication course lifecycle data"
```

---

### Task 6: Native iOS Today and course-management UI

**Files:**
- Create: `ios/Slippy/Views/Health/MedicationTimelineView.swift`
- Create: `ios/Slippy/Views/Health/MedicationCourseCard.swift`
- Create: `ios/Slippy/Views/Health/MedicationLifecycleSheet.swift`
- Modify: `ios/Slippy/Views/Health/HealthView.swift`
- Modify: `ios/Slippy/Views/Health/AddMedicationView.swift`

**Interfaces:**
- Consumes: Task 5 observable data/actions.
- Produces: SwiftUI parity for the Web Today timeline, management filters, course form, sourced guidance, and lifecycle confirmation sheets.

- [ ] **Step 1: Split health screen by responsibility**

Keep `HealthView` as navigation/state composition. Put dose timeline, course card, and lifecycle sheet in focused files so the ongoing project restructure can move them without extracting nested private types later.

- [ ] **Step 2: Implement the two-tab hierarchy**

Use a compact segmented control: `วันนี้` and `ยาทั้งหมด`. Default to Today. Group same-time doses in one block, retain independent buttons, and show completed/due/upcoming states with color plus icon/text—not color alone.

- [ ] **Step 3: Implement lifecycle management**

Show actions appropriate to status. Require confirmation, effective date, reason, and confirmer. Planned completion displays `ครบกำหนด — รอยืนยัน`; pause shows optional resume-review date without auto-resume.

- [ ] **Step 4: Expand add/scan review without inflating cards**

Use collapsible sections for course dates, provider/doctor, instructions, and inventory. Keep OCR verbatim instructions separate from personal notes. Include LOT/LOC, pack minus already-used calculation, and real-time bedtime reminders.

- [ ] **Step 5: Accessibility and simulator walkthrough**

Verify Dynamic Type does not truncate dose/name/status, VoiceOver labels distinguish every same-time dose, buttons meet 44 pt target size, and reduced motion is respected. Walk through start, pause, resume, permanent stop, and planned completion.

- [ ] **Step 6: Build and launch**

```bash
cd ios
./scripts/build-simulator.sh
xcrun simctl install 'iPhone 16 Pro' /private/tmp/slippy-simulator-derived/Build/Products/Debug-iphonesimulator/Slippy.app
xcrun simctl launch --terminate-running-process 'iPhone 16 Pro' app.slippy.ios
```

Capture a simulator screenshot after the screen settles and inspect it for clipping and hierarchy.

- [ ] **Step 7: Commit Task 6 files only**

```bash
git add ios/Slippy/Views/Health/MedicationTimelineView.swift ios/Slippy/Views/Health/MedicationCourseCard.swift ios/Slippy/Views/Health/MedicationLifecycleSheet.swift ios/Slippy/Views/Health/HealthView.swift ios/Slippy/Views/Health/AddMedicationView.swift
git commit -m "feat(ios): add medication course experience"
```

---

### Task 7: Professional anime mockup and final cross-surface verification

**Files:**
- Create: `web/public/design/slippy-medication-course-system-v1.png`
- Modify: `docs/superpowers/specs/2026-09-03-medication-course-lifecycle-design.md`

**Interfaces:**
- Consumes: final implemented UI and the user's approved visual direction.
- Produces: a project-bound portrait mockup showing the implemented information hierarchy and a final verification record.

- [ ] **Step 1: Generate the final mockup**

Use built-in image generation with the `ui-mockup` taxonomy. Prompt for a professional, serious anime doctor used only as a small guidance avatar; Slippy purple/teal palette; compact Thai typography; two tabs; a time-first Today timeline; same-time multiple medicines; clear taken/due/upcoming states; a small sourced guidance card; and a medication card showing active dates plus pause/stop affordances. Explicitly avoid oversized character art, childlike styling, huge text, fake brand logos, and medical diagnosis copy.

- [ ] **Step 2: Inspect and iterate once if needed**

Validate visual hierarchy, Thai legibility, compact scroll length, status differentiation, and presence of start/pause/stop concepts. Make one targeted regeneration/edit only if an essential invariant is missing.

- [ ] **Step 3: Save the approved output in the project**

Copy the generated image to `web/public/design/slippy-medication-course-system-v1.png` without replacing earlier reference images. Link it from the design spec as the visual reference, not as executable product UI.

- [ ] **Step 4: Run the full verification matrix**

```bash
npm run test:medication-lifecycle --workspace=web
npm run test:medications --workspace=web
node --experimental-strip-types --test web/src/lib/medication-course-store.test.mjs
npm run typecheck --workspace=web
npm run build --workspace=web
cd ios && ./scripts/build-simulator.sh
```

Run `git diff --check` and verify the staged file list contains only medication lifecycle, its design documents, and mockup files.

- [ ] **Step 5: Perform cross-surface smoke test**

Create a course on Web, pause it on iOS, resume it on Web, log two medications in the same time block independently, stop the course on iOS, and confirm both surfaces retain all earlier logs/events with no paused doses counted as missed.

- [ ] **Step 6: Commit final visual and verification documentation**

```bash
git add web/public/design/slippy-medication-course-system-v1.png docs/superpowers/specs/2026-09-03-medication-course-lifecycle-design.md
git commit -m "docs(medications): add lifecycle visual reference"
```

Stop after reporting commit IDs, build/test evidence, migration deployment status, and the mockup path. Do not begin unrelated project restructuring.
