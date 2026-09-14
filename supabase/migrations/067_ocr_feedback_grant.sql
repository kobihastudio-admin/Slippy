-- ---------------------------------------------------------------------------
-- 067_ocr_feedback_grant.sql
--
-- 066 added an RLS policy for ocr_feedback but forgot the table-level GRANT
-- — Postgres requires both for non-superuser roles. Without it every insert
-- failed with "permission denied for table ocr_feedback" (caught by the
-- now-fixed error check in web/src/app/api/ocr-feedback/route.ts, which
-- previously masked this as a false-positive 200).
-- ---------------------------------------------------------------------------

GRANT INSERT ON TABLE ocr_feedback TO anon, authenticated;
