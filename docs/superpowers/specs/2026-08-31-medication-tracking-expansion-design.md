# Medication Tracking Expansion — Design

**Status:** Approved by user 2026-08-31 (data model and all five design sections confirmed via clarifying questions and section-by-section review — see Decisions Confirmed below). Ready for `writing-plans`.

## Problem

The user wants the existing medication feature (`ios/Slippy/Views/Health/AddMedicationView.swift`, `medications`/`medication_schedules`/`medication_inventory` tables, migration `031_medication_tracking.sql`) extended with fields it doesn't currently capture, stated as a list of ten requirements:

1. Some medications are "before bed" — no need to specify an exact clock time.
2. Track LOC (a location/reference code printed on the medication label — confirmed with user, not a storage location) and LOT (batch number).
3. Store HN (hospital patient number).
4. Store the doctor's name.
5. Store the doctor's specific instructions/prescription details.
6. Store DOB (date of birth).
7. Store which hospital/pharmacy the medication was purchased from.
8. Store the quantity printed on the pack.
9. Let the user manually enter how many doses have already been taken, and calculate the remainder.
10. Keep "medication details" separate from free-form "notes".

## Existing infrastructure discovered (reused, not rebuilt)

Confirmed by reading the current model, view, and migration directly before designing anything:

| Piece | Where | Status |
|---|---|---|
| `medications.prescribed_by` | `031_medication_tracking.sql:21` | **Column already exists in the database** — never read/written by `Medication` (`ios/Slippy/Models/HealthModels.swift`) or `AddMedicationView`. Requirement 4 is mostly a wiring gap, not new schema. |
| `medication_inventory.qty_per_pack` | `031_medication_tracking.sql:72` | **Column already exists** — same gap. Requirement 8 is wiring, not new schema. |
| `ScannedMedication.lotNo` / `.hospitalName` / `.prescribingDoctor` / `.instructionsVerbatim` | `ios/Slippy/Models/HealthModels.swift:153-189` | The label-photo AI scanner **already extracts all four of these** from a real prescription label. Today they're shown read-only in `AddMedicationView`'s scan banner (`scanInfoBanner`, lines 400-432) and then **discarded** — never passed to `save()`. Requirements 2 (LOT half), 3-related doctor data, and 5 already have a working extraction pipeline; this work is about persisting what's already being read. |
| `medication_logs` | `031_medication_tracking.sql:88+` | Already tracks per-dose taken/missed/skipped events. Not reused here — see Decision 5 on why the "already taken" input stays a one-time calculator rather than hooking into this table. |
| `users` table | `001_core_schema.sql:35-41` | Minimal: `id, email, full_name, avatar_url, created_at`. No birth-date field — confirmed by reading the table definition directly, not assumed. |
| `AuthViewModel.updateProfile(fullName:)` | `ios/Slippy/ViewModels/AuthViewModel.swift:526-533` | The exact pattern to mirror for writing a new profile field: a small `Encodable` `Patch` struct + `.update(...)` against `users`. |

## Decisions Confirmed (with user, 2026-08-31)

1. **LOC clarified:** a code printed on the medication label itself (like LOT), not a home storage location. Both are simple per-pack text fields.
2. **DOB scope:** the user's own, stored once on their profile (`users` table) — not per-medication, not per-dependent. (Considered and rejected: per-medication DOB — the user explicitly said profile-level, once.)
3. **Bedtime medications still get a real reminder:** "ก่อนนอน" is a *display* simplification, not a scheduling change — the schedule still stores and fires on a real `HH:mm`, the UI just labels it "ก่อนนอน" instead of showing the literal time. (Considered and rejected: no reminder at all for bedtime meds — user explicitly wants the notification to still fire.)
4. **Sources must be normalized, not free text:** the user explicitly asked that hospitals/pharmacies be "แยกเป็นรายการ" (broken out into a proper list) so medication history is searchable by source, and that HN — since it's tied to a specific hospital, not the person globally — live with that source relationship rather than as one global field. This upgraded the original flat-field design (Section 1 v1) to a `medical_providers` reference table (Section 1 v2, below), approved after the revision was presented.
5. **"Already taken" is a one-time calculator input, not a running ledger.** `medication_logs` already tracks daily adherence — reusing it to auto-derive remaining stock was considered and explicitly not chosen; the user asked specifically to be able to type in a consumed count and have the remainder computed, which reads as an initialization/correction tool (e.g. adding a medication you already have a partly-used pack of), not a request to change how ongoing depletion is tracked. Kept in scope: the pack-size + already-taken → remaining calculation. Out of scope: hooking `medication_logs` into automatic stock depletion — a bigger, different feature not asked for.
6. **Provider picker is inline, not a separate management screen.** Type-to-filter existing providers or create one on the spot from within `AddMedicationView`, consistent with how this app handles other small reference lists. A full "จัดการโรงพยาบาล/ร้านยา" management screen was considered and deferred — nothing in the request asked for one, and the inline picker already satisfies "pick from a list."
7. **Search/filter-by-source UI is explicitly out of scope for this pass.** The user's ask was that the data be *structured* so history search is possible later; building an actual filter view now was not requested and is deliberately cut (YAGNI) — flagged to the user directly, who did not ask for it to be added back in.

