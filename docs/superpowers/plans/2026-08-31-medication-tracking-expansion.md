# Medication Tracking Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the medication feature with bedtime scheduling, LOC/LOT, a normalized hospital/pharmacy provider list (with HN), doctor name/instructions separated from notes, profile-level DOB, and a pack-size + already-taken calculator for remaining stock — and wire four fields the label scanner already extracts but currently discards.

**Architecture:** One migration adds a `medical_providers` table and four `ALTER TABLE` additions. iOS gets a new `MedicalProvider` model, extended `Medication`/`MedicationInventory`/`MedicationSchedule` models, an inline provider picker, an expanded `AddMedicationView`, a `HealthView` display fix for bedtime schedules, and a DOB field on the existing profile-edit sheet.

**Tech Stack:** Supabase Postgres (migration), Swift/SwiftUI (Xcode build is the verification gate — no XCTest target in this project).

**Spec:** `docs/superpowers/specs/2026-08-31-medication-tracking-expansion-design.md`

## Global Constraints

- No XCTest target for iOS (confirmed: zero `XCTest`/`SlippyTests` references in `Slippy.xcodeproj/project.pbxproj`). Every iOS task's verification is `xcodebuild ... build` succeeding with 0 errors, plus a simulator check for anything UI-visible.
- Thai user-facing strings throughout, matching every existing string in the files this plan touches.
- **Resolved open item from the spec:** `medications.prescribed_by` has zero references anywhere in `ios/`, `web/`, or `api/` (confirmed via repo-wide grep) — it is genuinely dead. Reuse it as the backing column for the new `doctorName` field (via `CodingKeys`) rather than adding a redundant new column. No `doctor_name` column in the migration.
- This is additive work — every new column is nullable with no backfill required, and leaving new fields blank must reproduce today's exact behavior (spec's Decision 5, Section 3).
- This plan's worktree must be separate from the concurrently-executing `trip-map-google-places` plan's worktree (`.worktrees/trip-map-google-places`) — do not read or write anything there.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260831030000_medication_tracking_expansion.sql`

**Interfaces:**
- Consumes: nothing — first task, no dependency.
- Produces: the `medical_providers` table and the new columns every later task reads/writes: `medications.provider_id`, `medications.prescribed_by` (reused, not new), `medications.doctor_instructions`, `medication_inventory.loc_code`, `medication_inventory.lot_no`, `medication_schedules.is_bedtime`, `users.date_of_birth`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260831030000_medication_tracking_expansion.sql
-- Adds: a normalized hospital/pharmacy provider list (with HN), doctor
-- instructions, LOC/LOT per pack, bedtime scheduling, and profile DOB.
-- See docs/superpowers/specs/2026-08-31-medication-tracking-expansion-design.md.

-- ─── Personal provider list ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_providers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'hospital' CHECK (type IN ('hospital','clinic','pharmacy')),
  hn         text,   -- patient number at this specific hospital; meaningless for clinic/pharmacy
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medical_providers_user ON medical_providers(user_id);
ALTER TABLE medical_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_providers_own ON medical_providers
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── Medications: provider link + doctor instructions ──────────────────────
-- prescribed_by already exists (031_medication_tracking.sql) and has zero
-- references anywhere in the app — reused as the doctor-name column rather
-- than adding a duplicate.
ALTER TABLE medications
  ADD COLUMN IF NOT EXISTS provider_id         uuid REFERENCES medical_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS doctor_instructions  text;

-- ─── Inventory: per-pack codes ──────────────────────────────────────────────
ALTER TABLE medication_inventory
  ADD COLUMN IF NOT EXISTS loc_code text,
  ADD COLUMN IF NOT EXISTS lot_no   text;

-- ─── Schedules: bedtime display flag ────────────────────────────────────────
ALTER TABLE medication_schedules
  ADD COLUMN IF NOT EXISTS is_bedtime bool NOT NULL DEFAULT false;

-- ─── Profile: date of birth ──────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth date;
```

- [ ] **Step 2: Apply the migration**

Run: `cd supabase && npx supabase db push` (or the project's established migration-apply command — check `supabase/README.md` or `package.json` in `supabase/` if `db push` isn't it; this repo uses a hosted Supabase project, confirmed by `NEXT_PUBLIC_GOOGLE_MAPS_KEY`-style env-based config elsewhere, not a local `supabase start` stack)

