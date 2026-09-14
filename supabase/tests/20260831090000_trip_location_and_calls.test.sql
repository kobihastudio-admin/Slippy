-- supabase/tests/20260831090000_trip_location_and_calls.test.sql
--
-- Verifies trip_location_sessions/trip_member_locations/trip_call_sessions
-- RLS actually restricts access to trip participants — mirrors the style of
-- supabase/tests/094_trip_participant_scoped_rls.test.sql (raw psql, not
-- pgTAP; RAISE NOTICE/EXCEPTION for PASS/FAIL).
--
-- Each role-switch section is wrapped in an explicit BEGIN/COMMIT: SET LOCAL
-- only takes effect for the remainder of the CURRENT transaction, and outside
-- an explicit transaction block psql auto-commits each statement individually
-- — a bare `SET LOCAL role = authenticated;` at top level would revert the
-- instant that statement finishes, silently turning every later "as X" check
-- in this file into a no-op run as the superuser (which bypasses RLS and
-- would make outsider/write checks pass for the wrong reason). Mirrors
-- 094_trip_participant_scoped_rls.test.sql's BEGIN;/COMMIT; blocks.
--
-- LOCAL SUPABASE ONLY.
--
-- Run: supabase start && supabase db reset, then:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/20260831090000_trip_location_and_calls.test.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('app.settings.jwt_secret', true)
       IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'Refusing to run: this does not look like a local Supabase CLI instance.';
  END IF;
END $$;

-- ── Setup (as postgres superuser) ───────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'member@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@test.local')
ON CONFLICT DO NOTHING;

INSERT INTO life_journeys (id, user_id, title, kind) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'RLS test trip', 'trip')
ON CONFLICT DO NOTHING;

INSERT INTO trip_participants (journey_id, user_id, left_at) VALUES
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO trip_location_sessions (id, journey_id, user_id, expires_at) VALUES
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', now() + interval '1 hour')
ON CONFLICT DO NOTHING;

INSERT INTO trip_member_locations (session_id, journey_id, user_id, latitude, longitude) VALUES
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', 13.75, 100.50)
ON CONFLICT (session_id) DO UPDATE SET latitude = EXCLUDED.latitude;

GRANT SELECT, INSERT, UPDATE, DELETE ON trip_location_sessions, trip_member_locations TO authenticated;

-- ── As the trip owner ────────────────────────────────────────────────────
-- The trip owner IS a trip participant (is_trip_participant() treats
-- life_journeys.user_id as a participant) but does NOT own the member's
-- location session/position — the case this migration's WITH CHECK split
-- exists to block. A plain `FOR ALL USING (is_trip_participant(...))` with
-- no WITH CHECK (the pre-fix bug) would let these UPDATEs silently succeed.
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM trip_location_sessions WHERE id = '55555555-5555-5555-5555-555555555555';
  IF cnt != 1 THEN RAISE EXCEPTION 'FAIL: trip owner could not see a member''s location session'; END IF;
  RAISE NOTICE 'PASS: trip owner sees a member''s location session';
END $$;

-- With tls_update requiring user_id = auth.uid(), RLS must filter this row
-- out of the UPDATE's target set entirely, leaving it unchanged — not
-- erroring, just affecting zero rows (checked via FOUND).
DO $$
BEGIN
  UPDATE trip_location_sessions SET stopped_at = now()
  WHERE id = '55555555-5555-5555-5555-555555555555';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: trip owner (not the session owner) was able to UPDATE a member''s location session'; END IF;
  RAISE NOTICE 'PASS: trip owner cannot UPDATE (stop) a member''s location session';
END $$;

DO $$
DECLARE still_null boolean;
BEGIN
  SELECT stopped_at IS NULL INTO still_null FROM trip_location_sessions WHERE id = '55555555-5555-5555-5555-555555555555';
  IF NOT still_null THEN RAISE EXCEPTION 'FAIL: a member''s location session was stopped by a non-owner write'; END IF;
  RAISE NOTICE 'PASS: the member''s session is still unstopped after the non-owner''s UPDATE attempt';
END $$;

-- Same shape, against trip_member_locations: the trip owner can SEE the
-- member's live position (tml_select is trip-scoped) but must not be able
-- to overwrite it.
DO $$
BEGIN
  UPDATE trip_member_locations SET latitude = 0, longitude = 0
  WHERE session_id = '55555555-5555-5555-5555-555555555555';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: trip owner (not the location owner) was able to UPDATE a member''s live position'; END IF;
  RAISE NOTICE 'PASS: trip owner cannot UPDATE a member''s live position';
END $$;

DO $$
DECLARE lat double precision;
BEGIN
  SELECT latitude INTO lat FROM trip_member_locations WHERE session_id = '55555555-5555-5555-5555-555555555555';
  IF lat != 13.75 THEN RAISE EXCEPTION 'FAIL: a member''s live position was overwritten by a non-owner write'; END IF;
  RAISE NOTICE 'PASS: the member''s live position is unchanged after the non-owner''s UPDATE attempt';
END $$;
COMMIT;

-- ── As the member (the actual session/location owner) ───────────────────
-- Confirms tls_update/tml_update aren't accidentally locked out entirely —
-- the owner can still update (stop) their own session.
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

DO $$
BEGIN
  UPDATE trip_location_sessions SET stopped_at = now()
  WHERE id = '55555555-5555-5555-5555-555555555555';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: the session owner could not UPDATE (stop) their own location session'; END IF;
  RAISE NOTICE 'PASS: the session owner can stop their own location session';
END $$;
COMMIT;

-- ── As an outsider (not on the trip) ────────────────────────────────────
BEGIN;
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM trip_location_sessions WHERE id = '55555555-5555-5555-5555-555555555555';
  IF cnt != 0 THEN RAISE EXCEPTION 'FAIL: an outsider could see this trip''s location session'; END IF;

  SELECT count(*) INTO cnt FROM trip_member_locations WHERE session_id = '55555555-5555-5555-5555-555555555555';
  IF cnt != 0 THEN RAISE EXCEPTION 'FAIL: an outsider could see this trip''s member location'; END IF;

  RAISE NOTICE 'PASS: an outsider sees neither the session nor the location';
END $$;

-- An outsider cannot forge a write for a trip they are not on either
-- (WITH CHECK on tls_insert requires is_trip_participant(journey_id), not
-- just user_id = auth.uid()). The inner BEGIN/EXCEPTION is a plpgsql
-- sub-block (implemented via a savepoint), not a SQL transaction — it
-- unwinds just the failed INSERT, leaving this DO block's outer, already-
-- open transaction intact for the COMMIT below.
DO $$
BEGIN
  BEGIN
    INSERT INTO trip_location_sessions (id, journey_id, user_id, expires_at)
    VALUES ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
            '33333333-3333-3333-3333-333333333333', now() + interval '1 hour');
    RAISE EXCEPTION 'FAIL: an outsider was able to INSERT a location session for a trip they are not on';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS: an outsider cannot INSERT a location session for a trip they are not on';
  END;
END $$;
COMMIT;

-- ── expires_at bound (back to the postgres superuser — a plain constraint
-- check, not RLS, so it applies regardless of role) ─────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO trip_location_sessions (journey_id, user_id, started_at, expires_at)
    VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
            now(), now() + interval '25 hours');
    RAISE EXCEPTION 'FAIL: a session with expires_at more than 24 hours past started_at was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: a session with expires_at more than 24 hours past started_at is rejected';
  END;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'ALL LOCATION/CALL RLS TESTS PASSED';
END $$;
