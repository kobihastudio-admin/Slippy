-- ---------------------------------------------------------------------------
-- 069_expense_category_column.sql
--
-- documents.doc_category is the AI pipeline's own accounting classification
-- (tax_invoice_full / receipt_with_tax / consumer_receipt / ... — see
-- api/src/pipeline/extractor.ts DocCategory), used to derive vat_claimable
-- / expense_claimable and feed shouldAutoApprove(). It gets overwritten by
-- the pipeline every time a document is (re)processed.
--
-- 068_document_categories.sql's management UI/picker (ค่าเดินทาง, ค่าอาหาร,
-- ...) was wired to read/write that same column, assuming it was a free
-- user taxonomy. It is not — any reprocessing would have silently
-- discarded a user's custom category. This adds a separate column for it.
-- (Checked: no document currently holds a non-AI value in doc_category, so
-- no backfill/data-loss concern.)
-- ---------------------------------------------------------------------------

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_category text;
COMMENT ON COLUMN documents.expense_category IS
  'Org-defined expense category (see document_categories table) — distinct from
   doc_category, which is the AI pipeline''s own accounting-document classification
   and gets overwritten on every (re)processing run.';
