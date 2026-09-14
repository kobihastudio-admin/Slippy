-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES users(id)         ON DELETE CASCADE,
  type            text        NOT NULL,
  -- types: document_approved | document_failed | document_duplicate
  --        quota_warning | integration_sync | line_received
  --        email_received | upload_error | system
  title           text        NOT NULL,
  body            text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  -- e.g. { "document_id": "...", "amount": 8750, "vendor": "AWS" }
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_org_unread
  ON notifications (organization_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
-- ── Client Error Logs (browser-side errors: HEIC, camera, upload) ─────────────
CREATE TABLE IF NOT EXISTS client_error_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES users(id)         ON DELETE SET NULL,
  organization_id uuid        REFERENCES organizations(id) ON DELETE SET NULL,
  error_type      text        NOT NULL,
  -- types: heic_conversion | upload | camera | ocr | stripe | unknown
  error_name      text,        -- e.g. "NotAllowedError", "TypeError"
  error_message   text,
  error_stack     text,
  context         jsonb       NOT NULL DEFAULT '{}',
  -- { file_name, file_size, file_type, mime_type,
  --   browser_ua, strategy, os, app_version }
  resolved        boolean     NOT NULL DEFAULT false,
  resolved_note   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_error_logs_type_unresolved
  ON client_error_logs (error_type, created_at DESC)
  WHERE resolved = false;
CREATE INDEX IF NOT EXISTS client_error_logs_user
  ON client_error_logs (user_id, created_at DESC);
-- ── GRANTS ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE notifications     TO authenticated;
GRANT SELECT, INSERT          ON TABLE client_error_logs TO authenticated;
-- anon can also INSERT errors (user might not be logged in when error occurs)
GRANT INSERT                  ON TABLE client_error_logs TO anon;
-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs   ENABLE ROW LEVEL SECURITY;
-- notifications: users see their own org's notifications
CREATE POLICY "notifications_org_select" ON notifications
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );
-- client_error_logs: anyone can INSERT (for logging), only service_role reads
CREATE POLICY "error_logs_insert" ON client_error_logs
  FOR INSERT WITH CHECK (true);
CREATE POLICY "error_logs_own_select" ON client_error_logs
  FOR SELECT USING (user_id = auth.uid());
