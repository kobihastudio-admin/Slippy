-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822120000_trip_journey_structure.sql
--
-- Makes the Journey UI (web/src/components/trips/trip-journey-design.tsx) run
-- on real data instead of hard-coded arrays, and gives a trip somewhere to put
-- the things a trip is actually made of: flights, hotels, trains, the
-- shinkansen, a ferry, a rental car, restaurants, activities.
--
-- WHY THE EXISTING TABLES WERE NOT ENOUGH
-- `trip_itinerary_items` (049, re-pointed at life_journeys in 074) already had
-- the right shape — a day, an order, a time, a title, a place, an amount — so
-- this extends it rather than adding a parallel "bookings" table. One timeline
-- is the whole point: the Itinerary tab, the Map tab and the Budget tab are
-- three readings of the same rows, and a second table would force every one of
-- them to UNION two sources and keep them in sync.
--
-- What it was missing:
--
--   1. TYPE was too coarse. 'transport' covered a 6-hour flight, a 40-minute
--      shinkansen leg and a taxi. They need different icons, different fields
--      and different map treatment, so they become different types.
--
--   2. NO COORDINATES. Items had `location` as free text, which a map cannot
--      draw. And a transport leg has TWO ends — Fukuoka→Hiroshima is a line,
--      not a pin — so there is a start and an end pair.
--
--   3. TIME COULD NOT CROSS MIDNIGHT. `time_from`/`time_to` are `time`, so an
--      overnight ferry arriving 05:40 the next morning reads as going
--      backwards in time. `starts_at`/`ends_at` are timestamptz and can also
--      carry the departure/arrival timezone difference that makes an
--      international flight's duration correct.
--
--   4. NOWHERE TO PUT WHAT MAKES A BOOKING A BOOKING. A flight number, a seat,
--      a platform, a pier, a room type, a pickup branch, a plate number — one
--      column each would be 20 mostly-null columns, so they live in `details`
--      jsonb, and the four that EVERY booking has (who provided it, the
--      confirmation code, what it cost, whether it is actually booked) are
--      real columns because those are the ones you filter and total on.
--
--   5. NO LINK TO THE MONEY. This is the one that matters system-wide.
--      `expense_id` ties an itinerary item to the trip_expenses row that paid
--      for it, and trip_expenses already carries `document_id` — so a receipt
--      scanned through the OCR pipeline reaches the map pin it belongs to:
--
--        documents → trip_expenses → trip_itinerary_items → the map
--
--      That chain is the Life Graph this product is described as (CLAUDE.md);
--      without it a trip's spending and a trip's plan are two unrelated lists
--      that happen to be on the same screen.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Itinerary items: the concrete kinds of thing a trip is made of ───────
-- Dropped and re-added rather than widened in place: the old constraint has no
-- name we can rely on across environments, and the value set is small enough
-- to state completely. Old values all survive, so no existing row is orphaned.
ALTER TABLE trip_itinerary_items DROP CONSTRAINT IF EXISTS trip_itinerary_items_type_check;
ALTER TABLE trip_itinerary_items ADD CONSTRAINT trip_itinerary_items_type_check
  CHECK (type IN (
    -- places you go
    'activity', 'restaurant', 'meal', 'hotel', 'shopping', 'onsen',
    -- ways you get there — each draws its own icon and its own detail line
    'flight', 'train', 'shinkansen', 'ferry', 'bus', 'subway',
    'car_rental', 'taxi', 'walk', 'transport',
    -- everything else
    'booking', 'note', 'free_time', 'other'
  ));

