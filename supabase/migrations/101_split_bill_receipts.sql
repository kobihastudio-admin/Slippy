-- A split bill can collect many receipts, including receipts already stored in
-- the general document inbox. Each receipt records who fronted the money.
CREATE TABLE IF NOT EXISTS split_bill_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id       uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  document_id         uuid REFERENCES documents(id) ON DELETE SET NULL,
  paid_by_participant_id uuid REFERENCES split_participants(id) ON DELETE SET NULL,
  receipt_url         text,
  title               text,
  amount              numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  expense_date        date NOT NULL DEFAULT CURRENT_DATE,
  meal_type           text CHECK (meal_type IN ('breakfast','lunch','dinner','snack','other')),
  source              text NOT NULL DEFAULT 'split' CHECK (source IN ('split','document','scan')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (document_id IS NOT NULL OR receipt_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_split_receipts_bill ON split_bill_receipts(split_bill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_split_receipts_document ON split_bill_receipts(document_id) WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_split_receipts_bill_document_unique
  ON split_bill_receipts(split_bill_id, document_id) WHERE document_id IS NOT NULL;

ALTER TABLE split_bill_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_receipts_select" ON split_bill_receipts FOR SELECT USING (
  split_bill_id IN (SELECT id FROM split_bills WHERE organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
);
CREATE POLICY "split_receipts_insert" ON split_bill_receipts FOR INSERT WITH CHECK (
  split_bill_id IN (SELECT id FROM split_bills WHERE organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
);
CREATE POLICY "split_receipts_update" ON split_bill_receipts FOR UPDATE USING (
  split_bill_id IN (SELECT id FROM split_bills WHERE organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
);
CREATE POLICY "split_receipts_delete" ON split_bill_receipts FOR DELETE USING (
  split_bill_id IN (SELECT id FROM split_bills WHERE organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON split_bill_receipts TO authenticated;
