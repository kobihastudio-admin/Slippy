/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * Migration 016 — Personal Space
 * Adds account_mode to users, creates personal_profiles, health_entries,
 * financial_goals, detected_subscriptions tables.
 * Adds health_category and is_personal columns to documents.
 */

-- ─────────────────────────────────────────────────────────
-- 1. Extend users table
-- ─────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_mode text DEFAULT 'business'
    CHECK (account_mode IN ('business', 'personal', 'both'));
-- ─────────────────────────────────────────────────────────
-- 2. Extend documents table
-- ─────────────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS health_category text
    CHECK (health_category IN (
      'food_healthy','food_unhealthy','supplement','medical',
      'fitness','wellness','alcohol','caffeine','other_health'
    ));
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_personal bool DEFAULT false;
-- ─────────────────────────────────────────────────────────
-- 3. personal_profiles
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_profiles (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name     text,
  bio              text,
  avatar_url       text,
  longevity_score  numeric(5,2) DEFAULT 0,
  wealth_score     numeric(5,2) DEFAULT 0,
  is_public        bool DEFAULT true,
  follower_count   int DEFAULT 0,
  following_count  int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
-- ─────────────────────────────────────────────────────────
-- 4. health_entries
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN (
    'weight','blood_pressure_systolic','blood_pressure_diastolic',
    'blood_glucose','steps','sleep_hours','heart_rate','hrv',
    'water_ml','calories'
  )),
  value        numeric(10,2) NOT NULL,
  unit         text,
  notes        text,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_entries_user_recorded
  ON health_entries(user_id, recorded_at DESC);
-- ─────────────────────────────────────────────────────────
-- 5. financial_goals
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text,
  target_amount  numeric(14,2) NOT NULL,
  current_amount numeric(14,2) DEFAULT 0,
  deadline       date,
  status         text DEFAULT 'active' CHECK (status IN ('active','completed','paused')),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_goals_user
  ON financial_goals(user_id);
-- ─────────────────────────────────────────────────────────
-- 6. detected_subscriptions
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS detected_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_name      text NOT NULL,
  estimated_amount numeric(14,2),
  frequency        text CHECK (frequency IN ('monthly','yearly','weekly')),
  next_due_date    date,
  last_seen_at     timestamptz,
  is_confirmed     bool DEFAULT false,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS detected_subscriptions_user
  ON detected_subscriptions(user_id);
-- ─────────────────────────────────────────────────────────
-- 7. RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE personal_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_goals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_subscriptions ENABLE ROW LEVEL SECURITY;
-- personal_profiles: own row + public rows readable by all auth users
CREATE POLICY "personal_profiles: own full access"
  ON personal_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "personal_profiles: public readable"
  ON personal_profiles FOR SELECT
  USING (is_public = true);
-- health_entries: own data only
CREATE POLICY "health_entries: own access"
  ON health_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- financial_goals: own data only
CREATE POLICY "financial_goals: own access"
  ON financial_goals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- detected_subscriptions: own data only
CREATE POLICY "detected_subscriptions: own access"
  ON detected_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ─────────────────────────────────────────────────────────
-- 8. Grants
-- ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_profiles      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON health_entries         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_goals        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON detected_subscriptions TO authenticated;
