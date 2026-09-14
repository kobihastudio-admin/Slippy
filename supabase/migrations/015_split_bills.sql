-- ── Migration 015: Split Bills ────────────────────────────────────────────────
-- Tables for the bill-splitting feature (หารบิล)

CREATE TABLE split_bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
  title           text NOT NULL,
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  note            text,
  created_at      timestamptz DEFAULT now()
);
CREATE TABLE split_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text,
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  paid_at       timestamptz,
  created_at    timestamptz DEFAULT now()
);
-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_split_bills_org  ON split_bills(organization_id, created_at DESC);
CREATE INDEX idx_split_parts_bill ON split_participants(split_bill_id);
-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE split_bills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_bills_select" ON split_bills FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "split_bills_insert" ON split_bills FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "split_bills_update" ON split_bills FOR UPDATE
  USING (creator_id = auth.uid());
CREATE POLICY "split_bills_delete" ON split_bills FOR DELETE
  USING (creator_id = auth.uid());
CREATE POLICY "split_parts_select" ON split_participants FOR SELECT
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
CREATE POLICY "split_parts_insert" ON split_participants FOR INSERT
  WITH CHECK (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
CREATE POLICY "split_parts_update" ON split_participants FOR UPDATE
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE split_bills        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE split_participants TO authenticated;
