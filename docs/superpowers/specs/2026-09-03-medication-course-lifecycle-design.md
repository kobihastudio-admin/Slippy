# Medication Course Lifecycle — Design

**Status:** Approved by the user on 2026-09-03.

## Goal

Restructure medication tracking so Slippy answers two separate questions well:

1. **What must I take in this round, and what have I already taken?**
2. **When did I start, pause, resume, complete, or permanently stop this course?**

The design applies to the web application and Native iOS. It retains dose and
inventory history, incorporates the previously approved label/provider fields,
and keeps Slippy's guidance informational rather than diagnostic.

## Confirmed product decisions

- The default screen is a time-based daily timeline. A second tab lists
  medications and courses.
- Pausing and permanently stopping are distinct actions.
- Slippy may summarize instructions and detect conflicts, but may not diagnose,
  alter a dose, or initiate a start/pause/stop action without confirmation.
- A medication is durable identity data. A course represents one period of use.
- Reusing the same medication later creates another course instead of replacing
  the previous course's dates, schedule, or history.
- Reaching a planned end date produces **ครบกำหนด — รอยืนยัน**. It never silently
  stops medication.

## Domain model

### `medications`

Retains durable drug identity and user-owned information:

- name, brand/generic name, dosage form, strength, purpose, color
- label image reference
- personal notes
- soft-delete/archive state

Clinical instructions do not share the personal-notes field.

### `medication_courses`

One row for each prescribed or self-recorded period of use:

- `id`, `medication_id`, `user_id`
- `status`: `active | paused | stopped | completed`
- `start_date`
- `planned_end_date` (nullable for continuous treatment)
- `actual_end_at` (nullable until stopped/completed)
- `prescribed_by`
- `provider_id`
- `doctor_instructions`
- `instruction_source`: `label | doctor | pharmacist | user`
- `created_at`, `updated_at`

Only one non-ended course per medication is allowed for a user. The database
enforces this with a partial unique index for `active` and `paused` rows.

### `medication_course_events`

An append-only audit timeline:

- `course_id`, `user_id`
- `event_type`: `started | paused | resumed | stopped | completed | end_confirmed`
- `effective_at`
- `reason`
- `confirmed_by`: `self | doctor | pharmacist | caregiver`
- `source`: `web | ios | line | system`
- `created_at`

Current course status is stored for fast reads. Events remain the historical
record and are never replaced when status changes.

### Scheduling and dose logs

`medication_schedules` gains `course_id`. The existing `start_date` and
`end_date` are migrated into the course and retained during compatibility only.
A schedule contains one or more explicit dose slots. Each slot has a stable ID,
time, label such as morning/evening/bedtime, dose quantity, meal relation, and
reminder configuration.

`medication_logs` gains `course_id` and a stable slot reference. One planned
occurrence per slot/date is represented by `scheduled_at`; its status is
`pending | taken | late | skipped | missed`. Logging is idempotent for the same
course, slot, and planned occurrence.

No pending occurrences are created during a pause. Paused dates are excluded
from adherence denominators and are not shown as missed.

### Provider, label, and inventory fields

The previously approved medication expansion is folded into this model:

- `medical_providers`: reusable hospital/clinic/pharmacy list; HN belongs to a
  user's relationship with a hospital.
- provider, doctor, and doctor instructions belong to a course.
- LOT and LOC belong to inventory/pack data.
- pack size and already-consumed input calculate starting remaining quantity.
- profile date of birth remains user-level and is not duplicated per course.
- bedtime is a dose-slot label backed by a real reminder time.

## Lifecycle rules

### Start

Starting a course requires a start date, at least one dose slot, and explicit
confirmation. Future starts are visible as **กำลังจะเริ่ม** and do not notify
before the start date.

### Pause and resume

Pausing records effective time, reason, and confirmer. Future notifications and
pending occurrences in the pause window are cancelled. Resuming records a new
event and regenerates only future occurrences. Past history is untouched.

An optional resume date may be scheduled. On that date Slippy asks for
confirmation; it does not automatically restart the medication.

### Permanent stop

Stopping records `actual_end_at`, reason, and confirmer, cancels future
notifications/occurrences, and preserves the course, inventory, and dose logs.
Restarting the same drug later creates a new course.

### Planned completion

At `planned_end_date`, the course becomes visually due for review. The user can
confirm completion, extend the planned end date, or continue without an end
date. Only confirmation moves it to `completed`.

