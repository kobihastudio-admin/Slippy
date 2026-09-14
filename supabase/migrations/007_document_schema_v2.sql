-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 007_document_schema_v2.sql
-- Adds:
--   • Columns missing from initial schema (pipeline was referencing them)
--   • New classification columns (doc_category, vat_claimable, etc.)
--   • Updated doc_type CHECK to include new values
--   • audit_log columns (actor text, metadata jsonb)
-- ---------------------------------------------------------------------------

-- ── 1. Update doc_type CHECK constraint ──────────────────────────────────────
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN (
    'expense', 'invoice', 'receipt', 'unknown',
    'tax_invoice', 'credit_note'             -- new values used by extractor
  ));
-- ── 2. Missing vendor / document fields ──────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS vendor_address    text,
  ADD COLUMN IF NOT EXISTS vendor_phone      text,
  ADD COLUMN IF NOT EXISTS due_date          date,
  ADD COLUMN IF NOT EXISTS currency          text NOT NULL DEFAULT 'THB',
  ADD COLUMN IF NOT EXISTS payment_method    text,
  ADD COLUMN IF NOT EXISTS notes             text;
-- ── 3. Amount detail fields ───────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS discount_amount   numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee      numeric(15,2) NOT NULL DEFAULT 0;
-- ── 4. AI / pipeline meta fields ────��────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS ai_raw_response   jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS processing_stage  text,
  ADD COLUMN IF NOT EXISTS processing_percent int;
-- ── 5. Confidence + validation (rename-compatible additions) ──────────────────
-- overall_confidence already exists; add confidence_score as alias view-column
-- field_confidence stored in existing `confidence jsonb`
-- validation_warnings: full warning objects (pipeline already writes validation_issues)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS validation_warnings jsonb DEFAULT '[]';
-- duplicate_doc_id: pipeline uses this name; DB uses duplicate_of
-- Add duplicate_doc_id as a generated/alias column via a simple extra column
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS duplicate_doc_id  uuid REFERENCES documents(id) ON DELETE SET NULL;
-- ── 6. Document classification (new in v2) ────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS doc_category      text
    CHECK (doc_category IN (
      'tax_invoice_full',
      'tax_invoice_simplified',
      'receipt_with_tax',
      'receipt',
      'consumer_receipt',
      'invoice',
      'credit_note',
      'other'
    )),
  ADD COLUMN IF NOT EXISTS vat_claimable     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expense_claimable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_use_note text,
  ADD COLUMN IF NOT EXISTS platform_name     text;
-- "LINE MAN" | "Grab" | …

-- ── 7. document_line_items: add confidence column ────────────────────────────
ALTER TABLE document_line_items
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3);
-- ── 8. document_audit_logs: add actor (text) + metadata (jsonb) ──────────────
--  Original schema had actor_id uuid; pipeline writes actor text + metadata jsonb.
--  Add both new columns so pipeline and future UI can coexist.
ALTER TABLE document_audit_logs
  ADD COLUMN IF NOT EXISTS actor    text,        -- "pipeline" | "user:<id>" | …
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
-- ── 9. Indexes on new classification columns ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_docs_category
  ON documents (organization_id, doc_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_vat_claimable
  ON documents (organization_id, vat_claimable, status)
  WHERE vat_claimable = true;
CREATE INDEX IF NOT EXISTS idx_docs_platform
  ON documents (organization_id, platform_name)
  WHERE platform_name IS NOT NULL;
-- ── 10. GRANTS ────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE documents             TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE document_line_items   TO authenticated;
GRANT SELECT, INSERT          ON TABLE document_audit_logs  TO authenticated;
