-- supabase/tests/friend_balances.test.sql
--
-- Verifies public.friend_balances() (migration 20261109120000): source rules,
-- friends-only scoping, mirrored views, LINE read-time linking, and access.
-- LOCAL SUPABASE ONLY (refuses anything else). Everything runs in one
-- transaction that is rolled back at the end.
--
-- Run: supabase start && supabase db reset, then:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/friend_balances.test.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('app.settings.jwt_secret', true)
       IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'Refusing to run: this does not look like a local Supabase CLI instance. This script seeds fake auth.users and must never touch a real project.';
  END IF;
END $$;

BEGIN;

-- ── Users: A = "me", B, C = friends, D = stranger ───────────────────────────
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('f8000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'bal-a@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'bal-b@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'bal-c@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'bal-d@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-000000000000', 'bal-e@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO organizations (id, name, slug) VALUES ('f8000000-0000-0000-0000-00000000000f', 'Balance Test Org', 'balance-test-org');

-- A–B accepted (A requested); C–A accepted (C requested). D is nobody's friend.
INSERT INTO friendships (requester_id, addressee_id, status) VALUES
  ('f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 'accepted'),
  ('f8000000-0000-0000-0000-0000000000c1', 'f8000000-0000-0000-0000-0000000000a1', 'accepted'),
  ('f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000e0', 'pending');   -- E: friendship not accepted yet

-- C has connected LINE (read-time linking of participants that carry only a LINE id)
INSERT INTO line_connections (line_user_id, user_id, organization_id)
VALUES ('Ubal_line_c', 'f8000000-0000-0000-0000-0000000000c1', 'f8000000-0000-0000-0000-00000000000f');

-- ── b1: receipt bill, creator A pays 300 (single receipt payer = A's row) ────
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount)
VALUES ('f8000000-0000-0000-0000-0000000000e1', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'ข้าวเย็น', 300);
INSERT INTO split_participants (id, split_bill_id, name, amount, paid_at, user_id, line_user_id) VALUES
  ('f8000000-0000-0000-0000-000000000e11', 'f8000000-0000-0000-0000-0000000000e1', 'A', 100, NULL,  'f8000000-0000-0000-0000-0000000000a1', NULL),          -- payer's own row: excluded
  ('f8000000-0000-0000-0000-000000000e12', 'f8000000-0000-0000-0000-0000000000e1', 'B', 100, NULL,  'f8000000-0000-0000-0000-0000000000b1', NULL),          -- B owes A 100
  ('f8000000-0000-0000-0000-000000000e13', 'f8000000-0000-0000-0000-0000000000e1', 'C-paid', 100, now(), 'f8000000-0000-0000-0000-0000000000c1', NULL),     -- already paid: excluded
  ('f8000000-0000-0000-0000-000000000e14', 'f8000000-0000-0000-0000-0000000000e1', 'C-line', 40, NULL, NULL, 'Ubal_line_c'),                                -- no user_id, LINE-linked to C: C owes A 40
  ('f8000000-0000-0000-0000-000000000e15', 'f8000000-0000-0000-0000-0000000000e1', 'Guest', 25, NULL, NULL, NULL);                                          -- guest: excluded
INSERT INTO split_bill_receipts (split_bill_id, paid_by_participant_id, receipt_url, amount)
VALUES ('f8000000-0000-0000-0000-0000000000e1', 'f8000000-0000-0000-0000-000000000e11', 'x', 300);

-- ── b2: sport session, creator B, no receipts → B is the payer ──────────────
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount, category)
VALUES ('f8000000-0000-0000-0000-0000000000e2', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000b1', 'แบดมินตัน', 120, 'sport');
INSERT INTO split_participants (split_bill_id, name, amount, user_id) VALUES
  ('f8000000-0000-0000-0000-0000000000e2', 'B host', 60, 'f8000000-0000-0000-0000-0000000000b1'),   -- host's own row: excluded
  ('f8000000-0000-0000-0000-0000000000e2', 'A',      60, 'f8000000-0000-0000-0000-0000000000a1');  -- A owes B 60

-- ── b3: two different receipt payers → payer undeterminable (unattributed) ──
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount)
VALUES ('f8000000-0000-0000-0000-0000000000e3', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000c1', 'ทริปวันเสาร์', 100);
INSERT INTO split_participants (id, split_bill_id, name, amount, user_id) VALUES
  ('f8000000-0000-0000-0000-000000000e31', 'f8000000-0000-0000-0000-0000000000e3', 'A', 50, 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000e32', 'f8000000-0000-0000-0000-0000000000e3', 'C', 50, 'f8000000-0000-0000-0000-0000000000c1');
INSERT INTO split_bill_receipts (split_bill_id, paid_by_participant_id, receipt_url, amount) VALUES
  ('f8000000-0000-0000-0000-0000000000e3', 'f8000000-0000-0000-0000-000000000e31', 'x', 60),
  ('f8000000-0000-0000-0000-0000000000e3', 'f8000000-0000-0000-0000-000000000e32', 'x', 40);

-- ── b4: stranger. A hosts a sport session; D (not a friend) is linked to it ─
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount, category)
VALUES ('f8000000-0000-0000-0000-0000000000e4', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'ฟุตบอล', 25, 'sport');
INSERT INTO split_participants (split_bill_id, name, amount, user_id)
VALUES ('f8000000-0000-0000-0000-0000000000e4', 'D', 25, 'f8000000-0000-0000-0000-0000000000d1');

-- ── b5: two receipts paid by the SAME payer row → one payer. Extra cases: a duplicate
--        row for the same friend (both count) and a zero-amount row (ignored) ─────
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount)
VALUES ('f8000000-0000-0000-0000-0000000000e5', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'กาแฟ', 150);
INSERT INTO split_participants (id, split_bill_id, name, amount, user_id) VALUES
  ('f8000000-0000-0000-0000-000000000e51', 'f8000000-0000-0000-0000-0000000000e5', 'A',   100, 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000e52', 'f8000000-0000-0000-0000-0000000000e5', 'B',    30, 'f8000000-0000-0000-0000-0000000000b1'),   -- B owes A 30
  ('f8000000-0000-0000-0000-000000000e53', 'f8000000-0000-0000-0000-0000000000e5', 'B2',   20, 'f8000000-0000-0000-0000-0000000000b1'),   -- same person, second row: +20
  ('f8000000-0000-0000-0000-000000000e54', 'f8000000-0000-0000-0000-0000000000e5', 'C0',    0, 'f8000000-0000-0000-0000-0000000000c1');   -- amount 0: ignored
INSERT INTO split_bill_receipts (split_bill_id, paid_by_participant_id, receipt_url, amount) VALUES
  ('f8000000-0000-0000-0000-0000000000e5', 'f8000000-0000-0000-0000-000000000e51', 'x', 100),
  ('f8000000-0000-0000-0000-0000000000e5', 'f8000000-0000-0000-0000-000000000e51', 'x', 50);

-- ── b6: the payer appears as TWO participant rows (same person) and each pays a receipt
--        → still ONE payer by person, so B's 10 is attributed ─────────────────────
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount)
VALUES ('f8000000-0000-0000-0000-0000000000e6', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'ค่าน้ำมัน', 60);
INSERT INTO split_participants (id, split_bill_id, name, amount, user_id) VALUES
  ('f8000000-0000-0000-0000-000000000e61', 'f8000000-0000-0000-0000-0000000000e6', 'A',  25, 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000e62', 'f8000000-0000-0000-0000-0000000000e6', 'A2', 25, 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000e63', 'f8000000-0000-0000-0000-0000000000e6', 'B',  10, 'f8000000-0000-0000-0000-0000000000b1');
INSERT INTO split_bill_receipts (split_bill_id, paid_by_participant_id, receipt_url, amount) VALUES
  ('f8000000-0000-0000-0000-0000000000e6', 'f8000000-0000-0000-0000-000000000e61', 'x', 30),
  ('f8000000-0000-0000-0000-0000000000e6', 'f8000000-0000-0000-0000-000000000e62', 'x', 30);

-- ── b7: sport session hosted by A; E is linked but the friendship is only pending → no row ──
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount, category)
VALUES ('f8000000-0000-0000-0000-0000000000e7', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'บาส', 15, 'sport');
INSERT INTO split_participants (split_bill_id, name, amount, user_id)
VALUES ('f8000000-0000-0000-0000-0000000000e7', 'E', 15, 'f8000000-0000-0000-0000-0000000000e0');

