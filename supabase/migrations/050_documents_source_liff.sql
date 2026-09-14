-- ── 050: Add liff_scan to documents.source CHECK constraint ──────────────────
-- The /liff/scan LIFF page uploads directly via Next.js API route instead of
-- going through the LINE webhook, so it needs its own source identifier.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_source_check
    CHECK (source IN ('web', 'mobile', 'email', 'line', 'liff_scan'));
