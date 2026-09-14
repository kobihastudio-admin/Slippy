-- ---------------------------------------------------------------------------
-- 064_admin_audit_logs.sql
--
-- Phase 2 of the ops/monitoring backlog: user_activity_logs (migration 014)
-- already tracks what regular users do, but its RLS only lets a user see
-- their OWN rows — wrong fit for "who changed what in admin". Superadmin
-- writes to system_config / pricing_plans go through createAdminClient(),
-- which bypasses RLS entirely, so until now there was no record at all of
-- who changed what, when, or what the value was before.
-- ---------------------------------------------------------------------------

CREATE TABLE admin_audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  -- e.g. 'system_config_update' | 'pricing_plan_update' | 'pricing_plan_stripe_sync'
  target_type text        NOT NULL,   -- 'system_config' | 'pricing_plans'
  target_id   text,                   -- e.g. config key, plan id
  before      jsonb,
  after       jsonb,
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE INDEX idx_admin_audit_logs_target  ON admin_audit_logs(target_type, target_id);
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
-- Any superadmin can read the full trail (not just their own actions —
-- the whole point is staff can see what OTHER staff changed).
CREATE POLICY "admin_audit_logs_superadmin_select" ON admin_audit_logs
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_superadmin = true)
  );
-- Writes happen via createAdminClient() (service_role, bypasses RLS) from
-- the admin routes themselves — no authenticated INSERT policy needed.
CREATE POLICY "admin_audit_logs_service_role_insert" ON admin_audit_logs
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
COMMENT ON TABLE admin_audit_logs IS
  'Who changed what in the admin panel (system_config, pricing_plans) and
   when, with before/after values. Written from web/src/app/api/admin/*
   routes after each successful write.';
