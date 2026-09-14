-- ═══════════════════════════════════════════════════════════════════════════
-- 087_activity_log_for_abuse_detection.sql
--
-- `user_activity_logs` exists, the user-facing privacy page already READS it,
-- and nothing has ever written a single row — so users see an empty history and
-- we have no way to answer "who did that". This makes it writable and makes the
-- rows useful for detecting abuse rather than only for display.
--
-- Four changes, each forced by a question the current shape cannot answer:
--
--   user_id → NULLABLE   A failed login has no user. Requiring one made the
--                        single most important abuse signal — repeated failures
--                        from one address — impossible to record at all.
--   outcome              "Viewed a document" and "was REFUSED a document" are
--                        the same row today. Only the refusals reveal someone
--                        walking through ids that are not theirs.
--   resource_*           Which document/trip was touched, so enumeration shows
--                        up as many denied reads of many different ids.
--   metadata jsonb       Structured detail. `detail text` is kept and still
--                        populated so the existing privacy page keeps working.
--
-- Deliberately NOT stored: document contents, extracted values, passwords, or
-- tokens. This table records that something happened, never what was in it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_activity_logs
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE user_activity_logs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome         text NOT NULL DEFAULT 'success'
    CHECK (outcome IN ('success', 'denied', 'failed', 'rejected')),
  ADD COLUMN IF NOT EXISTS resource_type   text,
  ADD COLUMN IF NOT EXISTS resource_id     text,
  ADD COLUMN IF NOT EXISTS user_agent      text,
  ADD COLUMN IF NOT EXISTS metadata        jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_activity_logs.ip_address IS
  'Truncated to a /24 before storing — enough to correlate an attack, less than '
  'is needed to track a person.';
COMMENT ON COLUMN user_activity_logs.outcome IS
  'success | denied (authorization refused) | failed (the action errored) | '
  'rejected (input refused, e.g. not a financial document)';

-- ── Indexes shaped by the detection queries, not by the columns ─────────────
-- "same address, many failures, short window" — credential stuffing.
CREATE INDEX IF NOT EXISTS idx_activity_ip_outcome
  ON user_activity_logs (ip_address, outcome, created_at DESC)
  WHERE outcome IN ('denied', 'failed');

-- "one account touching many resources it does not own" — id enumeration.
CREATE INDEX IF NOT EXISTS idx_activity_user_recent
  ON user_activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_org_recent
  ON user_activity_logs (organization_id, created_at DESC);

-- ── Retention ──────────────────────────────────────────────────────────────
-- Security logs that grow forever become both a liability and a cost. 180 days
-- is long enough to investigate an incident discovered late, short enough that
-- an old breach does not expose years of behaviour. pg_cron is already
-- installed (migration 082 uses it for quota resets).
DO $$
BEGIN
  PERFORM cron.schedule(
    'purge-user-activity-logs',
    '30 4 * * *',
    $sql$DELETE FROM user_activity_logs WHERE created_at < now() - interval '180 days'$sql$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — schedule purge-user-activity-logs manually';
END $$;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- SELECT cron.unschedule('purge-user-activity-logs');
-- DROP INDEX IF EXISTS idx_activity_ip_outcome, idx_activity_user_recent, idx_activity_org_recent;
-- ALTER TABLE user_activity_logs
--   DROP COLUMN IF EXISTS organization_id, DROP COLUMN IF EXISTS outcome,
--   DROP COLUMN IF EXISTS resource_type,   DROP COLUMN IF EXISTS resource_id,
--   DROP COLUMN IF EXISTS user_agent,      DROP COLUMN IF EXISTS metadata;
