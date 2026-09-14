-- ─────────────────────────────────────────────────────────────────────────────
-- 022_line_split_bill.sql
-- LINE Split Bill feature
-- ─────────────────────────────────────────────────────────────────────────────

-- Add LINE user support to split_participants
ALTER TABLE split_participants
  ADD COLUMN IF NOT EXISTS line_user_id   text,       -- LINE userId if LINE user
  ADD COLUMN IF NOT EXISTS line_display   text,       -- LINE display name
  ADD COLUMN IF NOT EXISTS is_non_line    boolean NOT NULL DEFAULT false;
-- non-LINE web user

-- Add LINE group + share token to split_bills
ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS line_group_id  text,       -- LINE groupId (for group chat)
  ADD COLUMN IF NOT EXISTS share_token    text UNIQUE DEFAULT encode(gen_random_bytes(8),'hex'),
  ADD COLUMN IF NOT EXISTS vat_amount     numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','finalized'));
-- Item-level claims: who pays for which line item
CREATE TABLE IF NOT EXISTS split_item_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id   uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  line_item_id    uuid NOT NULL REFERENCES document_line_items(id) ON DELETE CASCADE,
  participant_id  uuid REFERENCES split_participants(id) ON DELETE CASCADE,
  -- OR for ad-hoc claimer (LINE user not yet a participant)
  claimer_name    text,
  claimer_line_id text,
  claimed_at      timestamptz DEFAULT now(),
  UNIQUE (split_bill_id, line_item_id)  -- one item → one claimer
);
-- RLS
ALTER TABLE split_item_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_claims_org_member"
  ON split_item_claims FOR ALL
  USING (
    split_bill_id IN (
      SELECT id FROM split_bills
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  );
-- Index
CREATE INDEX IF NOT EXISTS idx_split_claims_bill ON split_item_claims(split_bill_id);
CREATE INDEX IF NOT EXISTS idx_split_bills_token ON split_bills(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_split_parts_line   ON split_participants(line_user_id) WHERE line_user_id IS NOT NULL;
COMMENT ON TABLE split_item_claims IS 'Tracks which LINE/web participant claimed which line item in a split bill';