## Design

### 1. Data model (v2, after Decision 4's revision)

New table, `medical_providers` — a personal, reusable list:

```sql
CREATE TABLE medical_providers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'hospital' CHECK (type IN ('hospital','clinic','pharmacy')),
  hn         text,   -- only meaningful when type = 'hospital'; nullable otherwise
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_medical_providers_user ON medical_providers(user_id);
```

`medications` gains:
```sql
ALTER TABLE medications
  ADD COLUMN provider_id         uuid REFERENCES medical_providers(id) ON DELETE SET NULL,
  ADD COLUMN doctor_name         text,
  ADD COLUMN doctor_instructions text;
```
(`prescribed_by` already exists and is a plausible home for doctor name, but it predates this design and its exact prior usage is unconfirmed — `doctor_name` is added fresh rather than repurposing a column whose existing semantics haven't been audited. The writing-plans stage should decide whether to deprecate `prescribed_by` in favor of `doctor_name` or keep both; flagged here rather than silently guessed.)

`medication_inventory` gains:
```sql
ALTER TABLE medication_inventory
  ADD COLUMN loc_code text,
  ADD COLUMN lot_no   text;
```
(`qty_per_pack` already exists — reused as-is for Section 3's pack-size input.)

`medication_schedules` gains:
```sql
ALTER TABLE medication_schedules
  ADD COLUMN is_bedtime bool NOT NULL DEFAULT false;
```

`users` gains:
```sql
ALTER TABLE users ADD COLUMN date_of_birth date;
```

**Why per-medication and not per-provider for doctor name/instructions:** the same hospital can mean a different doctor on a different visit; `provider_id` captures the durable relationship (and HN, which genuinely is fixed per hospital), while doctor name and instructions travel with the specific prescription.

### 2. Details vs. notes

`doctor_instructions` (new, above) holds what the doctor/label specifies — pre-filled from `ScannedMedication.instructionsVerbatim` when reviewing a scan, editable like every other scan-derived field in this app. The existing `notes` column and field are untouched, and keep their current free-form personal-remarks role. Two separate `TextField`s in `AddMedicationView`, replacing today's single combined `notes` field (whose placeholder text currently conflates the two: "เช่น ทานหลังอาหาร, ทาน 1 เม็ด เช้า-เย็น" is dosing-instruction-shaped text sitting in what should be a personal-notes field).

### 3. Pack quantity → calculated remaining

Replaces today's single "จำนวนที่มี" field (`AddMedicationView.swift:214-222`, currently a direct manual entry of `qty_remaining`) with three related pieces in the form:

- **จำนวนต่อกล่อง** (pack size) — binds to `qty_per_pack`, already a column, newly surfaced in UI.
- **ทานไปแล้ว** (already taken) — a new `@State` input, never persisted directly.
- **คงเหลือ** (remaining) — computed live as pack size − already taken, displayed, and *this* value is what's written to `qty_remaining` on save (same column, same write path as today).

Leaving "already taken" at 0 with pack size set to whatever the user is actually starting with reproduces today's exact behavior — this is additive, not a breaking change to the existing flow. On edit, the same three fields reappear; "already taken" starts at 0 each time (it's a delta input, not a stored running value) — editing pack size while leaving "already taken" at 0 lets someone directly restate a known remaining count, same as before.

### 4. Bedtime scheduling

A "ก่อนนอน" toggle alongside each time row in the existing `times` editor (`AddMedicationView.swift:151-183`). Per Decision 3, this does not change how reminders fire — a real `HH:mm` is still stored in `medication_schedules.times` (default suggestion: 22:00, still adjustable via the same `DatePicker` already in that loop) — `is_bedtime` only changes how that slot is *labeled* wherever the app currently shows a time: the picker row itself, `HealthView`'s medication cards, and any notification-adjacent text that currently prints the literal time.

Since `is_bedtime` is one boolean per schedule row (not per time-string within `times`), a medication with multiple times (e.g. one in the morning, one at bedtime) needing only ONE of its times labeled "ก่อนนอน" is a real edge case the current single-schedule-row model doesn't cleanly cover. Given `primarySchedule` (`HealthModels.swift:111`) already treats a medication as having one schedule "at a time" for display purposes, and multi-time bedtime-mixed-with-non-bedtime medications are uncommon, this is accepted as a known simplification rather than a blocking gap — flagged here rather than silently resolved, since it's a real product-shape choice, not an implementation detail.

### 5. Scanner integration & provider picker

`AddMedicationView`'s `init` already has the exact precedent for this (`editing?.x ?? scanned?.x ?? default`, lines 49-65) — the same pattern extends to the four newly-wired fields:
- `scanned?.lotNo` → prefills the new "LOT" field
- `scanned?.prescribingDoctor` → prefills `doctor_name`
- `scanned?.instructionsVerbatim` → prefills `doctor_instructions` (today this string is *shown* read-only in `scanInfoBanner`; it becomes the prefill for an actual editable field instead, a strict improvement over today's read-only-only display)
- `scanned?.hospitalName` → resolves against the user's existing `medical_providers` list by exact name match; a hit pre-selects that provider, a miss pre-fills the inline "add new provider" affordance with the scanned name rather than silently dropping it

The provider picker itself: a searchable, inline list (type to filter `medical_providers` where `user_id = <self>`) with a "+ เพิ่มใหม่" row that creates a new `medical_providers` record (name + type, HN only if type = hospital) without leaving `AddMedicationView`.

## Data flow

```
Add/edit a medication:
  User picks/creates provider (medical_providers row, HN if hospital)
    → types doctor name + instructions (or both prefilled from a scan)
    → types LOC/LOT (or prefilled from a scan's lotNo)
    → sets pack size + already-taken → sees computed remaining
    → optionally marks one or more times "ก่อนนอน"
  Save → medications (provider_id, doctor_name, doctor_instructions)
       + medication_inventory (loc_code, lot_no, qty_per_pack, qty_remaining=computed)
       + medication_schedules (times unchanged, is_bedtime per row)

Profile (once, separate screen):
  User sets date_of_birth → users.date_of_birth
```

## Error handling

- Provider creation failure (network, RLS) surfaces the same way `AddMedicationView.save()` already surfaces errors today — `errorMsg` set from `error.localizedDescription`, shown inline above the Save button. No new error-handling pattern introduced.
- A scan that finds no matching provider and the user declines to create one: `provider_id` stays nil — `medications.provider_id` is nullable, so this degrades to "no source recorded" rather than blocking save, consistent with every other optional field in this form today.
- "Already taken" > "pack size" (a negative computed remaining): clamp displayed/saved remaining to 0 rather than persisting a negative stock figure, and show a lightweight inline hint rather than a blocking error — the same "don't block the user over a plausible input mistake" posture as the rest of this form.

## Testing plan

This project has no XCTest target for iOS (confirmed during the trip-map-google-places plan, still true) — verification is `xcodebuild` succeeding plus simulator walkthroughs, the same discipline used throughout this project's recent work:

1. **Build:** `xcodebuild` for the `Slippy` scheme succeeds with 0 errors after each new file/schema change.
2. **Migration:** apply the new migration against the Supabase project, confirm no conflicts with existing data (all new columns are nullable or have safe defaults — no backfill required).
3. **Simulator, end-to-end:** add a new medication with a provider (create one inline), doctor name/instructions, LOC/LOT, pack size + already-taken, and a bedtime-marked time; confirm the computed remaining is correct and the schedule displays "ก่อนนอน" instead of a clock time. Separately, scan a real medication label photo and confirm the four newly-wired fields (LOT, doctor name, instructions, provider match/prefill) actually populate from the scan instead of being silently dropped, closing the gap this design exists to fix.
4. **Regression check:** confirm a medication added with no provider, no LOC/LOT, and "already taken" left at 0 behaves identically to today's flow — this work is additive, not a breaking change to the existing simple case.

## Open items / setup dependencies

- **`prescribed_by` vs. new `doctor_name`:** flagged in Section 1 — the writing-plans stage should audit `prescribed_by`'s current (if any) usage before deciding whether to deprecate it or keep both columns, rather than this spec silently picking one.
- None blocking otherwise — no external service, API key, or account setup required (unlike the trip-map-google-places work, this is entirely internal to the existing Supabase project and app).
