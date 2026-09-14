-- ═══════════════════════════════════════════════════════════════════════════
-- 060_trip_expense_split_modes.sql
-- Multi-payer trip splitting: each trip_expenses row already supports its own
-- payer (paid_by_id, since 030) but only "equal"/"individual"/"exclude" split
-- modes existed, and "individual" had no way to actually carry the per-person
-- input values — the UI never sent them. This adds:
--   1. 'percent' and 'shares' split modes (ระบุเปอร์เซ็นต์ / ตามจำนวนหุ้น)
--   2. trip_expenses.split_values — the raw per-participant input (exact
--      amount / percent / share count, depending on split_mode) so an expense
--      can be edited later without losing the original intent — the *computed*
--      per-person amount still lives in expense_splits.amount as before.
--   3. A corrected calculate_trip_settlement() — the original (030) cross-
--      joined every debtor × creditor without decrementing balances as it
--      went, so with 3+ participants it could double-count or produce a
--      transfer plan that doesn't actually zero out everyone's balance.
--      Rewritten as a standard greedy min-cash-flow sweep.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE trip_expenses DROP CONSTRAINT IF EXISTS trip_expenses_split_mode_check;
ALTER TABLE trip_expenses ADD CONSTRAINT trip_expenses_split_mode_check
  CHECK (split_mode IN ('equal', 'individual', 'percent', 'shares', 'exclude'));
ALTER TABLE trip_expenses
  ADD COLUMN IF NOT EXISTS split_values jsonb DEFAULT '{}';
COMMENT ON COLUMN trip_expenses.split_values IS
  'Raw per-participant input keyed by trip_participants.id (as text), meaning depends on split_mode: individual=exact amount, percent=0-100, shares=share count. Not used for equal/exclude. The resolved per-person amount actually owed is in expense_splits.amount.';
CREATE OR REPLACE FUNCTION calculate_trip_settlement(p_journey_id uuid)
RETURNS TABLE (
  from_name  text,
  to_name    text,
  amount     numeric,
  from_id    uuid,
  to_id      uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_rec        record;
  v_d          jsonb := '[]';
  v_c          jsonb := '[]';
  v_di         int := 1;
  v_ci         int := 1;
  v_d_count    int;
  v_c_count    int;
  v_d_id       uuid;
  v_d_name     text;
  v_d_bal      numeric;
  v_c_id       uuid;
  v_c_name     text;
  v_c_bal      numeric;
  v_settled    numeric;
BEGIN
  -- ── Net balance per participant: (+) others owe them, (-) they owe others ──
  FOR v_rec IN
    SELECT
      p.id,
      p.display_name,
      COALESCE(SUM(CASE WHEN te.paid_by_id = p.id THEN es.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN es.participant_id = p.id AND te.paid_by_id != p.id THEN es.amount ELSE 0 END), 0)
        AS balance
    FROM trip_participants p
    LEFT JOIN expense_splits es ON es.participant_id = p.id
    LEFT JOIN trip_expenses  te ON te.id = es.expense_id AND te.journey_id = p_journey_id
    WHERE p.journey_id = p_journey_id
    GROUP BY p.id, p.display_name
  LOOP
    IF v_rec.balance > 0.01 THEN
      v_c := v_c || jsonb_build_object('id', v_rec.id, 'name', v_rec.display_name, 'balance', v_rec.balance);
    ELSIF v_rec.balance < -0.01 THEN
      v_d := v_d || jsonb_build_object('id', v_rec.id, 'name', v_rec.display_name, 'balance', v_rec.balance);
    END IF;
  END LOOP;

  v_d_count := jsonb_array_length(v_d);
  v_c_count := jsonb_array_length(v_c);

  -- ── Greedy min-cash-flow sweep: largest debtor pays largest creditor,
  --    settle min(|debt|, credit), advance whichever side hits zero first ──
  WHILE v_di <= v_d_count AND v_ci <= v_c_count LOOP
    v_d_id   := (v_d->(v_di - 1)->>'id')::uuid;
    v_d_name := (v_d->(v_di - 1)->>'name');
    v_d_bal  := (v_d->(v_di - 1)->>'balance')::numeric;
    v_c_id   := (v_c->(v_ci - 1)->>'id')::uuid;
    v_c_name := (v_c->(v_ci - 1)->>'name');
    v_c_bal  := (v_c->(v_ci - 1)->>'balance')::numeric;

    v_settled := LEAST(ABS(v_d_bal), v_c_bal);

    IF v_settled > 0.01 THEN
      from_name := v_d_name; to_name := v_c_name; amount := round(v_settled, 2);
      from_id := v_d_id; to_id := v_c_id;
      RETURN NEXT;
    END IF;

    v_d := jsonb_set(v_d, ARRAY[(v_di - 1)::text, 'balance'], to_jsonb(v_d_bal + v_settled));
    v_c := jsonb_set(v_c, ARRAY[(v_ci - 1)::text, 'balance'], to_jsonb(v_c_bal - v_settled));

    IF ABS((v_d->(v_di - 1)->>'balance')::numeric) <= 0.01 THEN v_di := v_di + 1; END IF;
    IF (v_c->(v_ci - 1)->>'balance')::numeric <= 0.01 THEN v_ci := v_ci + 1; END IF;
  END LOOP;
END;
$$;
