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