## Slippy guidance boundary

The insight card is compact and always states its source. It may:

- condense label or clinician instructions into short actionable text;
- show the verbatim source on expansion;
- flag inconsistent entered time, meal relation, or quantity;
- remind the user to verify ambiguous OCR;
- suggest contacting a doctor or pharmacist when information conflicts.

It may not recommend changing dose, starting, pausing, resuming, or stopping.
Lifecycle actions require explicit confirmation. Guidance is labelled as a
summary, not medical advice.

## User experience

### Today tab — default

The header shows completed rounds and total doses, not merely medication count.
The timeline groups occurrences by time/period:

- completed: green, compact, actual confirmation time visible;
- due/unconfirmed: orange with primary **ทานยาแล้ว** and secondary **ข้ามรอบ**;
- upcoming: neutral blue/gray;
- paused: omitted from the active timeline, with one compact pause banner.

Multiple medications due at the same time remain inside one time block so users
can confirm each medicine independently. A round is complete only when every
required dose in that block has a terminal status.

### Medications tab

Cards prioritize status, next dose, remaining stock, and date range. Filters are
`กำลังใช้`, `พักยา`, and `ประวัติ`. Opening a card shows:

- current course and schedule;
- start/planned-end dates;
- source, doctor/provider, and original instructions;
- inventory/LOT/LOC;
- lifecycle history;
- pause/resume/stop actions appropriate to current status.

### Add/scan review

The scanner proposes structured fields and preserves the verbatim label text.
Nothing is saved until review. The form separates drug identity, course,
schedule, provider/instructions, and inventory into short sections. OCR-derived
fields carry a visible **สแกนจากฉลาก** marker.

### Responsive parity

Web and iOS use the same information hierarchy and status language. Layout may
adapt to each platform, but both surfaces read and write the same course, slot,
event, and log contracts.

## Data flow and consistency

All lifecycle transitions run through one transactional database function:

1. verify ownership and expected current status;
2. update course status/end fields;
3. append the lifecycle event;
4. cancel or create future planned occurrences as needed;
5. return the updated course summary.

Web routes call this function through the authenticated server client. Native
iOS uses authenticated Supabase RPC, then resynchronizes local notifications.
The operation accepts an idempotency key to prevent duplicate events from retry
or double tap.

## Migration and compatibility

1. Add course/event/slot structures and nullable compatibility foreign keys.
2. Backfill one course per active medication using schedule start/end dates.
3. Backfill historical logs to the matching course where deterministic; retain
   unmatched logs with medication identity and mark them for compatibility.
4. Deploy readers that prefer courses but can display legacy rows.
5. Deploy writers that create course-based records on Web and iOS.
6. Validate counts and adherence totals before removing legacy writes in a later
   migration. No destructive column removal belongs in this rollout.

The existing `is_active = false` behavior remains archival, not a substitute for
course completion or permanent stop.

## Error handling

- A stale transition returns a conflict and reloads the latest course state.
- Partial lifecycle writes are impossible because status/event/scheduling run in
  one database transaction.
- Failed local-notification synchronization does not roll back server state; the
  UI shows a notification warning and offers retry.
- Ambiguous scan values remain editable and never trigger lifecycle actions.
- Invalid dates and overlapping active courses are rejected with Thai messages.

## Verification

### Database

- migration applies to an existing dataset and is reversible without deleting
  legacy columns;
- RLS prevents cross-user course/event access;
- transition RPC tests cover every valid and invalid state transition;
- backfill preserves medication and log counts.

### Web

- unit tests cover round grouping, completion totals, pause exclusions, and
  lifecycle reducers;
- route tests cover authentication, ownership, idempotency, and conflicts;
- production build succeeds;
- responsive browser walkthrough covers Today and Medications tabs.

### Native iOS

- models decode the shared contract;
- full iOS + Watch simulator build succeeds with an isolated DerivedData path;
- simulator walkthrough covers start, pause, resume, stop, planned completion,
  and per-dose confirmation;
- local notifications are added/removed for the correct future slots.

### Cross-surface

Create on Web, pause on iOS, resume on Web, and verify that both surfaces show
the same status, events, future timeline, and unchanged past dose history.

## Out of scope

- diagnosis, interaction checking, or dose adjustment;
- automatic start/resume/stop without confirmation;
- caregiver authorization workflows;
- destructive removal of legacy medication history;
- Watch-specific lifecycle editing (Watch may continue showing/confirming doses).
