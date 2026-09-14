-- supabase/migrations/20260831090000_trip_location_and_calls.sql
--
-- Adds the schema for docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md
-- §4: temporary opt-in live location sharing, and voice calling via LiveKit.
--
-- RLS reuses is_trip_participant(journey_id) from
-- 094_trip_participant_scoped_rls.sql rather than redefining the membership
-- check — a trip's location/call data should be visible to exactly the same
-- people who can already see its itinerary.
--
-- trip_member_locations retains only the LATEST position per session
-- (session_id is its own primary key, every write is an upsert) — per the
-- spec's "no location history" rule. A stale row is swept by the cleanup
-- job below, not by ever accumulating a second row per session.

CREATE TABLE trip_location_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id  uuid NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  stopped_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Bounds how far a client can push its own expiry — without this, a
  -- client-supplied expires_at could keep a "temporary" share alive
  -- indefinitely, defeating the opt-in/temporary guarantee in §2 of the spec.
  CONSTRAINT trip_location_sessions_expiry_bound CHECK (expires_at <= started_at + interval '24 hours')
);

CREATE INDEX trip_location_sessions_journey_idx ON trip_location_sessions(journey_id);

-- RLS: SELECT stays trip-scoped (anyone on the trip can see who's sharing),
-- but every write is additionally scoped to the row's own user_id — a plain
-- `FOR ALL USING (is_trip_participant(...))` with no WITH CHECK let ANY trip
-- participant INSERT/UPDATE/DELETE any OTHER member's session, not just read
-- it. Split into per-command policies so each write carries its own
-- ownership check.
ALTER TABLE trip_location_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tls_select" ON trip_location_sessions FOR SELECT TO authenticated
  USING (is_trip_participant(journey_id));

CREATE POLICY "tls_insert" ON trip_location_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE POLICY "tls_update" ON trip_location_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_trip_participant(journey_id))
  WITH CHECK (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE POLICY "tls_delete" ON trip_location_sessions FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE TABLE trip_member_locations (
  session_id  uuid PRIMARY KEY REFERENCES trip_location_sessions(id) ON DELETE CASCADE,
  journey_id  uuid NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  accuracy_m  real,
  heading     real,
  speed_mps   real,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_member_locations_journey_idx ON trip_member_locations(journey_id);

-- Same split as trip_location_sessions above, and for the same reason: SELECT
-- is trip-scoped, every write additionally requires user_id = auth.uid().
ALTER TABLE trip_member_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tml_select" ON trip_member_locations FOR SELECT TO authenticated
  USING (is_trip_participant(journey_id));

CREATE POLICY "tml_insert" ON trip_member_locations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE POLICY "tml_update" ON trip_member_locations FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_trip_participant(journey_id))
  WITH CHECK (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE POLICY "tml_delete" ON trip_member_locations FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND is_trip_participant(journey_id));

CREATE TABLE trip_call_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id      uuid NOT NULL REFERENCES life_journeys(id) ON DELETE CASCADE,
  conversation_id uuid,
  room_name       text NOT NULL,
  initiator_id    uuid NOT NULL REFERENCES auth.users(id),
  status          text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE INDEX trip_call_sessions_journey_idx ON trip_call_sessions(journey_id);

-- At most one live (ringing or active) call per trip — prevents a race in
-- mintCallToken (SELECT ... WHERE status = 'ringing' ... .maybeSingle()) from
-- ever finding two rows and throwing on every future call for this trip.
CREATE UNIQUE INDEX trip_call_sessions_one_active_per_trip ON trip_call_sessions(journey_id)
  WHERE status IN ('ringing', 'active');

-- This table is only ever written by server-side routes using the
-- service-role client (token minting needs LIVEKIT_API_SECRET, which never
-- reaches a client that could write here directly) — RLS still restricts
-- SELECT to trip participants so the web/iOS UI can read call state.
ALTER TABLE trip_call_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tcs_participant_select" ON trip_call_sessions FOR SELECT TO authenticated
  USING (is_trip_participant(journey_id));

-- ── Retention cleanup ────────────────────────────────────────────────────
-- A 1-hour grace window past expiry (not immediate deletion) so a client
-- that reconnects moments after expiry can still show "sharing ended"
-- rather than the session simply vanishing mid-request.
CREATE OR REPLACE FUNCTION public.cleanup_expired_trip_locations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM trip_location_sessions
  WHERE expires_at < now() - interval '1 hour';
$$;
REVOKE ALL ON FUNCTION public.cleanup_expired_trip_locations() FROM PUBLIC;

SELECT cron.schedule(
  'cleanup-expired-trip-locations',
  '*/5 * * * *',
  $$SELECT public.cleanup_expired_trip_locations();$$
);
