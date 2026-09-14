-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822130000_trip_item_money_alignment.sql
--
-- Makes trip_itinerary_items state money the SAME WAY trip_expenses already
-- does. The previous migration (20260822120000) got it backwards.
--
-- trip_expenses (073_trip_multi_currency.sql) settled this question:
--
--     amount               the figure as actually charged, in `currency`
--     currency             what was charged (JPY)
--     exchange_rate        1 unit of `currency` = this many base units
--     amount_base_currency amount × exchange_rate — what settlement uses
--
-- 20260822120000 introduced `amount_original` / `currency_original` on the
-- itinerary instead, which inverts it: there, `amount` was the CONVERTED
-- figure. Two sibling tables, joined by expense_id, disagreeing about what the
-- column called `amount` means — one row would read ¥35,600 and its linked
-- expense ฿8,544 from the identically-named column.
--
-- That is not a hypothetical. The whole receipt-pipeline effort this month came
-- down to two pieces of code holding different ideas about the same figure and
-- each staying internally consistent while doing it. Renaming three columns now
-- is much cheaper than the report that quietly sums yen and baht together
-- later.
--
-- Safe to run against the seeded data: the only rows that exist were written
-- minutes ago by seed-japan-trip.ts, and it is re-run afterwards.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE trip_itinerary_items
  ADD COLUMN IF NOT EXISTS exchange_rate        numeric(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_base_currency numeric(14,2);

-- Move any existing rows onto the new convention before the old columns go.
-- Rows written by 20260822120000's convention have the CONVERTED value in
-- `amount` and the original in `amount_original`; swap them back.
UPDATE trip_itinerary_items
   SET amount_base_currency = amount,
       amount               = COALESCE(amount_original, amount),
       currency             = COALESCE(currency_original, currency),
       exchange_rate        = CASE
                                WHEN amount_original IS NULL OR amount_original = 0 THEN 1
                                ELSE ROUND(amount / amount_original, 6)
                              END
 WHERE amount_original IS NOT NULL;

-- Rows that never had an original are single-currency: base = amount, rate 1.
UPDATE trip_itinerary_items
   SET amount_base_currency = amount
 WHERE amount_base_currency IS NULL;

ALTER TABLE trip_itinerary_items
  ALTER COLUMN amount_base_currency SET NOT NULL,
  ALTER COLUMN amount_base_currency SET DEFAULT 0;

ALTER TABLE trip_itinerary_items
  DROP COLUMN IF EXISTS amount_original,
  DROP COLUMN IF EXISTS currency_original;

COMMENT ON COLUMN trip_itinerary_items.amount IS
  'Cost as actually charged, in `currency`. Mirrors trip_expenses.amount exactly — do not put a converted figure here.';
COMMENT ON COLUMN trip_itinerary_items.currency IS
  'Currency this item was paid in (e.g. JPY). Mirrors trip_expenses.currency.';
COMMENT ON COLUMN trip_itinerary_items.exchange_rate IS
  '1 unit of `currency` = this many units of life_journeys.base_currency. Always populated (1.0 when they match).';
COMMENT ON COLUMN trip_itinerary_items.amount_base_currency IS
  'amount × exchange_rate — the trip base-currency figure. This is the ONLY column safe to SUM across a trip.';
