-- ═══════════════════════════════════════════════════════════════════════════
-- 074_itinerary_and_preorder.sql
--
-- Part 1 — Itinerary: trip_itinerary_days/items (049_scan_trip_community.sql)
-- already had everything needed (day/activity/meal/transport/hotel/booking,
-- location, time, notes, amount) but was wired to `split_bills` — the older
-- single-payer bill system — via split_bill_id, never to `life_journeys`
-- (the multi-payer trip system this session's work has all been built on:
-- multi-currency, recurring expenses, etc). Re-pointing at journey_id
-- instead of building new tables from scratch, since the schema was already
-- right for this. split_bill_id stays (nullable) for any pre-existing rows
-- rather than deleting data outright.
--
-- Part 2 — Pre-order: a shared order/shopping list where EACH PARTICIPANT
-- adds their own items (self-service — "I'm getting the pad thai, ฿60"),
-- instead of one person typing the whole bill and assigning it to others.
-- Closing a session converts it into one real trip_expenses row (split_mode
-- = 'individual', each person's share = what they themselves added) via the
-- same createTripExpense() the rest of the trip system already uses — no
-- new settlement logic, this only feeds the existing one.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Itinerary → journey_id ───────────────────────────────────────────────
ALTER TABLE trip_itinerary_days
  ALTER COLUMN split_bill_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS journey_id uuid REFERENCES life_journeys(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_day_journey_uniq
  ON trip_itinerary_days(journey_id, day_number) WHERE journey_id IS NOT NULL;
COMMENT ON COLUMN trip_itinerary_days.journey_id IS
  'The active trip system (life_journeys) this day belongs to. split_bill_id is legacy — new rows use journey_id only.';
-- RLS for the journey_id path — mirrors trip_expenses' policy (030_trip_management.sql)
DROP POLICY IF EXISTS "tid_org_member" ON trip_itinerary_days;
CREATE POLICY "tid_org_member" ON trip_itinerary_days FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
DROP POLICY IF EXISTS "tii_org_member" ON trip_itinerary_items;
CREATE POLICY "tii_org_member" ON trip_itinerary_items FOR ALL USING (
  day_id IN (
    SELECT id FROM trip_itinerary_days
    WHERE journey_id IN (
      SELECT id FROM life_journeys
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  )
);
ALTER TABLE trip_itinerary_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_itinerary_items ENABLE ROW LEVEL SECURITY;
-- ── 2. Pre-order sessions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preorder_sessions (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   uuid    NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  title        text    NOT NULL,
  kind         text    NOT NULL DEFAULT 'food'
    CHECK (kind IN ('food', 'shopping')),
  status       text    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  paid_by_id   uuid    REFERENCES trip_participants(id) ON DELETE SET NULL,   -- who fronted the money
  expense_id   uuid    REFERENCES trip_expenses(id) ON DELETE SET NULL,       -- set once closed
  created_by   uuid    REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_preorder_journey ON preorder_sessions(journey_id);
COMMENT ON TABLE preorder_sessions IS
  'A round of "everyone add what you''re ordering" — closes into exactly one trip_expenses row via createTripExpense(), split_mode=individual, each person''s share = sum of their own preorder_items.';
CREATE TABLE IF NOT EXISTS preorder_items (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid    NOT NULL REFERENCES preorder_sessions(id) ON DELETE CASCADE,
  participant_id uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  name           text    NOT NULL,
  price          numeric(14,2) NOT NULL CHECK (price > 0),
  qty            int     NOT NULL DEFAULT 1 CHECK (qty > 0),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preorder_items_session ON preorder_items(session_id);
ALTER TABLE preorder_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE preorder_items    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preorder_sessions_org_member" ON preorder_sessions FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "preorder_items_org_member" ON preorder_items FOR ALL USING (
  session_id IN (
    SELECT id FROM preorder_sessions
    WHERE journey_id IN (
      SELECT id FROM life_journeys
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  )
);
