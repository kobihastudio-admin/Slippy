-- ---------------------------------------------------------------------------
-- 066_ocr_feedback.sql
--
-- web/src/app/api/ocr-feedback/route.ts has inserted into this table since
-- it was written, but no migration ever created it — the insert has been
-- silently failing (Supabase JS doesn't throw on a DB error; the route never
-- checked `{ error }`, so it always returned 200 "ok" regardless). Users
-- tapping "ส่งให้ Slippy เรียนรู้" saw a success message while nothing was
-- ever actually saved. Fixed alongside this migration in the same route.
-- ---------------------------------------------------------------------------

CREATE TABLE ocr_feedback (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid        REFERENCES documents(id) ON DELETE SET NULL,
  image_path     text,
  original_data  jsonb       NOT NULL DEFAULT '{}',
  corrected_data jsonb       NOT NULL DEFAULT '{}',
  raw_text       text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ocr_feedback_document ON ocr_feedback(document_id);
ALTER TABLE ocr_feedback ENABLE ROW LEVEL SECURITY;
-- Submitted via the app's anon/authenticated client with no auth requirement
-- (it's training data, not user data) — same posture as client_error_logs.
CREATE POLICY "ocr_feedback_insert" ON ocr_feedback
  FOR INSERT WITH CHECK (true);
COMMENT ON TABLE ocr_feedback IS
  'User-submitted corrections to AI OCR extraction ("ส่งให้ Slippy เรียนรู้").
   Nothing currently reads this table back into the pipeline (pattern-miner.ts
   / few-shot.ts use other tables) — captured here so it exists once that
   wiring is built, instead of being silently discarded as it was before.';
