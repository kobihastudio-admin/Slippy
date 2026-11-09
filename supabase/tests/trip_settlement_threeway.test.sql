-- supabase/tests/trip_settlement_threeway.test.sql
-- Does calculate_trip_settlement() settle ALL debts when 3 people share an
-- expense one person paid? LOCAL SUPABASE ONLY; rolled back at the end.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_setting('app.settings.jwt_secret', true)
       IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'Refusing to run: not a local Supabase instance.';
  END IF;
END $$;
BEGIN;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES ('f9000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'ts-a@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');
INSERT INTO organizations (id, name, slug) VALUES ('f9000000-0000-0000-0000-00000000000f', 'Settle Test Org', 'settle-test-org');
INSERT INTO life_journeys (id, organization_id, user_id, title, journey_type, trip_type)
VALUES ('f9000000-0000-0000-0000-0000000000f1', 'f9000000-0000-0000-0000-00000000000f', 'f9000000-0000-0000-0000-0000000000a1', 'ทดสอบ 3 คน', 'trip', 'travel');
INSERT INTO trip_participants (id, journey_id, display_name) VALUES
  ('f9000000-0000-0000-0000-0000000000a2', 'f9000000-0000-0000-0000-0000000000f1', 'A'),
  ('f9000000-0000-0000-0000-0000000000b2', 'f9000000-0000-0000-0000-0000000000f1', 'B'),
  ('f9000000-0000-0000-0000-0000000000c2', 'f9000000-0000-0000-0000-0000000000f1', 'C');
-- A pays 300; equal split including A's own share (what the app writes: one split row per selected participant)
INSERT INTO trip_expenses (id, journey_id, paid_by_id, title, amount, amount_base_currency)
VALUES ('f9000000-0000-0000-0000-0000000000e1', 'f9000000-0000-0000-0000-0000000000f1', 'f9000000-0000-0000-0000-0000000000a2', 'dinner', 300, 300);
INSERT INTO expense_splits (expense_id, participant_id, amount) VALUES
  ('f9000000-0000-0000-0000-0000000000e1', 'f9000000-0000-0000-0000-0000000000a2', 100),
  ('f9000000-0000-0000-0000-0000000000e1', 'f9000000-0000-0000-0000-0000000000b2', 100),
  ('f9000000-0000-0000-0000-0000000000e1', 'f9000000-0000-0000-0000-0000000000c2', 100);

DO $$
DECLARE total numeric; n int;
BEGIN
  SELECT COALESCE(sum(amount),0), count(*) INTO total, n
  FROM calculate_trip_settlement('f9000000-0000-0000-0000-0000000000f1');
  IF total = 200 AND n = 2 THEN
    RAISE NOTICE 'PASS: 3-person settlement transfers 200 in 2 transfers';
  ELSE
    RAISE EXCEPTION 'FAIL: calculate_trip_settlement transfers % in % transfer(s); correct answer is 200 (B->A 100 and C->A 100)', total, n;
  END IF;
END $$;
ROLLBACK;
\echo 'TRIP SETTLEMENT 3-WAY CHECK PASSED'