If direct CLI push isn't available in this environment, apply via the Supabase MCP tool's `apply_migration` (project id: confirm via `mcp__supabase__list_projects` or reuse the project id already used elsewhere in this session/repo's `.env` files — do NOT guess a different project).

Expected: no errors. `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` make this safe to re-run if partially applied.

- [ ] **Step 3: Verify the schema**

Run a read-only check against the live database (via the Supabase MCP `execute_sql` tool or `psql`):
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'medications' AND column_name IN ('provider_id', 'doctor_instructions');
SELECT column_name FROM information_schema.columns WHERE table_name = 'medication_inventory' AND column_name IN ('loc_code', 'lot_no');
SELECT column_name FROM information_schema.columns WHERE table_name = 'medication_schedules' AND column_name = 'is_bedtime';
SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'date_of_birth';
SELECT table_name FROM information_schema.tables WHERE table_name = 'medical_providers';
```
Expected: every query returns exactly the row(s) named.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831030000_medication_tracking_expansion.sql
git commit -m "Add medical_providers table and medication tracking expansion columns"
```

---

## Task 2: iOS models

**Files:**
- Modify: `ios/Slippy/Models/HealthModels.swift`
- Modify: `ios/Slippy/Models/UserProfile.swift`

**Interfaces:**
- Consumes: the columns from Task 1 (must be applied first — a `Codable` struct with a field mapped to a column that doesn't exist yet will simply decode that field as `nil`/fail depending on optionality, so functionally safe to write before Task 1 lands, but end-to-end testing needs Task 1 done).
- Produces: `MedicalProvider` (new struct), `Medication.providerId: String?`, `Medication.doctorName: String?`, `Medication.doctorInstructions: String?`, `Medication.provider: MedicalProvider?` (embedded), `MedicationInventory.locCode: String?`, `MedicationInventory.lotNo: String?`, `MedicationInventory.qtyPerPack: Double?`, `MedicationSchedule.isBedtime: Bool`, `UserProfile.dateOfBirth: String?` — every later task in this plan reads these exact names.

- [ ] **Step 1: Add `MedicalProvider` and extend `Medication`/`MedicationInventory`/`MedicationSchedule`**

In `ios/Slippy/Models/HealthModels.swift`, add this new struct right before `struct Medication`:

```swift
/// A hospital, clinic, or pharmacy the user has medications from — a
/// personal, reusable list so "which hospital was this from" is a pick,
/// not retyped free text, and medication history can be filtered by source.
struct MedicalProvider: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let name: String
    let type: String          // hospital | clinic | pharmacy
    /// Patient number AT THIS hospital — meaningless (and typically nil) for
    /// a clinic or pharmacy, since HN is tied to the specific hospital, not
    /// the person globally.
    let hn: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, type, hn
        case userId = "user_id"
        case createdAt = "created_at"
    }

    var typeLabel: String {
        switch type {
        case "hospital": return "🏥 โรงพยาบาล"
        case "clinic":   return "🩺 คลินิก"
        case "pharmacy": return "💊 ร้านยา"
        default:         return type
        }
    }
}
```

In `struct MedicationSchedule`, add the new field and coding key:

```swift
struct MedicationSchedule: Codable {
    let id: String
    let times: [String]           // "08:00", "14:00", ...
    let doseQty: Double
    let mealRelation: String      // before | after | with | any
    let mealNote: String?
    let reminderEnabled: Bool
    /// Display-only — a real HH:mm is still stored in `times` and still
    /// drives the actual reminder. This just means "show 'ก่อนนอน' instead
    /// of the literal time" wherever a schedule's time is displayed.
    let isBedtime: Bool

    enum CodingKeys: String, CodingKey {
        case id, times
        case doseQty = "dose_qty"
        case mealRelation = "meal_relation"
        case mealNote = "meal_note"
        case reminderEnabled = "reminder_enabled"
        case isBedtime = "is_bedtime"
    }
}
```

In `struct MedicationInventory`, add the new fields:

```swift
struct MedicationInventory: Codable {
    let id: String
    let qtyRemaining: Double
    let qtyUnit: String
    let qtyPerPack: Double?
    let lowStockAlert: Double
    let expiryDate: String?
    let locCode: String?
    let lotNo: String?

    enum CodingKeys: String, CodingKey {
        case id
        case qtyRemaining = "qty_remaining"
        case qtyUnit = "qty_unit"
        case qtyPerPack = "qty_per_pack"
        case lowStockAlert = "low_stock_alert"
        case expiryDate = "expiry_date"
        case locCode = "loc_code"
        case lotNo = "lot_no"
    }

    func daysRemaining(schedule: MedicationSchedule?) -> Int? {
        guard let schedule, !schedule.times.isEmpty else { return nil }
        let perDay = schedule.doseQty * Double(schedule.times.count)
        guard perDay > 0 else { return nil }
        return Int(qtyRemaining / perDay)
    }
}
```

In `struct Medication`, add the new fields, the embedded provider, and coding keys:

```swift
struct Medication: Codable, Identifiable {
    let id: String
    let userId: String
    let name: String
    let brandName: String?
    let genericName: String?
    let dosageForm: String
    let strength: String?
    let purpose: String?
    let color: String?
    let notes: String?
    let isActive: Bool
    let createdAt: String
    let schedules: [MedicationSchedule]
    let inventoryRows: [MedicationInventory]
    /// The hospital/clinic/pharmacy this came from, embedded via
    /// `provider_id`'s FK — PostgREST returns a to-one embed as an object,
    /// not an array, because there IS a real to-one relationship here
    /// (medications.provider_id -> medical_providers.id), unlike the
    /// schedules/inventory to-many embeds above.
    let provider: MedicalProvider?
    /// Reuses the existing (previously unused) `prescribed_by` column.
    let doctorName: String?
    let doctorInstructions: String?

    enum CodingKeys: String, CodingKey {
        case id, name, notes, purpose, color, strength, provider
        case userId = "user_id"
        case brandName = "brand_name"
        case genericName = "generic_name"
        case dosageForm = "dosage_form"
        case isActive = "is_active"
        case createdAt = "created_at"
        case schedules = "medication_schedules"
        case inventoryRows = "medication_inventory"
        case doctorName = "prescribed_by"
        case doctorInstructions = "doctor_instructions"
    }

    var inventory: MedicationInventory? { inventoryRows.first }

    var dosageFormLabel: String {
        switch dosageForm {
        case "tablet":    return "💊 เม็ด"
        case "capsule":   return "💊 แคปซูล"
        case "liquid":    return "🧴 น้ำ"
        case "inhaler":   return "💨 พ่น"
        case "injection": return "💉 ฉีด"
        case "patch":     return "🩹 แผ่นแปะ"
        case "cream":     return "🧴 ครีม"
        default:          return "💊 อื่นๆ"
        }
    }

    var primarySchedule: MedicationSchedule? { schedules.first }
}
```

(`provider` uses the embed key name `provider` in `CodingKeys` but the actual PostgREST embed key must match the FK-based embed name Supabase generates — this is confirmed/adjusted in Task 3's Step 4 when the real query response is checked; if PostgREST names it `medical_providers` instead of `provider`, add `case provider = "medical_providers"` there instead of bare `case provider`.)

- [ ] **Step 2: Add DOB to `UserProfile`**

In `ios/Slippy/Models/UserProfile.swift`:

```swift
struct UserProfile: Codable, Identifiable {
    let id: String
    let email: String
    let fullName: String?
    let avatarUrl: String?
    let dateOfBirth: String?

    enum CodingKeys: String, CodingKey {
        case id, email
        case fullName  = "full_name"
        case avatarUrl = "avatar_url"
        case dateOfBirth = "date_of_birth"
    }
```
(keep the rest of the file — `displayName`, `initials`, etc. — unchanged.)

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`

(If this simulator id no longer exists on the machine running this task, list available ones first: `xcrun simctl list devices | grep "iPhone 16 Pro"` and substitute — this id has already changed once during this project's work.)

Expected: `** BUILD SUCCEEDED **`. `Medication`/`MedicationInventory`/`MedicationSchedule`/`UserProfile` gain fields that nothing constructs yet (only `Codable` decode paths use them) — this should compile cleanly since all new fields are optional or have a decodable default, and no other code constructs these structs by memberwise initializer directly (confirmed: every construction site in this codebase goes through Supabase's `.execute().value` decode, not `Medication(id:...)`).

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/Models/HealthModels.swift ios/Slippy/Models/UserProfile.swift
git commit -m "Add MedicalProvider model, extend Medication/Inventory/Schedule/UserProfile"
```

---

## Task 3: `HealthViewModel` — provider CRUD, extended add/update, select fix

**Files:**
- Modify: `ios/Slippy/ViewModels/HealthViewModel.swift`

**Interfaces:**
- Consumes: `MedicalProvider`, extended `Medication`/`MedicationInventory`/`MedicationSchedule` (Task 2).
- Produces: `HealthViewModel.providers: [MedicalProvider]` (`@Published`), `HealthViewModel.loadProviders(userId:) async`, `HealthViewModel.addProvider(userId:name:type:hn:) async throws -> MedicalProvider`, extended `addMedication(...)`/`updateMedication(...)` signatures (new params: `providerId: String?`, `doctorName: String?`, `doctorInstructions: String?`, `locCode: String?`, `lotNo: String?`, `qtyPerPack: Double?`, `isBedtime: Bool`) — Task 6 (`AddMedicationView`) calls these exact signatures.

- [ ] **Step 1: Fix `loadMedications`'s select to embed the provider**

```swift
            let rows: [Medication] = try await db
                .from("medications")
                .select("*, medication_schedules(*), medication_inventory(*)")
                .eq("user_id", value: userId)
```
→
```swift
            let rows: [Medication] = try await db
                .from("medications")
                .select("*, medication_schedules(*), medication_inventory(*), provider:medical_providers(*)")
                .eq("user_id", value: userId)
```
(the `provider:` alias in the PostgREST select string makes the embed key come back as `"provider"` in the JSON, matching `Medication.CodingKeys`'s `case provider` from Task 2 exactly — no ambiguity to resolve at Step 4 of Task 2 after all, since aliasing the select controls the key name directly rather than relying on PostgREST's default table-name-based key.)

- [ ] **Step 2: Add provider load/create methods**

Add near the top of the class, after `@Published var notificationsAuthorized`:
```swift
    @Published var providers: [MedicalProvider] = []
```

Add new methods, near `loadMedications`:
```swift
    func loadProviders(userId: String) async {
        do {
            let rows: [MedicalProvider] = try await db
                .from("medical_providers")
                .select()
                .eq("user_id", value: userId)
                .order("name", ascending: true)
                .execute()
                .value
            providers = rows
        } catch {
            self.error = error.localizedDescription
        }
    }

    func addProvider(userId: String, name: String, type: String, hn: String?) async throws -> MedicalProvider {
        struct Insert: Encodable {
            let user_id: String
            let name: String
            let type: String
            let hn: String?
        }
        let created: MedicalProvider = try await db
            .from("medical_providers")
            .insert(Insert(user_id: userId, name: name, type: type, hn: hn?.isEmpty == true ? nil : hn))
            .select()
            .single()
            .execute()
            .value
        providers.append(created)
        providers.sort { $0.name < $1.name }
        return created
    }
```

Call `loadProviders` alongside the existing parallel loads in `load(userId:)`:
```swift
    func load(userId: String) async {
        isLoading = true
        defer { isLoading = false }
        async let medsTask: Void = loadMedications(userId: userId)
        async let logsTask: Void = loadTodayLogs(userId: userId)
        async let providersTask: Void = loadProviders(userId: userId)
        _ = await (medsTask, logsTask, providersTask)
        await refreshNotificationAuthorization()
        syncReminderNotifications()
    }
```

- [ ] **Step 3: Extend `addMedication`**

```swift
    func addMedication(
        userId: String, name: String, brandName: String?, dosageForm: String, notes: String?,
        strength: String? = nil, purpose: String? = nil,
        providerId: String? = nil, doctorName: String? = nil, doctorInstructions: String? = nil,
        times: [String], doseQty: Double, mealRelation: String, reminderEnabled: Bool, isBedtime: Bool = false,
        qtyTotal: Double, qtyUnit: String, qtyPerPack: Double? = nil, lowStockAlert: Double, expiryDate: String? = nil,
        locCode: String? = nil, lotNo: String? = nil
    ) async throws {
        struct MedInsert: Encodable {
            let user_id: String
            let name: String
            let brand_name: String?
            let dosage_form: String
            let strength: String?
            let purpose: String?
            let notes: String?
            let provider_id: String?
            let prescribed_by: String?
            let doctor_instructions: String?
        }
        struct MedRow: Decodable { let id: String }
        struct ScheduleInsert: Encodable {
            let medication_id: String
            let user_id: String
            let times: [String]
            let dose_qty: Double
            let meal_relation: String
            let reminder_enabled: Bool
            let is_active: Bool
            let is_bedtime: Bool
        }
        struct InventoryInsert: Encodable {
            let medication_id: String
            let user_id: String
            let qty_remaining: Double
            let qty_unit: String
            let qty_per_pack: Double?
            let low_stock_alert: Double
            let expiry_date: String?
            let last_purchased_at: String
            let last_purchased_qty: Double
            let loc_code: String?
            let lot_no: String?
        }

        let med: MedRow = try await db
            .from("medications")
            .insert(MedInsert(
                user_id: userId, name: name,
                brand_name: brandName?.isEmpty == true ? nil : brandName,
                dosage_form: dosageForm,
                strength: strength?.isEmpty == true ? nil : strength,
                purpose: purpose?.isEmpty == true ? nil : purpose,
                notes: notes?.isEmpty == true ? nil : notes,
                provider_id: providerId,
                prescribed_by: doctorName?.isEmpty == true ? nil : doctorName,
                doctor_instructions: doctorInstructions?.isEmpty == true ? nil : doctorInstructions
            ))
            .select("id")
            .single()
            .execute()
            .value

        if !times.isEmpty {
            try await db.from("medication_schedules").insert(ScheduleInsert(
                medication_id: med.id, user_id: userId, times: times, dose_qty: doseQty,
                meal_relation: mealRelation, reminder_enabled: reminderEnabled, is_active: true,
                is_bedtime: isBedtime
            )).execute()
        }
        if qtyTotal > 0 {
            try await db.from("medication_inventory").insert(InventoryInsert(
                medication_id: med.id, user_id: userId, qty_remaining: qtyTotal, qty_unit: qtyUnit,
                qty_per_pack: qtyPerPack,
                low_stock_alert: lowStockAlert, expiry_date: expiryDate?.isEmpty == true ? nil : expiryDate,
                last_purchased_at: todayDateOnlyString(), last_purchased_qty: qtyTotal,
                loc_code: locCode?.isEmpty == true ? nil : locCode,
                lot_no: lotNo?.isEmpty == true ? nil : lotNo
            )).execute()
        }

        await load(userId: userId)
    }
```

- [ ] **Step 4: Extend `updateMedication`**

```swift
    func updateMedication(
        id: String, scheduleId: String?, inventoryId: String?,
        name: String, brandName: String?, dosageForm: String, notes: String?,
        strength: String?, purpose: String?,
        providerId: String? = nil, doctorName: String? = nil, doctorInstructions: String? = nil,
        times: [String], doseQty: Double, mealRelation: String, reminderEnabled: Bool, isBedtime: Bool = false,
        qtyRemaining: Double, qtyUnit: String, qtyPerPack: Double? = nil, lowStockAlert: Double, expiryDate: String?,
        locCode: String? = nil, lotNo: String? = nil
    ) async throws {
        struct MedPatch: Encodable {
            let name: String
            let brand_name: String?
            let dosage_form: String
            let strength: String?
            let purpose: String?
            let notes: String?
            let provider_id: String?
            let prescribed_by: String?
            let doctor_instructions: String?
        }
        struct ScheduleInsert: Encodable {
            let medication_id: String
            let user_id: String
            let times: [String]
            let dose_qty: Double
            let meal_relation: String
            let reminder_enabled: Bool
            let is_active: Bool
            let is_bedtime: Bool
        }
        struct SchedulePatch: Encodable {
            let times: [String]
            let dose_qty: Double
            let meal_relation: String
            let reminder_enabled: Bool
            let is_bedtime: Bool
        }
        struct InventoryInsert: Encodable {
            let medication_id: String
            let user_id: String
            let qty_remaining: Double
            let qty_unit: String
            let qty_per_pack: Double?
            let low_stock_alert: Double
            let expiry_date: String?
            let last_purchased_at: String
            let last_purchased_qty: Double
            let loc_code: String?
            let lot_no: String?
        }
        struct InventoryPatch: Encodable {
            let qty_remaining: Double
            let qty_unit: String
            let qty_per_pack: Double?
            let low_stock_alert: Double
            let expiry_date: String?
            let loc_code: String?
            let lot_no: String?
        }
        let userId = try await db.auth.session.user.id.uuidString

        try await db.from("medications").update(MedPatch(
            name: name,
            brand_name: brandName?.isEmpty == true ? nil : brandName,
            dosage_form: dosageForm,
            strength: strength?.isEmpty == true ? nil : strength,
            purpose: purpose?.isEmpty == true ? nil : purpose,
            notes: notes?.isEmpty == true ? nil : notes,
            provider_id: providerId,
            prescribed_by: doctorName?.isEmpty == true ? nil : doctorName,
            doctor_instructions: doctorInstructions?.isEmpty == true ? nil : doctorInstructions
        )).eq("id", value: id).execute()

        if let scheduleId {
            try await db.from("medication_schedules").update(SchedulePatch(
                times: times, dose_qty: doseQty, meal_relation: mealRelation, reminder_enabled: reminderEnabled,
                is_bedtime: isBedtime
            )).eq("id", value: scheduleId).execute()
        } else if !times.isEmpty {
            try await db.from("medication_schedules").insert(ScheduleInsert(
                medication_id: id, user_id: userId, times: times, dose_qty: doseQty,
                meal_relation: mealRelation, reminder_enabled: reminderEnabled, is_active: true,
                is_bedtime: isBedtime
            )).execute()
        }

        if let inventoryId {
            try await db.from("medication_inventory").update(InventoryPatch(
                qty_remaining: qtyRemaining, qty_unit: qtyUnit, qty_per_pack: qtyPerPack, low_stock_alert: lowStockAlert,
                expiry_date: expiryDate?.isEmpty == true ? nil : expiryDate,
                loc_code: locCode?.isEmpty == true ? nil : locCode,
                lot_no: lotNo?.isEmpty == true ? nil : lotNo
            )).eq("id", value: inventoryId).execute()
        } else if qtyRemaining > 0 {
            try await db.from("medication_inventory").insert(InventoryInsert(
                medication_id: id, user_id: userId, qty_remaining: qtyRemaining, qty_unit: qtyUnit,
                qty_per_pack: qtyPerPack,
                low_stock_alert: lowStockAlert, expiry_date: expiryDate?.isEmpty == true ? nil : expiryDate,
                last_purchased_at: todayDateOnlyString(), last_purchased_qty: qtyRemaining,
                loc_code: locCode?.isEmpty == true ? nil : locCode,
                lot_no: lotNo?.isEmpty == true ? nil : lotNo
            )).execute()
        }

        await load(userId: userId)
    }
```

- [ ] **Step 5: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`. `AddMedicationView.save()` still calls the OLD (pre-expansion) parameter lists at this point in the plan — this compiles because every new parameter has a default value (`= nil` / `= false`), so existing call sites remain valid untouched. Task 6 updates those call sites to actually pass the new values.

- [ ] **Step 6: Commit**

```bash
git add ios/Slippy/ViewModels/HealthViewModel.swift
git commit -m "Add provider CRUD, extend addMedication/updateMedication with new fields"
```

---

## Task 4: `AuthViewModel` — update date of birth

**Files:**
- Modify: `ios/Slippy/ViewModels/AuthViewModel.swift`

**Interfaces:**
- Consumes: `UserProfile.dateOfBirth` (Task 2).
- Produces: `AuthViewModel.updateDateOfBirth(_:) async -> Bool` — Task 8 (`ProfileView`) calls this.

- [ ] **Step 1: Add the method**

Right after `updateProfile(fullName:)` in `ios/Slippy/ViewModels/AuthViewModel.swift`:

```swift
    /// Same table/pattern as updateProfile(fullName:) — see that function's
    /// comment for why this writes straight to `users`.
    func updateDateOfBirth(_ isoDate: String?) async -> Bool {
        guard let userId = session?.user.id.uuidString else { return false }
        do {
            struct Patch: Encodable { let date_of_birth: String? }
            let updated: UserProfile = try await db
                .from("users")
                .update(Patch(date_of_birth: isoDate))
                .eq("id", value: userId)
                .select()
                .single()
                .execute()
                .value
            profile = updated
            hapticSuccess()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
```

- [ ] **Step 2: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/ViewModels/AuthViewModel.swift
git commit -m "Add updateDateOfBirth to AuthViewModel"
```

---

## Task 5: `ProviderPickerView.swift` — inline searchable picker

**Files:**
- Create: `ios/Slippy/Views/Health/ProviderPickerView.swift`

**Interfaces:**
- Consumes: `MedicalProvider` (Task 2), `HealthViewModel.providers`/`addProvider` (Task 3).
- Produces: `ProviderPickerView(vm:userId:selected:)` — a `View` taking `selected` as a `Binding<MedicalProvider?>` (set directly on tap, not via a callback), that Task 6 embeds in `AddMedicationView`.

- [ ] **Step 1: Write the view**

```swift
// ios/Slippy/Views/Health/ProviderPickerView.swift
import SwiftUI

private let healthGreen = Color(hex: "#10b981")

/// Type-to-filter an existing hospital/clinic/pharmacy, or add a new one on
/// the spot — inline rather than a separate management screen, since the
/// only thing this needs to do is "pick from a list, or grow the list".
struct ProviderPickerView: View {
    @ObservedObject var vm: HealthViewModel
    let userId: String
    @Binding var selected: MedicalProvider?
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var showingNew = false
    @State private var newName = ""
    @State private var newType = "hospital"
    @State private var newHN = ""
    @State private var isSaving = false

    private var filtered: [MedicalProvider] {
        query.isEmpty ? vm.providers : vm.providers.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("ค้นหาโรงพยาบาล/ร้านยา", text: $query)
                }
                Section {
                    Button {
                        selected = nil
                        dismiss()
                    } label: {
                        Text("ไม่ระบุ").foregroundColor(.textSecondary)
                    }
                    ForEach(filtered) { provider in
                        Button {
                            selected = provider
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(provider.name)
                                        .foregroundColor(.textPrimary)
                                    Text(provider.typeLabel)
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                }
                                Spacer()
                                if selected?.id == provider.id {
                                    Image(systemName: "checkmark").foregroundColor(healthGreen)
                                }
                            }
                        }
                    }
                }
                Section {
                    if showingNew {
                        TextField("ชื่อโรงพยาบาล/ร้านยา", text: $newName)
                        Picker("ประเภท", selection: $newType) {
                            Text("🏥 โรงพยาบาล").tag("hospital")
                            Text("🩺 คลินิก").tag("clinic")
                            Text("💊 ร้านยา").tag("pharmacy")
                        }
                        if newType == "hospital" {
                            TextField("HN", text: $newHN)
                        }
                        Button {
                            Task { await createProvider() }
                        } label: {
                            if isSaving { ProgressView() } else { Text("บันทึก").bold() }
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                    } else {
                        Button {
                            newName = query
                            showingNew = true
                        } label: {
                            Label("เพิ่มใหม่", systemImage: "plus.circle").foregroundColor(healthGreen)
                        }
                    }
                }
            }
            .navigationTitle("เลือกโรงพยาบาล/ร้านยา")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
        }
    }

    private func createProvider() async {
        isSaving = true
        defer { isSaving = false }
        guard let created = try? await vm.addProvider(
            userId: userId, name: newName.trimmingCharacters(in: .whitespaces),
            type: newType, hn: newType == "hospital" ? newHN : nil
        ) else { return }
        selected = created
        dismiss()
    }
}
```

- [ ] **Step 2: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **` (this view isn't presented from anywhere yet — Task 6 wires it in — so this just confirms it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Views/Health/ProviderPickerView.swift
git commit -m "Add ProviderPickerView: inline searchable hospital/pharmacy picker"
```

---

## Task 6: `AddMedicationView` expansion

**Files:**
- Modify: `ios/Slippy/Views/Health/AddMedicationView.swift`

**Interfaces:**
- Consumes: `MedicalProvider`, `ProviderPickerView` (Task 5), extended `HealthViewModel.addMedication`/`updateMedication` (Task 3), extended `Medication`/`ScannedMedication` fields (Task 2 — note `ScannedMedication` itself is unchanged, already has `lotNo`/`hospitalName`/`prescribingDoctor`/`instructionsVerbatim` from before this plan).
- Produces: nothing further downstream — this is the terminal write path for the add/edit flow.

- [ ] **Step 1: Add new `@State`, extend `init`**

Add these new `@State` properties alongside the existing ones (after `@State private var notes = ""`):

```swift
    @State private var selectedProvider: MedicalProvider?
    @State private var doctorName: String
    @State private var doctorInstructions: String
    @State private var locCode: String
    @State private var lotNo: String
    @State private var qtyPerPack: String
    @State private var alreadyTaken = ""
    @State private var showProviderPicker = false
```

Extend `init` — after the existing `_notes = State(initialValue: editing?.notes ?? "")` line, add:

```swift
        _doctorName         = State(initialValue: editing?.doctorName ?? scanned?.prescribingDoctor ?? "")
        _doctorInstructions = State(initialValue: editing?.doctorInstructions ?? scanned?.instructionsVerbatim ?? "")
        _locCode            = State(initialValue: inv?.locCode ?? "")
        _lotNo              = State(initialValue: inv?.lotNo ?? scanned?.lotNo ?? "")
        _qtyPerPack         = State(initialValue: (inv?.qtyPerPack ?? scanned?.qtyTotal).map { String(Int($0)) } ?? "")
```

(`selectedProvider` starts `nil` — for `editing`, it's set in `.task` at view-appear time since it needs an async provider-list lookup by `editing?.provider`, added in Step 4 below. For a fresh scan, provider auto-match by `scanned?.hospitalName` also happens in that same `.task`, not in `init`, for the same reason — `init` cannot run async code.)

- [ ] **Step 2: Replace the "จำนวนที่มี" section with the pack-size/already-taken calculator**

```swift
                    // Inventory
                    HStack(spacing: 12) {
                        fieldSection(title: "จำนวนที่มี") {
                            TextField("30", text: $qtyTotal)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "แจ้งเตือนเมื่อเหลือ") {
                            TextField("7", text: $lowStockAlert)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }
```
→
```swift
                    // Inventory — pack size and already-taken calculate the
                    // remaining count; leaving "ทานไปแล้ว" at 0 with
                    // "จำนวนต่อกล่อง" set to what's actually on hand
                    // reproduces the old direct-entry behavior exactly.
                    HStack(spacing: 12) {
                        fieldSection(title: "จำนวนต่อกล่อง") {
                            TextField("30", text: $qtyPerPack)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "ทานไปแล้ว") {
                            TextField("0", text: $alreadyTaken)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }
                    HStack {
                        Text("คงเหลือ")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.textSecondary)
                        Spacer()
                        Text(computedRemaining.clean)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(healthGreen)
                    }
                    .padding(12)
                    .background(Color.background)
                    .cornerRadius(10)

                    fieldSection(title: "แจ้งเตือนเมื่อเหลือ") {
                        TextField("7", text: $lowStockAlert)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }
```

Remove the now-unused `@State private var qtyTotal: String` declaration and its `init` line (`_qtyTotal = State(...)`) — replaced entirely by `qtyPerPack`/`alreadyTaken`/the computed `computedRemaining`.

Add the computed property near the other computed properties (e.g. right after `mealOptions`/`dosageForms`):
```swift
    /// Clamped to 0 — a negative remaining count from a plausible input
    /// mistake (already-taken typed larger than the pack) degrades to "none
    /// left" rather than persisting a negative stock figure.
    private var computedRemaining: Double {
        max((Double(qtyPerPack) ?? 0) - (Double(alreadyTaken) ?? 0), 0)
    }
```

- [ ] **Step 3: Add provider, doctor, and LOC/LOT fields to the form**

Insert a new section right after the "ใช้สำหรับ"/"ความแรง" `HStack` (before the dosage-form picker):

```swift
                    // Source
                    fieldSection(title: "โรงพยาบาล/ร้านยา") {
                        Button {
                            showProviderPicker = true
                        } label: {
                            HStack {
                                Text(selectedProvider?.name ?? "ไม่ระบุ")
                                    .foregroundColor(selectedProvider == nil ? .textSecondary : .textPrimary)
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundColor(.textSecondary)
                            }
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "ชื่อแพทย์") {
                            TextField("เช่น นพ.สมชาย", text: $doctorName)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "HN") {
                            Text(selectedProvider?.hn ?? "—")
                                .font(.system(size: 15))
                                .foregroundColor(.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }

                    fieldSection(title: "รายละเอียดที่หมอกำหนด") {
                        TextField("เช่น ทาน 1 เม็ด เช้า-เย็น หลังอาหาร", text: $doctorInstructions, axis: .vertical)
                            .font(.system(size: 15))
                            .lineLimit(2, reservesSpace: true)
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "LOC") {
                            TextField("รหัสบนซอง", text: $locCode)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "LOT") {
                            TextField("เลขล็อต", text: $lotNo)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }
```

(HN is shown read-only here, sourced from the selected provider — per the spec, HN belongs to the hospital relationship, not typed per-medication.)

- [ ] **Step 4: Wire the provider picker sheet and scan/edit auto-match**

Add near the other `.sheet`/`.toolbar` modifiers on the outer view (the `ScrollView`'s parent, alongside `.navigationTitle`):

```swift
            .sheet(isPresented: $showProviderPicker) {
                if let userId = authVM.session?.user.id.uuidString {
                    ProviderPickerView(vm: vm, userId: userId, selected: $selectedProvider)
                }
            }
            .task {
                guard selectedProvider == nil else { return }
                if let providerId = editing?.provider?.id {
                    selectedProvider = vm.providers.first { $0.id == providerId }
                } else if let hospitalName = scanned?.hospitalName, !hospitalName.isEmpty {
                    selectedProvider = vm.providers.first {
                        $0.name.caseInsensitiveCompare(hospitalName) == .orderedSame
                    }
                }
            }
```

- [ ] **Step 5: Add the bedtime toggle to the time editor**

```swift
                            ForEach(times.indices, id: \.self) { i in
                                HStack(spacing: 8) {
                                    DatePicker("", selection: Binding(
                                        get: { Self.time(from: times[i]) },
                                        set: { times[i] = Self.timeString(from: $0) }
                                    ), displayedComponents: .hourAndMinute)
                                    .labelsHidden()
                                    Spacer()
                                    if times.count > 1 {
                                        Button {
                                            times.remove(at: i)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundColor(.textSecondary)
                                        }
                                    }
                                }
                            }
```
→
```swift
                            ForEach(times.indices, id: \.self) { i in
                                HStack(spacing: 8) {
                                    DatePicker("", selection: Binding(
                                        get: { Self.time(from: times[i]) },
                                        set: { times[i] = Self.timeString(from: $0) }
                                    ), displayedComponents: .hourAndMinute)
                                    .labelsHidden()
                                    Spacer()
                                    if times.count > 1 {
                                        Button {
                                            times.remove(at: i)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundColor(.textSecondary)
                                        }
                                    }
                                }
                            }
                            Toggle(isOn: $isBedtime) {
                                Text("🌙 ยาก่อนนอน — ไม่ต้องระบุเวลาแม่นยำ")
                                    .font(.system(size: 12, weight: .medium))
                            }
                            .tint(healthGreen)
```

Add the `@State` (alongside the other schedule-related state, near `@State private var reminderEnabled = true`):
```swift
    @State private var isBedtime = false
```

Add its `init` line (alongside `_reminderEnabled`):
```swift
        _isBedtime = State(initialValue: sched?.isBedtime ?? false)
```

- [ ] **Step 6: Wire everything into `save()`**

```swift
            if let editing {
                try await vm.updateMedication(
                    id: editing.id,
                    scheduleId: editing.primarySchedule?.id,
                    inventoryId: editing.inventory?.id,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    qtyRemaining: Double(qtyTotal) ?? 0,
                    qtyUnit: "เม็ด",
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil
                )
            } else {
                try await vm.addMedication(
                    userId: userId,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    qtyTotal: Double(qtyTotal) ?? 0,
                    qtyUnit: "เม็ด",
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil
                )
            }
```
→
```swift
            if let editing {
                try await vm.updateMedication(
                    id: editing.id,
                    scheduleId: editing.primarySchedule?.id,
                    inventoryId: editing.inventory?.id,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    providerId: selectedProvider?.id,
                    doctorName: doctorName.trimmingCharacters(in: .whitespaces),
                    doctorInstructions: doctorInstructions.trimmingCharacters(in: .whitespaces),
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    isBedtime: isBedtime,
                    qtyRemaining: computedRemaining,
                    qtyUnit: "เม็ด",
                    qtyPerPack: Double(qtyPerPack),
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil,
                    locCode: locCode.trimmingCharacters(in: .whitespaces),
                    lotNo: lotNo.trimmingCharacters(in: .whitespaces)
                )
            } else {
                try await vm.addMedication(
                    userId: userId,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    providerId: selectedProvider?.id,
                    doctorName: doctorName.trimmingCharacters(in: .whitespaces),
                    doctorInstructions: doctorInstructions.trimmingCharacters(in: .whitespaces),
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    isBedtime: isBedtime,
                    qtyTotal: computedRemaining,
                    qtyUnit: "เม็ด",
                    qtyPerPack: Double(qtyPerPack),
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil,
                    locCode: locCode.trimmingCharacters(in: .whitespaces),
                    lotNo: lotNo.trimmingCharacters(in: .whitespaces)
                )
            }
```

- [ ] **Step 7: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 8: Commit**

```bash
git add ios/Slippy/Views/Health/AddMedicationView.swift
git commit -m "Expand AddMedicationView: provider picker, doctor fields, LOC/LOT, pack calculator, bedtime toggle"
```

---

## Task 7: `HealthView` — bedtime display

**Files:**
- Modify: `ios/Slippy/Views/Health/HealthView.swift:450-454`

**Interfaces:**
- Consumes: `MedicationSchedule.isBedtime` (Task 2).
- Produces: nothing further downstream.

- [ ] **Step 1: Show "ก่อนนอน" instead of the raw time list when bedtime**

```swift
                    if let sched = med.primarySchedule, !sched.times.isEmpty {
                        Text("· ⏰ \(sched.times.joined(separator: ", "))")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
```
→
```swift
                    if let sched = med.primarySchedule, !sched.times.isEmpty {
                        Text(sched.isBedtime ? "· 🌙 ก่อนนอน" : "· ⏰ \(sched.times.joined(separator: ", "))")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
```

- [ ] **Step 2: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Views/Health/HealthView.swift
git commit -m "Show bedtime label instead of literal time on medication cards"
```

---

## Task 8: `ProfileView` — date of birth field

**Files:**
- Modify: `ios/Slippy/Views/Profile/ProfileView.swift`

**Interfaces:**
- Consumes: `AuthViewModel.updateDateOfBirth` (Task 4), `UserProfile.dateOfBirth` (Task 2).
- Produces: nothing further downstream — terminal UI for this plan's DOB requirement.

- [ ] **Step 1: Add DOB state and prefill**

Find where `editedName` is declared and initialized (search for `@State private var editedName` and its `.onAppear`/initializer site) and add alongside it:

```swift
    @State private var editedDOB: Date = Date()
    @State private var hasDOB = false
```

In whatever function currently seeds `editedName` from `authVM.profile?.fullName` when the edit sheet opens (search for where `editedName` is assigned before `showEditName = true`), add the same pattern for DOB:
```swift
        if let dobString = authVM.profile?.dateOfBirth {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            f.timeZone = TimeZone(identifier: "UTC")
            if let parsed = f.date(from: dobString) {
                editedDOB = parsed
                hasDOB = true
            }
        }
```

- [ ] **Step 2: Add the field to the edit sheet**

```swift
                Form {
                    Section("ชื่อ-นามสกุล") {
                        TextField("ชื่อ-นามสกุล", text: $editedName)
                    }
                }
```
→
```swift
                Form {
                    Section("ชื่อ-นามสกุล") {
                        TextField("ชื่อ-นามสกุล", text: $editedName)
                    }
                    Section("วันเกิด") {
                        Toggle("ระบุวันเกิด", isOn: $hasDOB)
                        if hasDOB {
                            DatePicker("วันเกิด", selection: $editedDOB, displayedComponents: .date)
                                .datePickerStyle(.compact)
                        }
                    }
                }
```

- [ ] **Step 3: Save DOB alongside the name**

```swift
                        Button {
                            savingName = true
                            Task {
                                let ok = await authVM.updateProfile(fullName: editedName)
                                savingName = false
                                if ok { showEditName = false }
                            }
                        } label: {
```
→
```swift
                        Button {
                            savingName = true
                            Task {
                                let nameOK = await authVM.updateProfile(fullName: editedName)
                                let f = DateFormatter()
                                f.dateFormat = "yyyy-MM-dd"
                                f.timeZone = TimeZone(identifier: "UTC")
                                let dobOK = await authVM.updateDateOfBirth(hasDOB ? f.string(from: editedDOB) : nil)
                                savingName = false
                                if nameOK && dobOK { showEditName = false }
                            }
                        } label: {
```

- [ ] **Step 4: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add ios/Slippy/Views/Profile/ProfileView.swift
git commit -m "Add date of birth field to profile edit sheet"
```

---

## Task 9: Sync the LINE reminder worker with bedtime scheduling

**Files:**
- Create: `supabase/migrations/20260831040000_medication_reminders_include_bedtime.sql`
- Modify: `api/src/services/medication-reminder.ts`

**Interfaces:**
- Consumes: `medication_schedules.is_bedtime` (Task 1 — already applied, no dependency on Tasks 2-8, which are iOS-only).
- Produces: nothing further downstream — this closes a gap found mid-execution: the server-side LINE reminder worker builds its push message from `get_pending_medication_reminders`, which doesn't know about `is_bedtime` yet, so a bedtime medication's LINE reminder would show a literal `⏰ 22:00 น.` even though the app itself (Task 7) now displays "ก่อนนอน" for the same schedule — same inconsistency the trip-map-google-places plan's controller flagged and fixed for a different feature earlier in this project's work, caught here before it shipped instead of after.

**Why this task exists:** found while responding to a live user request ("การแจ้งเตือนเรื่องยาให้ sync กับ reminder ด้วย" — the medication notification should sync with the reminder too) that arrived mid-execution of this plan. Confirmed by reading `api/src/services/medication-reminder.ts:33,78` directly: `pushReminder` formats `reminder.scheduled_at` into a literal `HH:mm` and puts it in the LINE flex message body (`⏰ ${time} น.`) — there is no bedtime-awareness anywhere in this file. There is already a precedent for extending this exact RPC (`supabase/migrations/20260829150000_medication_reminders_include_purpose.sql`, which added `purpose`/`strength`/`color` the same way) — this task follows that established pattern.

- [ ] **Step 1: Write the RPC-extending migration**

```sql
-- 20260831040000_medication_reminders_include_bedtime.sql
-- A bedtime medication's LINE reminder must say "ก่อนนอน", not a literal
-- clock time — matching what the app itself now shows on the medication
-- card (see the iOS side of this same plan). get_pending_medication_reminders
-- already joins medication_schedules; is_bedtime just needs to ride along,
-- same pattern as 20260829150000's purpose/strength/color addition.
DROP FUNCTION IF EXISTS public.get_pending_medication_reminders(timestamp with time zone, timestamp with time zone);

CREATE FUNCTION public.get_pending_medication_reminders(p_from timestamp with time zone DEFAULT now(), p_to timestamp with time zone DEFAULT (now() + '00:05:00'::interval))
 RETURNS TABLE(log_id uuid, user_id uuid, medication_id uuid, med_name text, med_purpose text, med_strength text, med_color text, dose_qty numeric, meal_relation text, meal_note text, scheduled_at timestamp with time zone, reminder_via text, is_bedtime boolean)
 LANGUAGE sql
AS $function$
  SELECT
    ml.id           AS log_id,
    ml.user_id,
    ml.medication_id,
    m.name          AS med_name,
    m.purpose       AS med_purpose,
    m.strength      AS med_strength,
    m.color         AS med_color,
    ms.dose_qty,
    ms.meal_relation,
    ms.meal_note,
    ml.scheduled_at,
    ms.reminder_via,
    ms.is_bedtime
  FROM medication_logs ml
  JOIN medication_schedules ms ON ms.id = ml.schedule_id
  JOIN medications m           ON m.id  = ml.medication_id
  WHERE
    ml.status        = 'pending'
    AND ms.reminder_enabled = true
    AND ml.scheduled_at - (ms.reminder_minutes * interval '1 minute')
        BETWEEN p_from AND p_to;
$function$
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool (`project_id`: `ntzztcnkedcxfjvfxjrf`, `name`: `medication_reminders_include_bedtime`, `query`: the SQL from Step 1) — same mechanism Task 1 used, avoiding a CLI dependency.

- [ ] **Step 3: Verify the function signature**

Run via the Supabase MCP `execute_sql` tool (same project id):
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'get_pending_medication_reminders';
```
Expected: the result contains `is_bedtime` in the returned text.

- [ ] **Step 4: Thread `is_bedtime` through the TypeScript worker**

In `api/src/services/medication-reminder.ts`, `pushReminder`'s parameter type (lines 15-25):
```typescript
async function pushReminder(lineUserId: string, reminder: {
  med_name:     string
  med_purpose:  string | null
  med_strength: string | null
  med_color:    string | null
  dose_qty:     number
  meal_relation: string
  meal_note:    string | null
  scheduled_at: string
  log_id:       string
}) {
```
→
```typescript
async function pushReminder(lineUserId: string, reminder: {
  med_name:     string
  med_purpose:  string | null
  med_strength: string | null
  med_color:    string | null
  dose_qty:     number
  meal_relation: string
  meal_note:    string | null
  scheduled_at: string
  log_id:       string
  is_bedtime:   boolean
}) {
```

The `time` line and its use in the flex message body (lines 33 and 78):
```typescript
  const time = new Date(reminder.scheduled_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
```
```typescript
              { type: "text", text: `⏰ ${time} น.`, size: "xs", color: "#9ca3af", margin: "sm" },
```
→
```typescript
  const time = reminder.is_bedtime
    ? "ก่อนนอน"
    : new Date(reminder.scheduled_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
```
```typescript
              { type: "text", text: reminder.is_bedtime ? `🌙 ${time}` : `⏰ ${time} น.`, size: "xs", color: "#9ca3af", margin: "sm" },
```

`checkAndSendReminders`'s call site (lines 181-191):
```typescript
    await pushReminder(conn.line_user_id, {
      med_name:     r.med_name,
      med_purpose:  r.med_purpose,
      med_strength: r.med_strength,
      med_color:    r.med_color,
      dose_qty:     r.dose_qty,
      meal_relation: r.meal_relation,
      meal_note:    r.meal_note,
      scheduled_at: r.scheduled_at,
      log_id:       r.log_id,
    })
```
→
```typescript
    await pushReminder(conn.line_user_id, {
      med_name:     r.med_name,
      med_purpose:  r.med_purpose,
      med_strength: r.med_strength,
      med_color:    r.med_color,
      dose_qty:     r.dose_qty,
      meal_relation: r.meal_relation,
      meal_note:    r.meal_note,
      scheduled_at: r.scheduled_at,
      log_id:       r.log_id,
      is_bedtime:   r.is_bedtime,
    })
```

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: 0 errors. (This project has no test target for `api/`'s services beyond typechecking — the RPC/LINE-push path itself can't be exercised without a live LINE channel and a due reminder, so typecheck + the SQL verification in Step 3 are the real gates here; Step 6 below confirms the logic reads correctly by inspection.)

- [ ] **Step 6: Confirm by reading the diff**

Re-read the final `pushReminder` function and `checkAndSendReminders`' call site in the file — confirm `is_bedtime` flows from the RPC result (`r.is_bedtime`) through the call site into `pushReminder`'s parameter, and that the flex message body's `⏰`/`🌙` branch matches `reminder.is_bedtime` correctly (this is a logic-correctness check a reviewer should re-verify independently, not just take on the implementer's word, since there's no automated test exercising this path).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260831040000_medication_reminders_include_bedtime.sql api/src/services/medication-reminder.ts
git commit -m "Sync LINE medication reminder messages with bedtime scheduling"
```

---

## Task 10: Full end-to-end verification

**Files:** none (verification only).

**Interfaces:** consumes every task's output; produces nothing further.

- [ ] **Step 1: Confirm clean build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=108E0E3F-7C0C-4B39-89C3-FCFCE0519068' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`, 0 errors.

- [ ] **Step 2: Install and launch**

Use `mcp__Claude_Code_iOS_Simulator__control` `action: "launch"` with the built `.app` path from DerivedData, bundle id `app.slippy.ios`. If the app needs a logged-in session and the simulator has none, this is a controller-level prerequisite (do not enter credentials yourself — this is a prohibited action; ask the user to log in once if needed, same as was necessary for the concurrently-running trip-map-google-places plan).

- [ ] **Step 3: Add a medication with everything filled in**

Navigate: หน้าหลัก → สุขภาพและยา → เพิ่มยา. Create a new hospital provider via "+ เพิ่มใหม่" in the provider picker (with an HN), fill doctor name + instructions, LOC + LOT, set pack size to 30 and already-taken to 10 (confirm "คงเหลือ" shows 20), mark the schedule "ก่อนนอน", save. Confirm no error, and the new medication appears in the list.

- [ ] **Step 4: Confirm bedtime display**

On the medication list (`HealthView`), confirm the just-added medication's card shows "🌙 ก่อนนอน" instead of a clock time.

- [ ] **Step 5: Edit and confirm round-trip**

Open the medication's edit sheet, confirm the provider, doctor name/instructions, LOC/LOT, and remaining count (20) all show correctly — this is the real proof the save path and the select-embed (Task 3, Step 1) both work, not just that save didn't error.

- [ ] **Step 6: Scan integration**

If a real medication label photo is available (or one from earlier testing in this project), scan it and confirm the review screen (`AddMedicationView` with `scanned:` set) pre-fills LOT, doctor name, doctor instructions, and either selects a matching existing provider or offers to create one from the scanned hospital name — this closes the gap the spec exists to fix (previously-extracted-but-discarded scan fields).

- [ ] **Step 7: Regression check**

Add a second medication using only the fields that existed before this plan (name, dosage form, a normal time, a directly-typed pack size with already-taken left at 0) — confirm it saves and displays exactly as medications did before this work, proving the expansion is additive.

- [ ] **Step 8: Profile DOB**

Open profile → edit → toggle "ระบุวันเกิด" on, pick a date, save. Reopen the edit sheet, confirm the date persisted.

- [ ] **Step 9: Report results**

Summarize: build status, screenshots of the filled-in add-medication form, the bedtime card display, the edit round-trip, and the profile DOB field. No commit for this task — it's verification, not a code change.
