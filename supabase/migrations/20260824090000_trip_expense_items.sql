-- ═══════════════════════════════════════════════════════════════════════════
-- 20260824090000_trip_expense_items.sql
--
-- The lines on a trip expense — "which item cost what".
--
-- A trip expense has been one number and a title: "ร้านอาหาร ฿12,800". That is
-- enough to settle up and useless for everything else — you cannot see what was
-- ordered, cannot check the total against the paper, and cannot tell whose
-- dishes made up whose share.
--
-- WHY A SEPARATE TABLE FROM document_line_items
-- `document_line_items` belongs to a scanned DOCUMENT: it is what the OCR read
-- off a specific image, and it is evidence. These belong to an EXPENSE: they
-- are what somebody decided the expense consists of, and they exist whether or
-- not a receipt was ever photographed — most trip expenses are typed in by
-- hand. Scanning copies the document's lines into here as a starting point; the
-- two then diverge freely, and that is correct. Overwriting evidence with an
-- edit is how a receipt stops being a record of anything.
--
-- CURRENCY
-- `amount` is in the EXPENSE's currency (trip_expenses.currency), not the
-- trip's base. A receipt's lines are in the currency the receipt is printed in,
-- and there is exactly one conversion per expense — at the expense level, where
-- `exchange_rate` and `amount_base_currency` already live. Putting a base
-- figure on every line would mean N places for one rate to be wrong in, which
-- is precisely the shape of the bug that had iOS adding yen to baht.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trip_expense_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  uuid NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
  sort_order  int  NOT NULL DEFAULT 0,
  description text NOT NULL,
  quantity    numeric(12,3),
  unit_price  numeric(14,2),
  -- In trip_expenses.currency. See the header — deliberately not converted.
  amount      numeric(14,2) NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tei_expense ON trip_expense_items (expense_id, sort_order);

COMMENT ON TABLE trip_expense_items IS
  'Line-level breakdown of a trip expense. Seeded from document_line_items when a receipt is scanned, then owned by the user — see 20260824090000_trip_expense_items.sql.';
COMMENT ON COLUMN trip_expense_items.amount IS
  'In the parent expense''s currency, never the trip base. Conversion happens once, on trip_expenses.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Participant-scoped, matching 094 and getTripAccess(): a trip's data belongs
-- to whoever is actually on the trip, which is not the same set as the owning
-- organization's members.
ALTER TABLE trip_expense_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tei_participant" ON trip_expense_items;
CREATE POLICY "tei_participant" ON trip_expense_items FOR ALL USING (
  expense_id IN (
    SELECT e.id FROM trip_expenses e
    WHERE e.journey_id IN (
      SELECT id FROM life_journeys WHERE user_id = auth.uid()
      UNION
      SELECT journey_id FROM trip_participants
       WHERE user_id = auth.uid() AND left_at IS NULL
    )
  )
);
