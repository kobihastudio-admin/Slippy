-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 014_privacy_settings.sql
--
-- Privacy & Security Settings
-- ────────────────────────────
-- • user_consents        — PDPA consent toggles per user
-- • user_security_prefs  — login alerts, auto-lock preference
-- • user_activity_logs   — privacy audit trail shown in /privacy Log tab
-- • user_sessions        — active-session tracking for Sessions tab
-- ---------------------------------------------------------------------------

-- ── 1. PDPA Consents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_consents (
  user_id      uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  necessary    boolean NOT NULL DEFAULT true,   -- always true, cannot be turned off
  ai           boolean NOT NULL DEFAULT true,
  analytics    boolean NOT NULL DEFAULT true,
  marketing    boolean NOT NULL DEFAULT false,
  research     boolean NOT NULL DEFAULT false,
  cross_border boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON user_consents TO authenticated;
CREATE POLICY "user_consents_own" ON user_consents
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- ── 2. Security Preferences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_security_prefs (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  login_alerts boolean NOT NULL DEFAULT true,
  auto_lock    text    NOT NULL DEFAULT '5min'
    CHECK (auto_lock IN ('immediate','1min','5min','30min','never')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_security_prefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON user_security_prefs TO authenticated;
CREATE POLICY "user_security_prefs_own" ON user_security_prefs
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- ── 3. User Activity Log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text        NOT NULL,   -- 'login','logout','consent_update','security_update',
                                     -- 'export_request','session_revoke','account_delete_request'
  detail     text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_activity ON user_activity_logs(user_id, created_at DESC);
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON user_activity_logs TO authenticated;
CREATE POLICY "user_activity_own" ON user_activity_logs
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- ── 4. Session Tracking ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,  -- safe opaque identifier (not the actual JWT)
  device_name text,
  device_type text        CHECK (device_type IN ('mobile','desktop','tablet')),
  os          text,
  browser     text,
  ip_address  text,
  location    text,
  last_active timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token
  ON user_sessions(user_id, token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, last_active DESC);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO authenticated;
CREATE POLICY "user_sessions_own" ON user_sessions
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- ── 5. Cleanup function: remove stale sessions > 30 days ───────────────────
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM user_sessions WHERE last_active < now() - interval '30 days';
$$;
