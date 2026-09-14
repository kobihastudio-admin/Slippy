-- Rich allocation metadata for the general split-bill flow.
ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS allocation_details jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN split_bills.allocation_details IS
  'UI metadata for bill allocation: per-person item descriptions and payment methods.';
