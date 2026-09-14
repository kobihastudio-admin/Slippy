-- ---------------------------------------------------------------------------
-- 020_org_quota_and_system_config.sql
--
-- 1. Add org_quota to pricing_plans  (max organizations a user can own)
-- 2. Create system_config table      (admin-adjustable global key-value settings)
-- ---------------------------------------------------------------------------

-- ── 1. org_quota on pricing_plans ────────────────────────────────────────────
-- 0 = unlimited; only checked when user is owner of an org
ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS org_quota int NOT NULL DEFAULT 1;
-- Set defaults per plan
UPDATE pricing_plans SET org_quota = 2    WHERE id = 'free';
UPDATE pricing_plans SET org_quota = 3    WHERE id = 'starter';
UPDATE pricing_plans SET org_quota = 5    WHERE id = 'personal';
UPDATE pricing_plans SET org_quota = 0    WHERE id = 'sme';
-- 0 = unlimited
UPDATE pricing_plans SET org_quota = 0    WHERE id = 'business';
UPDATE pricing_plans SET org_quota = 0    WHERE id = 'enterprise';
COMMENT ON COLUMN pricing_plans.org_quota IS
  'Max organizations a user can own on this plan. 0 = unlimited.';
-- ── 2. system_config table ───────────────────────────────────────────────────
-- Global key-value store for admin-adjustable settings.
-- Values are stored as JSONB to support strings, numbers, booleans, and arrays.
CREATE TABLE IF NOT EXISTS system_config (
  key           text        PRIMARY KEY,
  value         jsonb       NOT NULL,
  description   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES users(id) ON DELETE SET NULL
);
-- Seed default config values
INSERT INTO system_config (key, value, description) VALUES
  ('free_plan_org_quota',      '2',     'Max orgs a free-plan user can own (mirrors pricing_plans.org_quota)'),
  ('starter_plan_org_quota',   '3',     'Max orgs a starter-plan user can own'),
  ('personal_plan_org_quota',  '5',     'Max orgs a personal-plan user can own'),
  ('maintenance_mode',         'false', 'When true, show maintenance page to non-superadmins'),
  ('new_user_default_plan',    '"free"','Plan ID assigned to new users automatically'),
  ('max_file_size_mb',         '20',    'Max upload file size in MB'),
  ('ai_extraction_enabled',    'true',  'Enable AI OCR extraction pipeline'),
  ('line_bot_enabled',         'true',  'Enable LINE Bot webhook processing'),
  ('email_ingestion_enabled',  'false', 'Enable email attachment ingestion (requires DNS setup)'),
  ('camera_upload_enabled',    'false', 'Enable camera upload feature in web app')
ON CONFLICT (key) DO NOTHING;
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_system_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION update_system_config_updated_at();
-- ── 3. RLS on system_config ──────────────────────────────────────────────────
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
-- Superadmins can read & write
CREATE POLICY "system_config_superadmin_all" ON system_config
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_superadmin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_superadmin = true)
  );
-- Service role (internal API) can also read — needed for runtime checks
-- (service role bypasses RLS automatically)

COMMENT ON TABLE system_config IS
  'Admin-adjustable global settings. Superadmins can modify via /admin/config.
   Keys are stable identifiers; values are JSONB for flexibility.';