ALTER TABLE trip_itinerary_items
  -- The line under the title: "JL 34 · BKK → FUK", "Nozomi 41 · car 8 seat 3D".
  ADD COLUMN IF NOT EXISTS subtitle          text,
  -- planned  = an idea, not booked yet     confirmed = paid/ticketed
  -- optional = go only if there is time    cancelled = kept for the record
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'planned',
  -- Airline, hotel chain, rail operator, rental company.
  ADD COLUMN IF NOT EXISTS provider          text,
  ADD COLUMN IF NOT EXISTS confirmation_code text,
  -- What it cost, in what was actually charged. `amount` stays the trip's base
  -- currency (multi-currency arrived in 073) so totals never have to convert on
  -- read; the original pair is kept because a JPY receipt should still show JPY.
  ADD COLUMN IF NOT EXISTS currency          text NOT NULL DEFAULT 'THB',
  ADD COLUMN IF NOT EXISTS amount_original   numeric(14,2),
  ADD COLUMN IF NOT EXISTS currency_original text,
  -- Where it is. For transport these are the DEPARTURE end.
  ADD COLUMN IF NOT EXISTS lat               double precision,
  ADD COLUMN IF NOT EXISTS lng               double precision,
  -- The arrival end — null for anything that happens in one place.
  ADD COLUMN IF NOT EXISTS end_location      text,
  ADD COLUMN IF NOT EXISTS end_lat           double precision,
  ADD COLUMN IF NOT EXISTS end_lng           double precision,
  -- Absolute times. time_from/time_to stay for rows that only ever had a
  -- wall-clock time and for the simple "08:30" the day view prints.
  ADD COLUMN IF NOT EXISTS starts_at         timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at           timestamptz,
  -- Mode-specific: flight_number, seat, terminal, gate, platform, car_no, pier,
  -- vessel, room_type, guests, pickup_branch, plate, cuisine, rating…
  ADD COLUMN IF NOT EXISTS details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The money link — see the header. ON DELETE SET NULL: deleting an expense
  -- must not delete the plan, only the fact that it was paid.
  ADD COLUMN IF NOT EXISTS expense_id        uuid REFERENCES trip_expenses(id) ON DELETE SET NULL;

ALTER TABLE trip_itinerary_items DROP CONSTRAINT IF EXISTS trip_itinerary_items_status_check;
ALTER TABLE trip_itinerary_items ADD CONSTRAINT trip_itinerary_items_status_check
  CHECK (status IN ('planned', 'confirmed', 'optional', 'cancelled'));

COMMENT ON COLUMN trip_itinerary_items.details IS
  'Mode-specific fields that would otherwise be 20 mostly-null columns. Read it defensively — nothing enforces its shape.';
COMMENT ON COLUMN trip_itinerary_items.expense_id IS
  'The trip_expenses row that paid for this. Combined with trip_expenses.document_id this is what connects a scanned receipt to the place it was spent.';
COMMENT ON COLUMN trip_itinerary_items.amount IS
  'Cost in the trip base currency (life_journeys.base_currency). amount_original/currency_original hold what was actually charged.';

-- The map and the timeline are the two ways this table is read.
CREATE INDEX IF NOT EXISTS idx_tii_geo     ON trip_itinerary_items (lat, lng) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tii_expense ON trip_itinerary_items (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tii_starts  ON trip_itinerary_items (starts_at);

-- ── 2. Days get a city ──────────────────────────────────────────────────────
-- The day strip shows "Day 3 · 22 พ.ย. · Hiroshima". That was being parsed out
-- of `title` ("Hiroshima Day 1"), which breaks the moment a day is titled
-- anything descriptive.
ALTER TABLE trip_itinerary_days
  ADD COLUMN IF NOT EXISTS city     text,
  ADD COLUMN IF NOT EXISTS summary  text;

-- ── 3. Checklist ────────────────────────────────────────────────────────────
-- The "More → Notes & checklists" screen. Trip-scoped rather than day-scoped:
-- "passport", "pocket wifi", "JR pass" belong to the trip, not to a morning.
CREATE TABLE IF NOT EXISTS trip_checklist_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id     uuid NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  -- Who it is for. NULL = the whole group, which is the common case.
  participant_id uuid REFERENCES trip_participants(id) ON DELETE CASCADE,
  title          text NOT NULL,
  category       text DEFAULT 'general',
  is_done        bool NOT NULL DEFAULT false,
  done_at        timestamptz,
  sort_order     int  NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tci_journey ON trip_checklist_items (journey_id, sort_order);

-- ── 4. Notes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id  uuid NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text,
  tag         text,
  is_pinned   bool NOT NULL DEFAULT false,
  created_by  uuid REFERENCES trip_participants(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tn_journey ON trip_notes (journey_id, is_pinned DESC, created_at DESC);

-- ── 5. RLS on the two new tables ────────────────────────────────────────────
-- Participant-scoped, matching 094 and getTripAccess(): a trip belongs to
-- whoever is actually on it. Written as one shared predicate so the two tables
-- cannot drift apart the way the org-scoped policies did.
ALTER TABLE trip_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_notes           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tci_participant" ON trip_checklist_items;
CREATE POLICY "tci_participant" ON trip_checklist_items FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys WHERE user_id = auth.uid()
    UNION
    SELECT journey_id FROM trip_participants WHERE user_id = auth.uid() AND left_at IS NULL
  )
);

DROP POLICY IF EXISTS "tn_participant" ON trip_notes;
CREATE POLICY "tn_participant" ON trip_notes FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys WHERE user_id = auth.uid()
    UNION
    SELECT journey_id FROM trip_participants WHERE user_id = auth.uid() AND left_at IS NULL
  )
);
