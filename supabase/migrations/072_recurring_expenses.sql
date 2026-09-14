-- ═══════════════════════════════════════════════════════════════════════════
-- 072_recurring_expenses.sql
-- Recurring expenses for trips/shared groups (rent, internet, subscriptions
-- split with roommates etc.) — a template that auto-generates a real
-- `trip_expenses` row on schedule, same as Splitwise's recurring expenses.
--
-- Deliberately does NOT duplicate the split-calculation logic here in SQL —
-- resolveExpenseSplits()/recalculateTripOwed() already live in
-- web/src/lib/trip-settlement.ts and are the one place that logic should
-- exist. The generator (web/src/app/api/trips/recurring/run/route.ts) calls
-- back into that same code, so a recurring expense is computed identically
-- to one a person adds by hand — this table only stores the template + the
-- schedule, not any pre-computed split amounts.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recurring_expense_templates (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid    NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  paid_by_id    uuid    NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  title         text    NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  category      text,
  split_mode    text    NOT NULL DEFAULT 'equal'
    CHECK (split_mode IN ('equal', 'individual', 'percent', 'shares')),
  split_values  jsonb   DEFAULT '{}',   -- same shape as trip_expenses.split_values (060)
  -- Schedule
  interval_unit  text   NOT NULL CHECK (interval_unit IN ('weekly', 'monthly', 'yearly')),
  next_run_date  date   NOT NULL,
  end_date       date,                  -- NULL = repeats indefinitely
  is_active      boolean NOT NULL DEFAULT true,
  -- Bookkeeping
  last_generated_expense_id uuid REFERENCES trip_expenses(id) ON DELETE SET NULL,
  last_generated_at         timestamptz,
  created_by     uuid    REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ret_journey ON recurring_expense_templates(journey_id);
CREATE INDEX IF NOT EXISTS idx_ret_due ON recurring_expense_templates(next_run_date)
  WHERE is_active = true;
COMMENT ON TABLE recurring_expense_templates IS
  'Template for auto-generating trip_expenses on a schedule (rent, internet,
   subscriptions). next_run_date advances each time generate_due fires and
   creates an expense; is_active=false pauses without deleting history.';
ALTER TABLE recurring_expense_templates ENABLE ROW LEVEL SECURITY;
-- Same access pattern as trip_expenses (030_trip_management.sql) — org
-- member of the journey's organization.
CREATE POLICY "ret_org_member" ON recurring_expense_templates FOR ALL USING (
  journey_id IN (
    SELECT id FROM life_journeys
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
);
CREATE TRIGGER recurring_expense_templates_updated_at
  BEFORE UPDATE ON recurring_expense_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