-- ── b8: a receipt whose payer row belongs to ANOTHER bill (b1's A row) → payer unknown ──
INSERT INTO split_bills (id, organization_id, creator_id, title, total_amount)
VALUES ('f8000000-0000-0000-0000-0000000000e8', 'f8000000-0000-0000-0000-00000000000f', 'f8000000-0000-0000-0000-0000000000a1', 'ข้ามบิล', 5);
INSERT INTO split_participants (split_bill_id, name, amount, user_id)
VALUES ('f8000000-0000-0000-0000-0000000000e8', 'B', 5, 'f8000000-0000-0000-0000-0000000000b1');
INSERT INTO split_bill_receipts (split_bill_id, paid_by_participant_id, receipt_url, amount)
VALUES ('f8000000-0000-0000-0000-0000000000e8', 'f8000000-0000-0000-0000-000000000e11', 'x', 5);

-- ── payment requests ────────────────────────────────────────────────────────
INSERT INTO payment_requests (id, requester_id, payer_id, amount, currency, status, expires_at, split_bill_id) VALUES
  ('f8000000-0000-0000-0000-000000000a01', 'f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 80, 'THB', 'pending', now() + interval '1 day', NULL),                                       -- counts: B owes A 80
  ('f8000000-0000-0000-0000-000000000a02', 'f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 90, 'THB', 'pending', now() + interval '1 day', 'f8000000-0000-0000-0000-0000000000e1'),   -- carries a bill: never counted
  ('f8000000-0000-0000-0000-000000000a03', 'f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 70, 'THB', 'pending', now() - interval '1 hour', NULL),                                      -- expired by time
  ('f8000000-0000-0000-0000-000000000a04', 'f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 60, 'USD', 'pending', now() + interval '1 day', NULL),                                      -- not THB
  ('f8000000-0000-0000-0000-000000000a05', 'f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 50, 'THB', 'paid',    now() + interval '1 day', NULL);                                      -- already paid

-- ── helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert_num(p_label text, p_sql text, p_expect numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n numeric;
BEGIN
  EXECUTE p_sql INTO n;
  IF n IS DISTINCT FROM p_expect THEN
    RAISE EXCEPTION 'FAIL: % — expected %, got %', p_label, p_expect, n;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- A's own sums per counterpart and direction (attributed rows only)
-- usage: pg_temp.s(counterpart_suffix, direction)
CREATE OR REPLACE FUNCTION pg_temp.sum_for(p_cp text, p_dir text) RETURNS text
LANGUAGE sql AS $$
  SELECT format('SELECT COALESCE(SUM(amount),0) FROM friend_balances() WHERE attributed AND counterpart_user_id = %L AND direction = %L',
                'f8000000-0000-0000-0000-0000000000' || p_cp, p_dir)
$$;

-- ── A ("me") ───────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT pg_temp.assert_num('A: B owes A = 100 (b1) + 80 (request) + 50 (b5: 30+20, two receipts one payer) + 10 (b6: payer counted by person)', pg_temp.sum_for('b1','they_owe_me'), 240);
SELECT pg_temp.assert_num('A: b8 (receipt payer from another bill) is unattributed, not attributed',
  'SELECT count(*) FROM friend_balances() WHERE NOT attributed AND counterpart_user_id = ''f8000000-0000-0000-0000-0000000000b1''', 1);
SELECT pg_temp.assert_num('A: pending friend E never appears',
  'SELECT count(*) FROM friend_balances() WHERE counterpart_user_id = ''f8000000-0000-0000-0000-0000000000e0''', 0);
SELECT pg_temp.assert_num('A: A owes B = 60 (sport)',                 pg_temp.sum_for('b1','i_owe_them'), 60);
SELECT pg_temp.assert_num('A: C owes A = 40 (LINE-linked row, paid row excluded)', pg_temp.sum_for('c1','they_owe_me'), 40);
SELECT pg_temp.assert_num('A: nothing owed to C', pg_temp.sum_for('c1','i_owe_them'), 0);
SELECT pg_temp.assert_num('A: no row at all for stranger D',
  'SELECT count(*) FROM friend_balances() WHERE counterpart_user_id = ''f8000000-0000-0000-0000-0000000000d1''', 0);
SELECT pg_temp.assert_num('A: exactly one unattributed row (b3, counterpart C)',
  'SELECT count(*) FROM friend_balances() WHERE NOT attributed AND counterpart_user_id = ''f8000000-0000-0000-0000-0000000000c1''', 1);
SELECT pg_temp.assert_num('A: unattributed rows are never part of an attributed sum (grand attributed total = 240+60+40)',
  'SELECT COALESCE(SUM(amount),0) FROM friend_balances() WHERE attributed', 340);
SELECT pg_temp.assert_num('A: the request that carries a bill is not counted (request rows = 1)',
  'SELECT count(*) FROM friend_balances() WHERE source_kind = ''request''', 1);
SELECT pg_temp.assert_num('A: sport row has kind sport',
  'SELECT count(*) FROM friend_balances() WHERE source_kind = ''sport'' AND attributed', 1);
RESET ROLE;

-- ── B (mirror of A's B-rows) ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT pg_temp.assert_num('B: B owes A = 100 + 80 + 50 + 10', pg_temp.sum_for('a1','i_owe_them'), 240);
SELECT pg_temp.assert_num('B: A owes B = 60',       pg_temp.sum_for('a1','they_owe_me'), 60);
SELECT pg_temp.assert_num('B: sees nothing about C or D',
  'SELECT count(*) FROM friend_balances() WHERE counterpart_user_id IN (''f8000000-0000-0000-0000-0000000000c1'',''f8000000-0000-0000-0000-0000000000d1'')', 0);
RESET ROLE;

-- ── C ──────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT pg_temp.assert_num('C: C owes A = 40 (via LINE link)', pg_temp.sum_for('a1','i_owe_them'), 40);
SELECT pg_temp.assert_num('C: one unattributed row for the bill C created (counterpart A)',
  'SELECT count(*) FROM friend_balances() WHERE NOT attributed AND counterpart_user_id = ''f8000000-0000-0000-0000-0000000000a1''', 1);
RESET ROLE;

-- ── D (stranger): nothing ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT pg_temp.assert_num('D: stranger sees no rows', 'SELECT count(*) FROM friend_balances()', 0);
RESET ROLE;

-- ── E (friendship still pending): nothing ──────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000e0","role":"authenticated"}';
SELECT pg_temp.assert_num('E: pending friend sees no rows', 'SELECT count(*) FROM friend_balances()', 0);
RESET ROLE;

-- ── No session: authenticated role but no sub → nothing ────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
SELECT pg_temp.assert_num('no sub: zero rows', 'SELECT count(*) FROM friend_balances()', 0);
RESET ROLE;

-- ── anon may not execute ───────────────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM * FROM friend_balances();
  RAISE EXCEPTION 'FAIL: anon was able to execute friend_balances()';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: anon cannot execute friend_balances()';
END $$;
RESET ROLE;

-- ── Linking column exists and is nullable ──────────────────────────────────
SELECT pg_temp.assert_num('split_participants.user_id exists and is nullable',
  'SELECT count(*) FROM information_schema.columns WHERE table_name = ''split_participants'' AND column_name = ''user_id'' AND is_nullable = ''YES''', 1);

ROLLBACK;
\echo 'ALL friend_balances CHECKS PASSED'
