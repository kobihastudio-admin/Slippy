-- ═══════════════════════════════════════════════════════════════════════════
-- 073_trip_multi_currency.sql
-- Multi-currency trip expenses (e.g. a Japan trip where some receipts are
-- JPY, others THB) — each expense keeps its original amount + currency for
-- display, but is ALSO converted to the trip's base_currency at save time so
-- the existing settlement math (calculate_trip_settlement, expense_splits,
-- trip_participants.amount_owed/amount_paid) keeps working entirely in one
-- currency without any changes — only trip_expenses gains new columns, the
-- money-movement logic downstream of it is untouched.
--
-- Rate resolution (done in application code, see web/src/lib/exchange-
-- rates.ts): default = historical rate for the expense's date, fetched from
-- a free API and cached in exchange_rates below; can be overridden manually
-- per expense (e.g. the actual rate the person's card was charged at,
-- which rarely matches the day's market rate exactly).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Trip-level base currency ─────────────────────────────────────────────
ALTER TABLE life_journeys
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'THB';
COMMENT ON COLUMN life_journeys.base_currency IS
  'The currency settlement amounts (expense_splits, trip_participants.amount_owed/paid) are computed in. Individual expenses can be entered in a different currency — see trip_expenses.currency.';
-- ── 2. Per-expense currency + conversion ────────────────────────────────────
ALTER TABLE trip_expenses
  ADD COLUMN IF NOT EXISTS currency              text    NOT NULL DEFAULT 'THB',
  ADD COLUMN IF NOT EXISTS exchange_rate         numeric(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_base_currency  numeric(14,2),
  ADD COLUMN IF NOT EXISTS rate_is_manual        boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN trip_expenses.currency IS
  'Currency the expense was actually entered/paid in (e.g. JPY). Defaults to the trip''s base_currency.';
COMMENT ON COLUMN trip_expenses.exchange_rate IS
  '1 unit of `currency` = this many units of the trip''s base_currency. Always populated (1.0 when currency = base_currency) so the record is self-contained even if market rates move later.';
COMMENT ON COLUMN trip_expenses.amount_base_currency IS
  'amount * exchange_rate, rounded — the figure actually fed into expense_splits/settlement. `amount` itself stays in the original `currency` for display.';
COMMENT ON COLUMN trip_expenses.rate_is_manual IS
  'true when the user typed the exchange rate themselves (e.g. their card''s actual charged rate) instead of using the auto-fetched historical rate.';
-- Backfill existing rows: same currency as base, rate 1, amount_base = amount
UPDATE trip_expenses SET amount_base_currency = amount WHERE amount_base_currency IS NULL;
ALTER TABLE trip_expenses ALTER COLUMN amount_base_currency SET NOT NULL;
-- ── 3. Historical exchange-rate cache ───────────────────────────────────────
-- Avoids re-hitting the external rate API for the same date+pair repeatedly
-- (many trip expenses on the same day share a rate).
CREATE TABLE IF NOT EXISTS exchange_rates (
  rate_date      date    NOT NULL,
  from_currency  text    NOT NULL,
  to_currency    text    NOT NULL,
  rate           numeric(14,6) NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, from_currency, to_currency)
);
COMMENT ON TABLE exchange_rates IS
  'Cache of historical FX rates by date, so multiple expenses on the same trip/day don''t each hit the external rate API. Populated lazily on first lookup, not backfilled in bulk.';
-- Public read — exchange rates aren't sensitive and every org benefits from
-- a shared cache (no per-org scoping needed).
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rates_public_read" ON exchange_rates FOR SELECT USING (true);
