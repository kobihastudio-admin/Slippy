-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 011_data_retention.sql
--
-- Data Retention Policy  (PDPA § 37 / พรบ.คุ้มครองข้อมูลส่วนบุคคล)
-- ─────────────────────────────────────────────────────────────────
-- • Adds `data_retention_years` to organizations (default 5 — Thai
--   accounting law requires 5-year document retention).
-- • Creates `cleanup_expired_documents()` — soft-deletes documents
--   older than the org's retention window.  Documents are moved to
--   `status = 'archived'` first; permanent deletion runs after a
--   configurable grace period so accidental cleanup can be reversed.
-- • Creates `hard_delete_archived_documents()` — permanently removes
--   rows (and their storage objects) that have been archived for at
--   least 30 days, keeping the DB lean.
-- • Both functions are SECURITY DEFINER, callable only by service_role
--   (invoked by a monthly Edge Function cron — see supabase/functions/).
-- ---------------------------------------------------------------------------

-- ── 1. Retention column on organizations ─────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_retention_years   smallint NOT NULL DEFAULT 5
    CHECK (data_retention_years BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS retention_last_run_at  timestamptz;
COMMENT ON COLUMN organizations.data_retention_years IS
  'Number of years to retain documents (Thai accounting law minimum = 5).';
COMMENT ON COLUMN organizations.retention_last_run_at IS
  'Timestamp of last successful data-retention cleanup run.';
-- ── 2. Archived-at timestamp on documents ────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz;
COMMENT ON COLUMN documents.archived_at IS
  'Populated when a document is soft-archived by the retention cleanup job.';
-- ── 3. Soft-delete: move expired documents to "archived" ─────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_documents()
RETURNS TABLE (organization_id uuid, archived_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH updated AS (
    UPDATE documents d
    SET    status      = 'archived',
           archived_at = now()
    FROM   organizations o
    WHERE  d.organization_id = o.id
      -- Only documents that have been around longer than the retention window
      AND  d.created_at < now() - (o.data_retention_years || ' years')::interval
      -- Exclude already-archived / deleted rows
      AND  d.status NOT IN ('archived', 'deleted')
    RETURNING d.organization_id
  )
  SELECT u.organization_id, count(*)::int AS archived_count
  FROM   updated u
  GROUP  BY u.organization_id;

  -- Stamp each org that was touched
  UPDATE organizations
  SET    retention_last_run_at = now()
  WHERE  id IN (
    SELECT DISTINCT d.organization_id
    FROM   documents d
    JOIN   organizations o ON o.id = d.organization_id
    WHERE  d.created_at < now() - (o.data_retention_years || ' years')::interval
  );
END;
$$;
-- ── 4. Hard-delete: permanently remove rows archived > 30 days ago ────────────
--   Storage objects are deleted by the Edge Function before calling this,
--   so we only remove the DB rows (plus dependent child rows).
CREATE OR REPLACE FUNCTION hard_delete_archived_documents()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Collect IDs to delete
  CREATE TEMP TABLE _to_delete ON COMMIT DROP AS
    SELECT id FROM documents
    WHERE  status      = 'archived'
      AND  archived_at < now() - interval '30 days';

  -- Remove dependents first (FK order)
  DELETE FROM document_audit_logs
  WHERE  document_id IN (SELECT id FROM _to_delete);

  DELETE FROM document_line_items
  WHERE  document_id IN (SELECT id FROM _to_delete);

  -- Remove document rows
  DELETE FROM documents
  WHERE  id IN (SELECT id FROM _to_delete);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
-- ── 5. Grant execute to service_role only ────────────────────────────────────
REVOKE ALL ON FUNCTION cleanup_expired_documents()       FROM PUBLIC;
REVOKE ALL ON FUNCTION hard_delete_archived_documents()  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cleanup_expired_documents()       TO service_role;
GRANT  EXECUTE ON FUNCTION hard_delete_archived_documents()  TO service_role;
-- ── 6. Index for efficient retention scan ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_created_at_status
  ON documents (organization_id, created_at, status)
  WHERE status NOT IN ('archived', 'deleted');
-- ── 7. Comments ───────────────────────────────────────────────────────────────
COMMENT ON FUNCTION cleanup_expired_documents() IS
  'Soft-archives documents older than the org data_retention_years. '
  'Run monthly by Edge Function cron. Returns rows per org.';
COMMENT ON FUNCTION hard_delete_archived_documents() IS
  'Permanently deletes document rows (+ child rows) that have been archived '
  'for >= 30 days. Run after storage objects are removed.';
