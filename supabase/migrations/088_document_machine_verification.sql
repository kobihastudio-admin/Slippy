-- Machine-readable verification state for receipt/slip processing.
-- This is intentionally separate from documents.status, which represents the
-- human/accounting workflow (reviewing, approved, pushed, ...).

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS machine_verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS reconciliation_details jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_machine_verification_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_machine_verification_status_check
      CHECK (machine_verification_status IN ('unverified', 'needs_review', 'verified'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_reconciliation_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_reconciliation_status_check
      CHECK (reconciliation_status IN ('not_checked', 'balanced', 'mismatch'));
  END IF;
END $$;

COMMENT ON COLUMN public.documents.machine_verification_status IS
  'Machine assessment only; never replaces human/accounting approval status.';
COMMENT ON COLUMN public.documents.reconciliation_details IS
  'Structured total and line-item arithmetic checks produced by the validation pipeline.';
