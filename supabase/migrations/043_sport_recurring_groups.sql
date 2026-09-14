-- ── Migration 043: Recurring Sport Groups + Session Expenses ─────────────────
-- Lets ONE sport group represent a recurring activity (e.g. "แบดทุกวันพุธ"):
-- pick days-of-week + a default time range, and the system auto-generates
-- dated sessions (split_bills rows with sport_group_id set) for inviting
-- members. Each session tracks itemized expenses (court/shuttlecock/drinks/
-- snacks) and per-participant payment-proof slip uploads.

-- ── sport_groups: the recurring template ─────────────────────────────────────

CREATE TABLE sport_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  sport_type        text,
  recurring_days    int[] NOT NULL DEFAULT '{}',
  default_start_time time,
  default_end_time   time,
  default_venue      text,
  default_court_no   text,
  default_map_url    text,
  max_players        integer,
  share_token        text UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  line_group_id      text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_sport_groups_org ON sport_groups(organization_id, status);
ALTER TABLE sport_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sport_groups_select" ON sport_groups FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "sport_groups_insert" ON sport_groups FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "sport_groups_update" ON sport_groups FOR UPDATE
  USING (creator_id = auth.uid());
CREATE POLICY "sport_groups_delete" ON sport_groups FOR DELETE
  USING (creator_id = auth.uid());
-- ── split_bills: link a generated session back to its recurring group ────────

ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS sport_group_id uuid REFERENCES sport_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_split_bills_sport_group
  ON split_bills(sport_group_id) WHERE sport_group_id IS NOT NULL;
COMMENT ON COLUMN split_bills.sport_group_id IS
  'NULL for standalone sessions (e.g. chat /sportgroup) — set when this session was auto-generated from a recurring sport_groups template';
-- ── session_expenses: itemized per-session costs ──────────────────────────────

CREATE TABLE session_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  category      text NOT NULL,
  label         text,
  amount        numeric(10,2) NOT NULL CHECK (amount >= 0),
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_session_expenses_bill ON session_expenses(split_bill_id);
ALTER TABLE session_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_expenses_select" ON session_expenses FOR SELECT
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
CREATE POLICY "session_expenses_insert" ON session_expenses FOR INSERT
  WITH CHECK (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
CREATE POLICY "session_expenses_update" ON session_expenses FOR UPDATE
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
CREATE POLICY "session_expenses_delete" ON session_expenses FOR DELETE
  USING (split_bill_id IN (
    SELECT id FROM split_bills WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  ));
-- ── split_participants: payment-proof slip ────────────────────────────────────

ALTER TABLE split_participants
  ADD COLUMN IF NOT EXISTS payment_proof_url text;
-- ── payment-proofs storage bucket ─────────────────────────────────────────────
-- Object path convention: "{split_bill_id}/{participant_id}.{ext}" (upsert on
-- re-upload). All writes go through createAdminClient() (service role, bypasses
-- RLS) since LIFF users aren't Supabase-authenticated — no insert/update/delete
-- policies are needed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "Payment proof images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');
