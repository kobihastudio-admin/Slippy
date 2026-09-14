# Trip Live Location + Voice Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let trip members opt in to temporary, time-boxed live location sharing on the trip map, and start a voice-only group call over LiveKit — both scoped to the trip, both matching the safety/privacy rules already written into the spec.

**Architecture:** Two new Postgres tables (`trip_location_sessions`, `trip_member_locations`) reuse the participant-scoped RLS helper `is_trip_participant()` from migration `094_trip_participant_scoped_rls.sql`, so iOS writes location data directly to Supabase (same pattern as `TripItineraryAPI.swift`) while web writes go through Next.js API routes with the service-role client (same pattern as `web/src/app/api/trips/[id]/itinerary/items/route.ts`) — this mirrors how the two platforms already split responsibility for trip writes, not a new convention. Voice calling needs one new table (`trip_call_sessions`) and exactly one server-side route on both platforms, because minting a LiveKit room-join token requires `LIVEKIT_API_SECRET`, which must never reach a client — iOS calls that route the same way `TripDocumentAPI.swift` already calls web routes needing secrets (Bearer token, no direct Supabase involvement for that one call).

**Tech Stack:** Supabase Postgres + RLS + `pg_cron`; Next.js API routes; `livekit-server-sdk` (token minting) and `livekit-client` (web room connection); LiveKit's Swift SDK (`client-sdk-swift`) for iOS; existing `CLLocationManager`/`Geolocation` APIs for foreground location.

**Spec:** `docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md` (§4–§7 for this plan's scope; §12 addendum — action cams and YouTube Live — is explicitly NOT part of this plan, see the closing section below).

## Global Constraints

- No coordinate is ever transmitted before the user explicitly starts a sharing session (spec §3).
- Location sharing is foreground-only — no `NSLocationAlwaysAndWhenInUseUsageDescription`, no iOS background modes for location (spec §2, decision locked 2026-08-31).
- Supported share durations: exactly `15m`, `1h`, `4h`, `eod` (end of day, Asia/Bangkok midnight). No unlimited/forever option (spec §3).
- Only the latest position is retained per session — `trip_member_locations.session_id` is a primary key, every write is an upsert, never a new row (spec §4).
- A trip owner/admin can never start or stop another member's session — every write is scoped to `auth.uid()` (spec §3).
- Calls are voice-only for this plan — no camera/video publish anywhere in this scope (spec §2, decision locked 2026-08-31).
- No call audio is ever recorded or stored (spec §3).
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` exist only in server env vars, read only via `web/src/lib/trips/livekit-config.ts`, never in a client bundle (spec §3, already scaffolded).
- Every new API route reuses `getAuthedUser()` + `getTripAccess()` and returns the same 404-shaped "not found" for a non-member that the rest of the trip API already uses (`web/src/app/api/trips/[id]/itinerary/items/route.ts`'s `guard()`), not a 403 that would confirm the trip exists.
- Follow existing file conventions exactly: web lib modules take an injectable `db?` parameter (see `web/src/lib/medications.ts`), iOS trip API enums are `@MainActor enum ... { private static var db: SupabaseClient { SupabaseManager.shared.client } }` (see `TripItineraryAPI.swift`).

---

## Task 1: Database schema — location and call tables

**Files:**
- Create: `supabase/migrations/20260831090000_trip_location_and_calls.sql`
- Create: `supabase/tests/20260831090000_trip_location_and_calls.test.sql`

**Interfaces:**
- Produces: tables `trip_location_sessions(id, journey_id, user_id, started_at, expires_at, stopped_at, created_at)`, `trip_member_locations(session_id pk, journey_id, user_id, latitude, longitude, accuracy_m, heading, speed_mps, recorded_at)`, `trip_call_sessions(id, journey_id, conversation_id, room_name, initiator_id, status, started_at, ended_at)`. All three RLS-gated by the existing `is_trip_participant(journey_id)` function.

- [ ] **Step 1: Write the migration**

```sql
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
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_location_sessions_journey_idx ON trip_location_sessions(journey_id);

ALTER TABLE trip_location_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tls_participant" ON trip_location_sessions FOR ALL TO authenticated
  USING (is_trip_participant(journey_id));

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

ALTER TABLE trip_member_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tml_participant" ON trip_member_locations FOR ALL TO authenticated
  USING (is_trip_participant(journey_id));

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
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
cd supabase && supabase start && supabase db reset
```
Expected: migration applies with no errors; `supabase db diff` reports no drift afterward.

- [ ] **Step 3: Write the RLS test script**

```sql
-- supabase/tests/20260831090000_trip_location_and_calls.test.sql
--
-- Verifies trip_location_sessions/trip_member_locations/trip_call_sessions
-- RLS actually restricts access to trip participants — mirrors the style of
-- supabase/tests/094_trip_participant_scoped_rls.test.sql (raw psql, not
-- pgTAP; RAISE NOTICE/EXCEPTION for PASS/FAIL).
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

GRANT SELECT ON trip_location_sessions, trip_member_locations TO authenticated;

-- ── As the trip owner ────────────────────────────────────────────────────
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM trip_location_sessions WHERE id = '55555555-5555-5555-5555-555555555555';
  IF cnt != 1 THEN RAISE EXCEPTION 'FAIL: trip owner could not see a member''s location session'; END IF;
  RAISE NOTICE 'PASS: trip owner sees a member''s location session';
END $$;

-- ── As an outsider (not on the trip) ────────────────────────────────────
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

RESET role;
RAISE NOTICE 'ALL LOCATION/CALL RLS TESTS PASSED';
```

- [ ] **Step 4: Run the RLS test**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/tests/20260831090000_trip_location_and_calls.test.sql
```
Expected: three `PASS` notices, ending with `ALL LOCATION/CALL RLS TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831090000_trip_location_and_calls.sql supabase/tests/20260831090000_trip_location_and_calls.test.sql
git commit -m "feat(trips): add location sharing and call session schema

Adds trip_location_sessions/trip_member_locations/trip_call_sessions,
reusing the participant-scoped RLS helper from 094. Latest-position-only
retention with a pg_cron sweep, per the location design spec."
```

---

## Task 2: Web — location-sharing library (TDD)

**Files:**
- Create: `web/src/lib/trips/location-sharing.ts`
- Create: `web/src/lib/trips/location-sharing.test.mjs`
- Modify: `web/package.json:12-17` (add `"test:location-sharing": "node --experimental-strip-types --test src/lib/trips/location-sharing.test.mjs"`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `startLocationSession(journeyId, userId, duration, db?)`, `stopLocationSession(sessionId, userId, db?)`, `pingLocation(sessionId, userId, journeyId, point, db?)`, `activeLocationsFor(journeyId, db?)`, type `ShareDuration = "15m" | "1h" | "4h" | "eod"`. Task 3 imports all four.

- [ ] **Step 1: Write the failing tests**

```javascript
// web/src/lib/trips/location-sharing.test.mjs
import assert from "node:assert/strict"
import test from "node:test"
import { startLocationSession, stopLocationSession, pingLocation, activeLocationsFor } from "./location-sharing.ts"

function fakeDb(seed = {}) {
  const tables = {
    trip_location_sessions: seed.trip_location_sessions ?? [],
    trip_member_locations: seed.trip_member_locations ?? [],
  }
  function builder(table) {
    const filters = []
    let pendingUpdate = null
    let pendingInsert = null
    let pendingUpsertKey = null
    let single = false

    function matching() { return tables[table].filter(r => filters.every(f => f(r))) }
    function exec() {
      if (pendingUpsertKey) {
        const existing = tables[table].find(r => r[pendingUpsertKey] === pendingInsert[pendingUpsertKey])
        if (existing) Object.assign(existing, pendingInsert)
        else tables[table].push({ ...pendingInsert })
        return Promise.resolve({ data: null, error: null })
      }
      if (pendingInsert) {
        const row = { id: `${table}-${tables[table].length + 1}`, ...pendingInsert }
        tables[table].push(row)
        return Promise.resolve({ data: row, error: null })
      }
      const rows = matching()
      if (pendingUpdate) { for (const r of rows) Object.assign(r, pendingUpdate) }
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null })
    }
    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      gt(col, val) { filters.push(r => r[col] > val); return api },
      is(col, val) { filters.push(r => r[col] === val); return api },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return api },
      select() { return api },
      insert(row) { pendingInsert = row; return api },
      update(patch) { pendingUpdate = patch; return api },
      upsert(row, opts) { pendingInsert = row; pendingUpsertKey = opts.onConflict; return api },
      single() { single = true; return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) { return exec().then(resolve, reject) },
    }
    return api
  }
  return { from: builder, _tables: tables }
}

test("startLocationSession creates a session with an expiry in the future", async () => {
  const db = fakeDb()
  const before = Date.now()
  const session = await startLocationSession("trip-1", "user-1", "1h", db)

  assert.equal(db._tables.trip_location_sessions.length, 1)
  assert.equal(db._tables.trip_location_sessions[0].journey_id, "trip-1")
  assert.equal(db._tables.trip_location_sessions[0].user_id, "user-1")
  const expiresMs = new Date(session.expiresAt).getTime()
  assert.ok(expiresMs > before + 55 * 60_000 && expiresMs < before + 65 * 60_000, "1h duration should expire in ~60 minutes")
})

test("startLocationSession with 'eod' expires the same day, at or before 23:59:59 Bangkok time", async () => {
  const db = fakeDb()
  const session = await startLocationSession("trip-1", "user-1", "eod", db)
  const expires = new Date(session.expiresAt)
  const bkkHour = Number(expires.toLocaleString("en-US", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false }))
  assert.equal(bkkHour, 23, "eod must expire at 23:xx Bangkok time")
})

test("stopLocationSession sets stopped_at and is scoped to the caller's own user_id", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
  ] })
  await stopLocationSession("sess-1", "someone-else", db)
  assert.equal(db._tables.trip_location_sessions[0].stopped_at, null, "a mismatched user_id must not stop someone else's session")

  await stopLocationSession("sess-1", "user-1", db)
  assert.ok(db._tables.trip_location_sessions[0].stopped_at, "the session owner can stop it")
})

test("pingLocation upserts the latest position, never inserting a second row for the same session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
  ] })
  await pingLocation("sess-1", "user-1", "trip-1", { lat: 13.7, lng: 100.5 }, db)
  await pingLocation("sess-1", "user-1", "trip-1", { lat: 13.8, lng: 100.6 }, db)

  assert.equal(db._tables.trip_member_locations.length, 1, "must upsert, not accumulate history")
  assert.equal(db._tables.trip_member_locations[0].latitude, 13.8)
})

test("pingLocation rejects a ping against a stopped session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: new Date().toISOString() },
  ] })
  await assert.rejects(() => pingLocation("sess-1", "user-1", "trip-1", { lat: 1, lng: 1 }, db))
})

test("pingLocation rejects a ping against an expired session", async () => {
  const db = fakeDb({ trip_location_sessions: [
    { id: "sess-1", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() - 1000).toISOString(), stopped_at: null },
  ] })
  await assert.rejects(() => pingLocation("sess-1", "user-1", "trip-1", { lat: 1, lng: 1 }, db))
})

test("activeLocationsFor returns only positions from active (not stopped/expired) sessions", async () => {
  const db = fakeDb({
    trip_location_sessions: [
      { id: "active", journey_id: "trip-1", user_id: "user-1", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: null },
      { id: "stopped", journey_id: "trip-1", user_id: "user-2", expires_at: new Date(Date.now() + 3600_000).toISOString(), stopped_at: new Date().toISOString() },
      { id: "expired", journey_id: "trip-1", user_id: "user-3", expires_at: new Date(Date.now() - 1000).toISOString(), stopped_at: null },
    ],
    trip_member_locations: [
      { session_id: "active", journey_id: "trip-1", user_id: "user-1", latitude: 1, longitude: 1 },
      { session_id: "stopped", journey_id: "trip-1", user_id: "user-2", latitude: 2, longitude: 2 },
      { session_id: "expired", journey_id: "trip-1", user_id: "user-3", latitude: 3, longitude: 3 },
    ],
  })
  const locations = await activeLocationsFor("trip-1", db)
  assert.equal(locations.length, 1)
  assert.equal(locations[0].userId, "user-1")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --experimental-strip-types --test src/lib/trips/location-sharing.test.mjs`
Expected: FAIL — `location-sharing.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/lib/trips/location-sharing.ts
/**
 * Temporary, opt-in, trip-scoped live location — see
 * docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
 *
 * Injectable `db?`, same shape as medications.ts's `db?: MedicationsDb`, so
 * the expiry/ownership logic can be tested without a live Supabase project.
 */

export interface LocationDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }> }
        gt(col: string, val: string): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      }
      in(col: string, vals: string[]): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    insert(row: Record<string, unknown>): { select(cols: string): { single(): PromiseLike<{ data: Record<string, unknown>; error: { message: string } | null }> } }
    update(patch: Record<string, unknown>): { eq(col: string, val: string): { eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }> } }
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>
  }
}

async function defaultDb(): Promise<LocationDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient() as unknown as LocationDb
}

export type ShareDuration = "15m" | "1h" | "4h" | "eod"
const MINUTES: Record<Exclude<ShareDuration, "eod">, number> = { "15m": 15, "1h": 60, "4h": 240 }

function expiresAt(duration: ShareDuration): string {
  if (duration === "eod") {
    const bkkDateStr = new Date().toLocaleString("en-CA", { timeZone: "Asia/Bangkok" }).slice(0, 10)
    return new Date(`${bkkDateStr}T23:59:59+07:00`).toISOString()
  }
  return new Date(Date.now() + MINUTES[duration] * 60_000).toISOString()
}

export interface StartedSession { id: string; expiresAt: string }

export async function startLocationSession(
  journeyId: string, userId: string, duration: ShareDuration, db?: LocationDb,
): Promise<StartedSession> {
  const admin = db ?? await defaultDb()
  const { data, error } = await admin.from("trip_location_sessions")
    .insert({ journey_id: journeyId, user_id: userId, expires_at: expiresAt(duration) })
    .select("id, expires_at")
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id as string, expiresAt: data.expires_at as string }
}

/** Scoped to the caller's own user_id — a trip owner cannot stop someone
 * else's session, matching the spec's non-negotiable rule. */
export async function stopLocationSession(sessionId: string, userId: string, db?: LocationDb): Promise<void> {
  const admin = db ?? await defaultDb()
  const { error } = await admin.from("trip_location_sessions")
    .update({ stopped_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
  if (error) throw new Error(error.message)
}

export interface LocationPoint { lat: number; lng: number; accuracyM?: number; heading?: number; speedMps?: number }

/** Upserts by session_id — the table's primary key — so only the latest
 * position is ever stored, per the spec's no-history rule. */
export async function pingLocation(
  sessionId: string, userId: string, journeyId: string, point: LocationPoint, db?: LocationDb,
): Promise<void> {
  const admin = db ?? await defaultDb()
  const { data: session, error: findErr } = await admin.from("trip_location_sessions")
    .select("id, expires_at, stopped_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle()
  if (findErr) throw new Error(findErr.message)
  if (!session || session.stopped_at || new Date(session.expires_at as string) <= new Date()) {
    throw new Error("session is not active")
  }

  const { error } = await admin.from("trip_member_locations").upsert({
    session_id: sessionId,
    journey_id: journeyId,
    user_id: userId,
    latitude: point.lat,
    longitude: point.lng,
    accuracy_m: point.accuracyM ?? null,
    heading: point.heading ?? null,
    speed_mps: point.speedMps ?? null,
    recorded_at: new Date().toISOString(),
  }, { onConflict: "session_id" })
  if (error) throw new Error(error.message)
}

export interface ActiveLocation { sessionId: string; userId: string; lat: number; lng: number; recordedAt: string }

/** Two queries, not one embedded-resource query — avoids relying on
 * PostgREST's embedded-filter syntax for a case simple filters cover fine. */
export async function activeLocationsFor(journeyId: string, db?: LocationDb): Promise<ActiveLocation[]> {
  const admin = db ?? await defaultDb()
  const nowIso = new Date().toISOString()
  const { data: sessions, error: sErr } = await admin.from("trip_location_sessions")
    .select("id")
    .eq("journey_id", journeyId)
    .gt("expires_at", nowIso) as unknown as { data: { id: string; stopped_at: null }[] | null; error: { message: string } | null }
  if (sErr) throw new Error(sErr.message)
  const activeIds = (sessions ?? []).filter(s => !s.stopped_at).map(s => s.id)
  if (activeIds.length === 0) return []

  const { data: locations, error: lErr } = await admin.from("trip_member_locations")
    .select("session_id, user_id, latitude, longitude, recorded_at")
    .in("session_id", activeIds) as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null }
  if (lErr) throw new Error(lErr.message)
  return (locations ?? []).map(r => ({
    sessionId: r.session_id as string, userId: r.user_id as string,
    lat: r.latitude as number, lng: r.longitude as number, recordedAt: r.recorded_at as string,
  }))
}
```

Note: the real Supabase query for `sessions` must also filter `stopped_at is null` server-side (`.is("stopped_at", null)`) — the interface above's `.gt()` branch doesn't expose `.is()` chained after it. Add `.is("stopped_at", null)` between `.eq()` and `.gt()` in the real query and extend `LocationDb`'s type accordingly before running Step 4; the fake db's `is()` already supports this chain shape.

- [ ] **Step 4: Fix the interface/query to include the `.is()` filter, then run tests**

Run: `cd web && node --experimental-strip-types --test src/lib/trips/location-sharing.test.mjs`
Expected: all 7 tests PASS.

- [ ] **Step 5: Add the npm script**

Add to `web/package.json`'s `"scripts"` block, alongside `test:medications`:
```json
"test:location-sharing": "node --experimental-strip-types --test src/lib/trips/location-sharing.test.mjs"
```

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/trips/location-sharing.ts web/src/lib/trips/location-sharing.test.mjs web/package.json
git commit -m "feat(trips): add location-sharing library with TDD coverage

startLocationSession/stopLocationSession/pingLocation/activeLocationsFor —
injectable db, upsert-only writes (no location history), ownership and
expiry enforced before any location is accepted."
```

---

## Task 3: Web — location-sessions API routes

**Files:**
- Create: `web/src/app/api/trips/[id]/location-sessions/route.ts`
- Create: `web/src/app/api/trips/[id]/location-sessions/[sessionId]/route.ts`

**Interfaces:**
- Consumes: `startLocationSession`, `stopLocationSession`, `pingLocation`, `activeLocationsFor` from Task 2; `getAuthedUser` from `@/lib/authed-user`; `getTripAccess` from `@/lib/trips/trip-access`.
- Produces: `POST /api/trips/:id/location-sessions` (body `{ duration }`) → `{ session: { id, expiresAt } }`; `GET /api/trips/:id/location-sessions` → `{ locations: ActiveLocation[] }`; `PATCH /api/trips/:id/location-sessions/:sessionId` (body `{ lat, lng, accuracyM?, heading?, speedMps? }`) → `{ ok: true }`; `DELETE /api/trips/:id/location-sessions/:sessionId` → `{ ok: true }`.

- [ ] **Step 1: Write the list/start route**

```typescript
// web/src/app/api/trips/[id]/location-sessions/route.ts
/**
 * Starting a live-location share, and listing everyone currently sharing on
 * this trip. See docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { startLocationSession, activeLocationsFor, type ShareDuration } from "@/lib/trips/location-sharing"

type Params = { params: Promise<{ id: string }> }

async function guard(tripId: string, req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  return { userId: user.id }
}

const VALID_DURATIONS: ShareDuration[] = ["15m", "1h", "4h", "eod"]

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  const body = await req.json().catch(() => null) as { duration?: string } | null
  const duration = body?.duration as ShareDuration | undefined
  if (!duration || !VALID_DURATIONS.includes(duration)) {
    return NextResponse.json({ error: "duration must be one of 15m, 1h, 4h, eod" }, { status: 400 })
  }

  try {
    const session = await startLocationSession(tripId, g.userId, duration)
    return NextResponse.json({ session })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  try {
    const locations = await activeLocationsFor(tripId)
    return NextResponse.json({ locations })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Write the ping/stop route**

```typescript
// web/src/app/api/trips/[id]/location-sessions/[sessionId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { pingLocation, stopLocationSession } from "@/lib/trips/location-sharing"

type Params = { params: Promise<{ id: string; sessionId: string }> }

async function guard(tripId: string, req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  return { userId: user.id }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: tripId, sessionId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  const body = await req.json().catch(() => null) as { lat?: number; lng?: number; accuracyM?: number; heading?: number; speedMps?: number } | null
  if (!body || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 })
  }

  try {
    await pingLocation(sessionId, g.userId, tripId, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: tripId, sessionId } = await params
  const g = await guard(tripId, req)
  if ("error" in g) return g.error

  await stopLocationSession(sessionId, g.userId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test against local Supabase**

Run the web dev server, sign in, and from the browser console on a trip page:
```javascript
await fetch(`/api/trips/${tripId}/location-sessions`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ duration: "15m" }),
}).then(r => r.json())
```
Expected: `{ session: { id: "...", expiresAt: "..." } }`, and a new row in `trip_location_sessions` (check via Supabase Studio or `psql`).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/trips/\[id\]/location-sessions
git commit -m "feat(trips): add location-sessions API routes

POST starts a share, GET lists active shares, PATCH/DELETE on
[sessionId] ping and stop one — all gated by getTripAccess()."
```

---

## Task 4: iOS — TripLocationAPI (direct Supabase)

**Files:**
- Create: `ios/Slippy/Services/TripLocationAPI.swift`

**Interfaces:**
- Consumes: `SupabaseManager.shared.client` (existing).
- Produces: `TripLocationAPI.start(journeyId:duration:) async throws -> Session`, `.stop(sessionId:) async throws`, `.ping(sessionId:journeyId:coordinate:accuracy:heading:speed:) async throws`, `.activeLocations(journeyId:) async throws -> [MemberLocation]`, enum `TripLocationAPI.Duration`.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/Services/TripLocationAPI.swift
import Foundation
import Supabase
import CoreLocation

/// Temporary, opt-in, trip-scoped live location — writes go straight to
/// Supabase, the same as TripItineraryAPI, because 094_trip_participant_scoped_rls.sql
/// already enforces "a trip belongs to whoever is on it" at the database
/// level. See docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
@MainActor
enum TripLocationAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }

    enum Duration: String { case m15 = "15m", h1 = "1h", h4 = "4h", eod = "eod" }

    struct Session: Codable {
        let id: String
        let expiresAt: String
        enum CodingKeys: String, CodingKey { case id; case expiresAt = "expires_at" }
    }

    static func start(journeyId: String, duration: Duration) async throws -> Session {
        let userId = try await db.auth.session.user.id.uuidString
        struct NewSession: Encodable { let journey_id: String; let user_id: String; let expires_at: String }
        return try await db.from("trip_location_sessions")
            .insert(NewSession(journey_id: journeyId, user_id: userId, expires_at: expiresAt(duration)))
            .select("id, expires_at")
            .single()
            .execute()
            .value
    }

    static func stop(sessionId: String) async throws {
        struct Patch: Encodable { let stopped_at: String }
        _ = try await db.from("trip_location_sessions")
            .update(Patch(stopped_at: ISO8601DateFormatter().string(from: Date())))
            .eq("id", value: sessionId)
            .execute()
    }

    static func ping(
        sessionId: String, journeyId: String, coordinate: CLLocationCoordinate2D,
        accuracy: Double?, heading: Double?, speed: Double?
    ) async throws {
        let userId = try await db.auth.session.user.id.uuidString
        struct Point: Encodable {
            let session_id: String, journey_id: String, user_id: String
            let latitude: Double, longitude: Double
            let accuracy_m: Double?, heading: Double?, speed_mps: Double?
            let recorded_at: String
        }
        _ = try await db.from("trip_member_locations")
            .upsert(Point(session_id: sessionId, journey_id: journeyId, user_id: userId,
                          latitude: coordinate.latitude, longitude: coordinate.longitude,
                          accuracy_m: accuracy, heading: heading, speed_mps: speed,
                          recorded_at: ISO8601DateFormatter().string(from: Date())),
                    onConflict: "session_id")
            .execute()
    }

    struct MemberLocation: Identifiable {
        var id: String { sessionId }
        let sessionId: String
        let userId: String
        let latitude: Double
        let longitude: Double
        let recordedAt: String
    }

    private struct SessionRow: Decodable { let id: String; let stoppedAt: String?
        enum CodingKeys: String, CodingKey { case id; case stoppedAt = "stopped_at" }
    }
    private struct LocationRow: Decodable {
        let sessionId: String, userId: String, latitude: Double, longitude: Double, recordedAt: String
        enum CodingKeys: String, CodingKey {
            case sessionId = "session_id", userId = "user_id", latitude, longitude
            case recordedAt = "recorded_at"
        }
    }

    /// Two queries, not one embedded-resource query — same reasoning as the
    /// web equivalent in location-sharing.ts.
    static func activeLocations(journeyId: String) async throws -> [MemberLocation] {
        let nowIso = ISO8601DateFormatter().string(from: Date())
        let sessions: [SessionRow] = try await db.from("trip_location_sessions")
            .select("id, stopped_at")
            .eq("journey_id", value: journeyId)
            .gt("expires_at", value: nowIso)
            .execute()
            .value
        let activeIds = sessions.filter { $0.stoppedAt == nil }.map(\.id)
        guard !activeIds.isEmpty else { return [] }

        let rows: [LocationRow] = try await db.from("trip_member_locations")
            .select("session_id, user_id, latitude, longitude, recorded_at")
            .in("session_id", values: activeIds)
            .execute()
            .value
        return rows.map { MemberLocation(sessionId: $0.sessionId, userId: $0.userId, latitude: $0.latitude, longitude: $0.longitude, recordedAt: $0.recordedAt) }
    }

    private static func expiresAt(_ duration: Duration) -> String {
        let now = Date()
        switch duration {
        case .m15: return ISO8601DateFormatter().string(from: now.addingTimeInterval(15 * 60))
        case .h1:  return ISO8601DateFormatter().string(from: now.addingTimeInterval(60 * 60))
        case .h4:  return ISO8601DateFormatter().string(from: now.addingTimeInterval(4 * 60 * 60))
        case .eod:
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "Asia/Bangkok")!
            let endOfDay = cal.date(bySettingHour: 23, minute: 59, second: 59, of: now) ?? now
            return ISO8601DateFormatter().string(from: endOfDay)
        }
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd ios && xcrun --sdk iphonesimulator swiftc -typecheck \
  -target arm64-apple-ios17.0-simulator \
  Slippy/Services/TripLocationAPI.swift Slippy/Services/SupabaseManager.swift
```
Expected: no errors. If `.gt(_:value:)` or `.in(_:values:)` don't match supabase-swift's actual method labels, this step will name the exact mismatch — fix the call site to match, do not change the table/column names.

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Services/TripLocationAPI.swift
git commit -m "feat(trips): add TripLocationAPI for direct-to-Supabase location writes

Mirrors TripItineraryAPI's pattern — RLS enforces trip membership, no
Next.js round trip needed for what doesn't touch a server secret."
```

---

## Task 5: iOS — TripLocationViewModel (CLLocationManager + posting loop)

**Files:**
- Create: `ios/Slippy/ViewModels/TripLocationViewModel.swift`

**Interfaces:**
- Consumes: `TripLocationAPI` from Task 4.
- Produces: `@MainActor class TripLocationViewModel: NSObject, ObservableObject` with `@Published var mySession: TripLocationAPI.Session?`, `@Published var others: [TripLocationAPI.MemberLocation]`, `@Published var permissionDenied: Bool`, methods `startSharing(journeyId:duration:) `, `stopSharing()`, `startPolling(journeyId:)`, `stopPolling()`. Task 6's UI depends on these exact names.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/ViewModels/TripLocationViewModel.swift
import Foundation
import CoreLocation

/// Foreground-only live location for one trip screen. No
/// NSLocationAlwaysAndWhenInUseUsageDescription is requested — sharing stops
/// the moment the app backgrounds, per the spec's locked-in decision.
@MainActor
final class TripLocationViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var mySession: TripLocationAPI.Session?
    @Published var others: [TripLocationAPI.MemberLocation] = []
    @Published var permissionDenied = false
    @Published var errorText: String?

    private let manager = CLLocationManager()
    private var journeyId: String?
    private var pingTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func startSharing(journeyId: String, duration: TripLocationAPI.Duration) {
        self.journeyId = journeyId
        Task {
            do {
                let session = try await TripLocationAPI.start(journeyId: journeyId, duration: duration)
                mySession = session
                manager.requestWhenInUseAuthorization()
                manager.startUpdatingLocation()
                startPingLoop(sessionId: session.id, journeyId: journeyId)
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    func stopSharing() {
        guard let session = mySession else { return }
        pingTask?.cancel()
        manager.stopUpdatingLocation()
        Task {
            try? await TripLocationAPI.stop(sessionId: session.id)
            mySession = nil
        }
    }

    /// Posts the current location every 12 seconds while a session is
    /// active — inside the spec's 10-15s cadence, matched to how often other
    /// members' pins should visibly move.
    private func startPingLoop(sessionId: String, journeyId: String) {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while let self, !Task.isCancelled, self.mySession != nil {
                if let loc = self.manager.location {
                    try? await TripLocationAPI.ping(
                        sessionId: sessionId, journeyId: journeyId, coordinate: loc.coordinate,
                        accuracy: loc.horizontalAccuracy, heading: loc.course >= 0 ? loc.course : nil,
                        speed: loc.speed >= 0 ? loc.speed : nil
                    )
                }
                try? await Task.sleep(nanoseconds: 12_000_000_000)
            }
        }
    }

    /// Other members' pins — polled, not subscribed, matching this app's
    /// existing convention (MessagesViewModel has no realtime subscription
    /// either; "refresh on open + pull-to-refresh" is the established
    /// pattern here, extended to a repeating timer since a live map needs to
    /// visibly move without the user manually refreshing).
    func startPolling(journeyId: String) {
        self.journeyId = journeyId
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                if let locations = try? await TripLocationAPI.activeLocations(journeyId: journeyId) {
                    self.others = locations
                }
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .denied, .restricted: self.permissionDenied = true
            default: self.permissionDenied = false
            }
        }
    }
}
```

- [ ] **Step 2: Add the Info.plist usage description**

In `ios/Slippy/Info.plist` (or `project.yml`'s `INFOPLIST_KEY_*` build settings, whichever this project uses — check `project.yml` for existing `INFOPLIST_KEY_NSCameraUsageDescription`-style entries first), add:
```
NSLocationWhenInUseUsageDescription: "Slippy ใช้ตำแหน่งของคุณเพื่อแชร์ให้เพื่อนร่วมทริปเห็นชั่วคราว เฉพาะตอนที่คุณเปิดแชร์เท่านั้น"
```
Do NOT add `NSLocationAlwaysAndWhenInUseUsageDescription` — foreground-only is the locked-in decision.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd ios && xcrun --sdk iphonesimulator swiftc -typecheck \
  -target arm64-apple-ios17.0-simulator \
  Slippy/ViewModels/TripLocationViewModel.swift Slippy/Services/TripLocationAPI.swift Slippy/Services/SupabaseManager.swift
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/ViewModels/TripLocationViewModel.swift ios/Slippy/project.yml
git commit -m "feat(trips): add TripLocationViewModel — foreground CLLocationManager + polling"
```

---

## Task 6: iOS — Share-location UI in TripMapView

**Files:**
- Modify: `ios/Slippy/Views/Trips/TripMapView.swift`

**Interfaces:**
- Consumes: `TripLocationViewModel` from Task 5.
- Produces: a "แชร์ตำแหน่ง" button in `bottomBar`, a duration-picker sheet, a persistent sharing banner, and a distinct pin type for `others` on the map.

- [ ] **Step 1: Add the view model and sheet state**

In `TripMapView`, alongside the other `@State` properties:
```swift
@StateObject private var locationVM = TripLocationViewModel()
@State private var showShareLocationSheet = false
```

- [ ] **Step 2: Start polling on appear, stop on disappear**

In the existing `.onAppear { ... }` block, add:
```swift
locationVM.startPolling(journeyId: trip.id)
```
Add a new modifier on the outer `VStack`:
```swift
.onDisappear { locationVM.stopPolling() }
```

- [ ] **Step 3: Add the share button to `bottomBar`**

In `bottomBar`'s `HStack`, before the existing `Spacer()`:
```swift
Button {
    hapticLight()
    if locationVM.mySession != nil { locationVM.stopSharing() } else { showShareLocationSheet = true }
} label: {
    Label(locationVM.mySession != nil ? "หยุดแชร์ตำแหน่ง" : "แชร์ตำแหน่ง",
          systemImage: locationVM.mySession != nil ? "location.slash.fill" : "location.fill")
        .font(.system(size: 12, weight: .semibold))
}
.buttonStyle(.bordered)
```

- [ ] **Step 4: Add the duration-picker sheet**

Add to the existing `.sheet(...)` chain in `body`:
```swift
.sheet(isPresented: $showShareLocationSheet) {
    ShareLocationSheet { duration in
        showShareLocationSheet = false
        locationVM.startSharing(journeyId: trip.id, duration: duration)
    }
}
```

Add a new private view in this file, near `AddStopSheet`:
```swift
private struct ShareLocationSheet: View {
    let onPick: (TripLocationAPI.Duration) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("เพื่อนร่วมทริปจะเห็นตำแหน่งของคุณแบบสด ๆ จนกว่าจะหมดเวลาหรือคุณกดหยุด")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }
                ForEach([
                    (TripLocationAPI.Duration.m15, "15 นาที"),
                    (.h1, "1 ชั่วโมง"),
                    (.h4, "4 ชั่วโมง"),
                    (.eod, "จนถึงสิ้นวัน"),
                ], id: \.0) { duration, label in
                    Button(label) { onPick(duration); dismiss() }
                }
            }
            .navigationTitle("แชร์ตำแหน่งนานแค่ไหน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
            }
        }
    }
}
```

- [ ] **Step 5: Add the persistent sharing banner**

In `mapArea`'s `.overlay(alignment: .top) { VStack(spacing: 6) { ... } }`, add above `resolvingBanner`:
```swift
if let session = locationVM.mySession { sharingBanner(session) }
```
Add the new view:
```swift
private func sharingBanner(_ session: TripLocationAPI.Session) -> some View {
    HStack(spacing: 8) {
        Image(systemName: "location.fill.viewfinder").foregroundColor(.white)
        Text("กำลังแชร์ตำแหน่ง")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(.white)
        Button {
            hapticLight()
            locationVM.stopSharing()
        } label: {
            Text("หยุด").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
        }
    }
    .padding(.horizontal, 12).padding(.vertical, 7)
    .background(Capsule().fill(Color.brand500.opacity(0.9)))
    .padding(.top, 10)
}
```

- [ ] **Step 6: Render other members' live pins on the map**

In `mapArea`'s `Map { ... }` content, after the existing `ForEach(pins, ...)` block:
```swift
ForEach(locationVM.others) { loc in
    Annotation("", coordinate: CLLocationCoordinate2D(latitude: loc.latitude, longitude: loc.longitude)) {
        livePinBadge(loc)
    }
}
```
Add the badge view — visually distinct from a numbered stop pin, and greyed out once stale:
```swift
private func livePinBadge(_ loc: TripLocationAPI.MemberLocation) -> some View {
    let stale = (ISO8601DateFormatter().date(from: loc.recordedAt).map { Date().timeIntervalSince($0) > 60 }) ?? true
    return ZStack {
        Circle()
            .fill(stale ? Color.gray : Color.brand500)
            .frame(width: 26, height: 26)
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .shadow(radius: 3)
        Image(systemName: "location.fill")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
    }
    .opacity(stale ? 0.6 : 1)
}
```

- [ ] **Step 7: Build**

Run:
```bash
cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy \
  -destination 'platform=iOS Simulator,id=<simulator-udid>' build
```
(Use `xcrun simctl list devices booted` to find `<simulator-udid>`.) Expected: `BUILD SUCCEEDED`.

- [ ] **Step 8: Commit**

```bash
git add ios/Slippy/Views/Trips/TripMapView.swift
git commit -m "feat(trips): add share-location UI to TripMapView

Share button + duration sheet + persistent banner + live pins for other
sharing members, greyed out once stale (>60s since last update)."
```

---

## Task 7: Web — location sharing hook and UI

**Files:**
- Create: `web/src/lib/trips/use-location-shares.ts`
- Create: `web/src/components/trips/trip-location-share.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/trips/[id]/location-sessions`, `PATCH/DELETE /api/trips/[id]/location-sessions/[sessionId]` from Task 3.
- Produces: hook `useLocationShares(tripId): { others: ActiveLocation[]; mySession: {id,expiresAt} | null; start(duration): Promise<void>; stop(): Promise<void> }`; component `<LocationShareControl tripId={string} />` (button + sheet + banner). Task 8 imports both.

- [ ] **Step 1: Write the hook**

```typescript
// web/src/lib/trips/use-location-shares.ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface ActiveLocation { sessionId: string; userId: string; lat: number; lng: number; recordedAt: string }
export type ShareDuration = "15m" | "1h" | "4h" | "eod"

/** Browser geolocation, foreground-only (no service worker, no background
 * sync) — matches the spec's locked-in decision exactly. */
export function useLocationShares(tripId: string) {
  const [others, setOthers] = useState<ActiveLocation[]>([])
  const [mySession, setMySession] = useState<{ id: string; expiresAt: string } | null>(null)
  const watchId = useRef<number | null>(null)
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollOthers = useCallback(async () => {
    const res = await fetch(`/api/trips/${tripId}/location-sessions`)
    if (!res.ok) return
    const json = await res.json() as { locations: ActiveLocation[] }
    setOthers(json.locations)
  }, [tripId])

  useEffect(() => {
    pollOthers()
    const t = setInterval(pollOthers, 10_000)
    return () => clearInterval(t)
  }, [pollOthers])

  const start = useCallback(async (duration: ShareDuration) => {
    const res = await fetch(`/api/trips/${tripId}/location-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration }),
    })
    if (!res.ok) throw new Error((await res.json()).error ?? "เริ่มแชร์ตำแหน่งไม่สำเร็จ")
    const { session } = await res.json() as { session: { id: string; expiresAt: string } }
    setMySession(session)

    if (!navigator.geolocation) return
    watchId.current = navigator.geolocation.watchPosition(() => { /* position read on each ping tick below */ })
    pingTimer.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(pos => {
        fetch(`/api/trips/${tripId}/location-sessions/${session.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy, heading: pos.coords.heading ?? undefined, speedMps: pos.coords.speed ?? undefined,
          }),
        })
      })
    }, 12_000)
  }, [tripId])

  const stop = useCallback(async () => {
    if (!mySession) return
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (pingTimer.current) clearInterval(pingTimer.current)
    await fetch(`/api/trips/${tripId}/location-sessions/${mySession.id}`, { method: "DELETE" })
    setMySession(null)
  }, [tripId, mySession])

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (pingTimer.current) clearInterval(pingTimer.current)
  }, [])

  return { others, mySession, start, stop }
}
```

- [ ] **Step 2: Write the UI component**

```typescript
// web/src/components/trips/trip-location-share.tsx
"use client"

import { useState } from "react"
import { Locate, LocateOff, X } from "lucide-react"
import { useLocationShares, type ShareDuration } from "@/lib/trips/use-location-shares"
import { cn } from "@/lib/utils"

const OPTIONS: { value: ShareDuration; label: string }[] = [
  { value: "15m", label: "15 นาที" },
  { value: "1h",  label: "1 ชั่วโมง" },
  { value: "4h",  label: "4 ชั่วโมง" },
  { value: "eod", label: "จนถึงสิ้นวัน" },
]

/** Button + duration sheet + persistent banner while active. Exported hook
 * state (`others`) is meant to be read separately by trip-map.tsx via its
 * own useLocationShares(tripId) call — React Query-less duplication is
 * intentional here: the alternative (lifting state up) would mean every
 * consumer of the map also has to know about location sharing, and this
 * hook's own 10s poll is cheap enough that two independent instances per
 * page cost nothing a user would notice. */
export function LocationShareControl({ tripId }: { tripId: string }) {
  const { mySession, start, stop } = useLocationShares(tripId)
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button
        onClick={() => (mySession ? stop() : setShowPicker(true))}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold",
          mySession ? "border-brand-500 bg-brand-50 text-brand-700" : "bg-card hover:bg-muted/50")}>
        {mySession ? <LocateOff className="h-3.5 w-3.5" /> : <Locate className="h-3.5 w-3.5" />}
        {mySession ? "หยุดแชร์ตำแหน่ง" : "แชร์ตำแหน่ง"}
      </button>

      {mySession && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          กำลังแชร์ตำแหน่ง
        </div>
      )}

      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setShowPicker(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-card p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">แชร์ตำแหน่งนานแค่ไหน</p>
              <button onClick={() => setShowPicker(false)}><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">เพื่อนร่วมทริปจะเห็นตำแหน่งของคุณแบบสด ๆ จนกว่าจะหมดเวลาหรือคุณกดหยุด</p>
            {OPTIONS.map(o => (
              <button key={o.value} disabled={busy}
                onClick={async () => { setBusy(true); await start(o.value); setBusy(false); setShowPicker(false) }}
                className="block w-full rounded-xl p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50">
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/trips/use-location-shares.ts web/src/components/trips/trip-location-share.tsx
git commit -m "feat(trips): add web location-sharing hook and control UI"
```

---

## Task 8: Web — wire live pins into trip-map.tsx and the Map/Plan tabs

**Files:**
- Modify: `web/src/components/trips/trip-map.tsx`
- Modify: `web/src/components/trips/trip-journey-client.tsx`

**Interfaces:**
- Consumes: `useLocationShares` from Task 7, `LocationShareControl` from Task 7.
- Produces: a new optional `TripMap` prop `liveLocations?: ActiveLocation[]` rendered as distinct markers.

- [ ] **Step 1: Add the `liveLocations` prop and marker rendering to `trip-map.tsx`**

Add to the `Props` interface:
```typescript
liveLocations?: import("@/lib/trips/use-location-shares").ActiveLocation[]
```

In the pins-rebuild `useEffect` (the one that builds `markersRef` from `pins`), after that block, add a second effect that mirrors it for live locations:
```typescript
const liveMarkersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())

useEffect(() => {
  const map = mapRef.current
  if (!map || !mapReady) return
  liveMarkersRef.current.forEach(m => { m.map = null })
  liveMarkersRef.current.clear()

  for (const loc of liveLocations ?? []) {
    const stale = Date.now() - new Date(loc.recordedAt).getTime() > 60_000
    const el = document.createElement("div")
    el.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${stale ? "#94a3b8" : "#0f172a"};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:${stale ? 0.6 : 1}"></div>`
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map, position: { lat: loc.lat, lng: loc.lng }, content: el,
    })
    liveMarkersRef.current.set(loc.sessionId, marker)
  }
}, [liveLocations, mapReady])
```

- [ ] **Step 2: Pass `liveLocations` from `trip-journey-client.tsx`'s Map tab**

In the `tab === "map"` block, call the hook and pass it through:
```typescript
const { others: liveLocations } = useLocationShares(trip.id)
```
(add this near the top of the component, alongside other hooks)
```typescript
<TripMap tripId={trip.id} days={days} activeDay={activeDay}
         onDaysChange={setDays} canEdit onEditItem={setEditingItem}
         liveLocations={liveLocations} />
```
Also add `<LocationShareControl tripId={trip.id} />` next to the existing "ดูทั้งทริป" button in that tab's header row.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Start the dev server, open a trip's Map tab in two different browser sessions (or one normal + one incognito) signed in as two different trip members. Start sharing from one; confirm the other sees a moving dark pin within ~12 seconds, greys out ~60s after the sharer stops or backgrounds the tab.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/trips/trip-map.tsx web/src/components/trips/trip-journey-client.tsx
git commit -m "feat(trips): show live-sharing members' pins on the web trip map"
```

---

## Task 9: Add LiveKit dependencies to web

**Files:**
- Modify: `web/package.json`

**Interfaces:**
- Produces: `livekit-server-sdk` (server-side token minting, Task 10) and `livekit-client` (browser room connection, Task 11) available as imports.

- [ ] **Step 1: Install**

Run:
```bash
cd web && npm install livekit-server-sdk livekit-client
```

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (nothing imports these yet, but the install itself must not break the lockfile/build).

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore(trips): add livekit-server-sdk and livekit-client dependencies"
```

---

## Task 10: Web — calls library (TDD)

**Files:**
- Create: `web/src/lib/trips/calls.ts`
- Create: `web/src/lib/trips/calls.test.mjs`
- Modify: `web/package.json` (add `"test:calls": "node --experimental-strip-types --test src/lib/trips/calls.test.mjs"`)

**Interfaces:**
- Consumes: `getLiveKitServerConfig` from `web/src/lib/trips/livekit-config.ts` (already exists), `AccessToken` from `livekit-server-sdk` (Task 9).
- Produces: `mintCallToken(journeyId, userId, conversationId, db?) -> { token, url, roomName, callSessionId }`, `endCallSession(callSessionId, db?)`. Task 11 imports both.

- [ ] **Step 1: Write the failing tests**

```javascript
// web/src/lib/trips/calls.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

process.env.NEXT_PUBLIC_LIVEKIT_URL = "wss://test.livekit.cloud"
process.env.LIVEKIT_API_KEY = "test-key"
process.env.LIVEKIT_API_SECRET = "test-secret-at-least-32-characters-long"

const { mintCallToken, endCallSession } = await import("./calls.ts")

function decodeJwtPayload(jwt) {
  const [, payload] = jwt.split(".")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
}

function fakeDb(seed = {}) {
  const tables = { trip_call_sessions: seed.trip_call_sessions ?? [] }
  function builder(table) {
    const filters = []
    let pendingUpdate = null
    let pendingInsert = null
    let single = false
    function matching() { return tables[table].filter(r => filters.every(f => f(r))) }
    function exec() {
      if (pendingInsert) {
        const row = { id: `${table}-${tables[table].length + 1}`, ...pendingInsert }
        tables[table].push(row)
        return Promise.resolve({ data: row, error: null })
      }
      const rows = matching()
      if (pendingUpdate) { for (const r of rows) Object.assign(r, pendingUpdate) }
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null })
    }
    const api = {
      eq(col, val) { filters.push(r => r[col] === val); return api },
      select() { return api },
      insert(row) { pendingInsert = row; return api },
      update(patch) { pendingUpdate = patch; return api },
      single() { single = true; return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) { return exec().then(resolve, reject) },
    }
    return api
  }
  return { from: builder, _tables: tables }
}

test("mintCallToken creates a new ringing call session when none exists", async () => {
  const db = fakeDb()
  const result = await mintCallToken("trip-1", "user-1", "conv-1", db)

  assert.equal(db._tables.trip_call_sessions.length, 1)
  const session = db._tables.trip_call_sessions[0]
  assert.equal(session.status, "ringing")
  assert.equal(session.journey_id, "trip-1")
  assert.equal(result.callSessionId, session.id)
})

test("mintCallToken reuses an already-ringing call instead of starting a second room", async () => {
  const db = fakeDb({ trip_call_sessions: [
    { id: "call-1", journey_id: "trip-1", room_name: "trip-trip-1", status: "ringing" },
  ] })
  const result = await mintCallToken("trip-1", "user-2", "conv-1", db)

  assert.equal(db._tables.trip_call_sessions.length, 1, "must not create a second room")
  assert.equal(result.callSessionId, "call-1")
  assert.equal(result.roomName, "trip-trip-1")
})

test("mintCallToken's JWT grants room-join for exactly the returned room", async () => {
  const db = fakeDb()
  const result = await mintCallToken("trip-2", "user-1", "conv-2", db)

  const payload = decodeJwtPayload(result.token)
  assert.equal(payload.sub, "user-1")
  assert.equal(payload.video.room, result.roomName)
  assert.equal(payload.video.roomJoin, true)
})

test("endCallSession marks the call ended with a timestamp", async () => {
  const db = fakeDb({ trip_call_sessions: [{ id: "call-1", status: "ringing" }] })
  await endCallSession("call-1", db)

  const session = db._tables.trip_call_sessions[0]
  assert.equal(session.status, "ended")
  assert.ok(session.ended_at)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --experimental-strip-types --test src/lib/trips/calls.test.mjs`
Expected: FAIL — `calls.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/lib/trips/calls.ts
/**
 * Minting a LiveKit room-join token for a trip's voice call. See
 * docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §7.
 *
 * One room per trip at a time — joining an already-ringing/active call
 * reuses its room rather than starting a second, disconnected one.
 */
import { AccessToken } from "livekit-server-sdk"
import { getLiveKitServerConfig } from "./livekit-config"

export interface CallsDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }> }
      }
    }
    insert(row: Record<string, unknown>): { select(cols: string): { single(): PromiseLike<{ data: Record<string, unknown>; error: { message: string } | null }> } }
    update(patch: Record<string, unknown>): { eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }> }
  }
}

async function defaultDb(): Promise<CallsDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return createAdminClient() as unknown as CallsDb
}

export interface CallToken { token: string; url: string; roomName: string; callSessionId: string }

export async function mintCallToken(
  journeyId: string, userId: string, conversationId: string, db?: CallsDb,
): Promise<CallToken> {
  const admin = db ?? await defaultDb()
  const { url, apiKey, apiSecret } = getLiveKitServerConfig()

  const { data: existing, error: findErr } = await admin.from("trip_call_sessions")
    .select("id, room_name, status")
    .eq("journey_id", journeyId)
    .eq("status", "ringing")
    .maybeSingle()
  if (findErr) throw new Error(findErr.message)

  let callSessionId: string
  let roomName: string
  if (existing) {
    callSessionId = existing.id as string
    roomName = existing.room_name as string
  } else {
    roomName = `trip-${journeyId}`
    const { data: created, error: insErr } = await admin.from("trip_call_sessions")
      .insert({ journey_id: journeyId, conversation_id: conversationId, room_name: roomName, initiator_id: userId, status: "ringing" })
      .select("id")
      .single()
    if (insErr) throw new Error(insErr.message)
    callSessionId = created.id as string
  }

  const at = new AccessToken(apiKey, apiSecret, { identity: userId })
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })
  const token = await at.toJwt()

  return { token, url, roomName, callSessionId }
}

export async function endCallSession(callSessionId: string, db?: CallsDb): Promise<void> {
  const admin = db ?? await defaultDb()
  const { error } = await admin.from("trip_call_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", callSessionId)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --experimental-strip-types --test src/lib/trips/calls.test.mjs`
Expected: all 4 tests PASS.

- [ ] **Step 5: Add the npm script and typecheck**

Add `"test:calls": "node --experimental-strip-types --test src/lib/trips/calls.test.mjs"` to `web/package.json`.
Run: `cd web && npx tsc --noEmit` — expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/trips/calls.ts web/src/lib/trips/calls.test.mjs web/package.json
git commit -m "feat(trips): add calls library — one LiveKit room per trip, TDD covered"
```

---

## Task 11: Web — calls/token API route

**Files:**
- Create: `web/src/app/api/trips/[id]/calls/token/route.ts`

**Interfaces:**
- Consumes: `mintCallToken` from Task 10; `getAuthedUser`, `getTripAccess`.
- Produces: `POST /api/trips/:id/calls/token` → `{ token, url, roomName, callSessionId }`.

- [ ] **Step 1: Write the route**

```typescript
// web/src/app/api/trips/[id]/calls/token/route.ts
/**
 * Mints a LiveKit join token for this trip's call room. LIVEKIT_API_SECRET
 * never leaves this route — see livekit-config.ts.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/authed-user"
import { getTripAccess } from "@/lib/trips/trip-access"
import { mintCallToken } from "@/lib/trips/calls"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) return NextResponse.json({ error: "not found" }, { status: 404 })

  try {
    // conversationId reuses the trip's existing group conversation
    // (trip-conversation.ts) — not re-derived here to avoid a second
    // membership-sync path; pass tripId itself if no conversation lookup is
    // wired in yet, and revisit once trip-conversation.ts exposes a getter.
    const result = await mintCallToken(tripId, user.id, tripId)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

With `NEXT_PUBLIC_LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` set in `web/.env.local` (already done), sign in, then from the browser console on a trip page:
```javascript
await fetch(`/api/trips/${tripId}/calls/token`, { method: "POST" }).then(r => r.json())
```
Expected: `{ token: "eyJ...", url: "wss://...", roomName: "trip-...", callSessionId: "..." }`, and a new row in `trip_call_sessions` with `status: 'ringing'`.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/trips/\[id\]/calls
git commit -m "feat(trips): add calls/token API route"
```

---

## Task 12: Web — call UI (voice-only)

**Files:**
- Create: `web/src/components/trips/trip-call-panel.tsx`

**Interfaces:**
- Consumes: `Room` from `livekit-client`; `POST /api/trips/[id]/calls/token`.
- Produces: `<CallButton tripId={string} />` — a button that, when pressed, requests a token, connects to the room with microphone published, and shows a minimal in-call bar with a hang-up button.

- [ ] **Step 1: Write the component**

```typescript
// web/src/components/trips/trip-call-panel.tsx
"use client"

import { useRef, useState } from "react"
import { Room } from "livekit-client"
import { Phone, PhoneOff } from "lucide-react"

/** Voice-only for this plan — no camera track is ever requested or
 * published, per the locked-in decision in the design spec. */
export function CallButton({ tripId }: { tripId: string }) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const roomRef = useRef<Room | null>(null)
  const callSessionIdRef = useRef<string | null>(null)

  async function join() {
    setConnecting(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/calls/token`, { method: "POST" })
      if (!res.ok) throw new Error((await res.json()).error ?? "เข้าร่วมสายไม่สำเร็จ")
      const { token, url, callSessionId } = await res.json() as { token: string; url: string; callSessionId: string }

      const room = new Room()
      await room.connect(url, token)
      await room.localParticipant.setMicrophoneEnabled(true)
      roomRef.current = room
      callSessionIdRef.current = callSessionId
      setConnected(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : "เข้าร่วมสายไม่สำเร็จ")
    } finally {
      setConnecting(false)
    }
  }

  async function leave() {
    roomRef.current?.disconnect()
    roomRef.current = null
    setConnected(false)
    // Ending the last participant's call session is a server decision
    // (does someone else remain in the room?) — left for a later pass once
    // there's a way to check room occupancy; not blocking for this plan,
    // since the room simply sits idle with no participants otherwise.
  }

  if (connected) {
    return (
      <button onClick={leave} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700">
        <PhoneOff className="h-3.5 w-3.5" />วางสาย
      </button>
    )
  }
  return (
    <button onClick={join} disabled={connecting} className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-xs font-semibold hover:bg-muted/50 disabled:opacity-50">
      <Phone className="h-3.5 w-3.5" />{connecting ? "กำลังเชื่อมต่อ…" : "โทร"}
    </button>
  )
}
```

- [ ] **Step 2: Wire the button into the trip page**

In `web/src/components/trips/trip-journey-client.tsx`, import `CallButton` and place it next to `LocationShareControl` in the header of the Plan and Map tabs.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Open a trip in two browser sessions signed in as two different members. Click "โทร" in both; confirm audio flows between them (speak into one mic, hear it in the other tab). Click "วางสาย" in one; confirm it disconnects cleanly (no console errors, microphone indicator turns off).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/trips/trip-call-panel.tsx web/src/components/trips/trip-journey-client.tsx
git commit -m "feat(trips): add voice-only call button and connection UI"
```

---

## Task 13: iOS — add LiveKit Swift SDK

**Files:**
- Modify: `ios/Slippy/project.yml`

**Interfaces:**
- Produces: the `LiveKit` module, importable from Swift, for Tasks 14–16.

- [ ] **Step 1: Add the package**

In `project.yml`, in the `packages:` block, alongside `Supabase`:
```yaml
  LiveKit:
    url: https://github.com/livekit/client-sdk-swift
    from: "2.15.0"
```
In the `Slippy` target's `dependencies:` list, alongside the existing `Supabase` entry:
```yaml
      - package: LiveKit
        product: LiveKit
```

- [ ] **Step 2: Regenerate and resolve**

Run:
```bash
cd ios && xcodegen generate && xcodebuild -resolvePackageDependencies -project Slippy.xcodeproj -scheme Slippy
```
Expected: package resolution succeeds with no errors.

- [ ] **Step 3: Add microphone usage description**

Alongside `NSLocationWhenInUseUsageDescription` from Task 5, add:
```
NSMicrophoneUsageDescription: "Slippy ใช้ไมโครโฟนสำหรับการโทรคุยกับเพื่อนร่วมทริป"
```

- [ ] **Step 4: Build**

Run:
```bash
cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy \
  -destination 'platform=iOS Simulator,id=<simulator-udid>' build
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
git add ios/Slippy/project.yml ios/Slippy.xcodeproj
git commit -m "chore(trips): add LiveKit Swift SDK dependency"
```

---

## Task 14: iOS — TripCallAPI (token fetch via web)

**Files:**
- Create: `ios/Slippy/Services/TripCallAPI.swift`

**Interfaces:**
- Consumes: `Config.webAppURL`, `SupabaseManager.shared.client.auth.session.accessToken` — same pattern as `TripDocumentAPI.swift`.
- Produces: `TripCallAPI.requestToken(tripId:) async throws -> CallToken` with fields `token`, `url`, `roomName`, `callSessionId`.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/Services/TripCallAPI.swift
import Foundation

/// Mints a LiveKit join token via the web app — the same reason
/// TripDocumentAPI goes through Next.js instead of Supabase directly:
/// this needs a server secret (LIVEKIT_API_SECRET) the app must never hold.
enum TripCallAPI {
    private static let base: String = {
        ProcessInfo.processInfo.environment["WEB_BASE_URL"] ?? Config.webAppURL.absoluteString
    }()

    enum APIError: LocalizedError {
        case notSignedIn
        case server(String)
        case badResponse
        var errorDescription: String? {
            switch self {
            case .notSignedIn:   return "กรุณาเข้าสู่ระบบใหม่"
            case .server(let m): return m
            case .badResponse:   return "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"
            }
        }
    }

    struct CallToken: Codable {
        let token: String
        let url: String
        let roomName: String
        let callSessionId: String
        enum CodingKeys: String, CodingKey {
            case token, url
            case roomName = "roomName"
            case callSessionId = "callSessionId"
        }
    }

    private static func accessToken() async throws -> String {
        guard let token = try? await SupabaseManager.shared.client.auth.session.accessToken else {
            throw APIError.notSignedIn
        }
        return token
    }

    static func requestToken(tripId: String) async throws -> CallToken {
        guard let url = URL(string: "\(base)/api/trips/\(tripId)/calls/token") else {
            throw APIError.badResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "เข้าร่วมสายไม่สำเร็จ (\(http.statusCode))")
        }
        return try JSONDecoder().decode(CallToken.self, from: data)
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd ios && xcrun --sdk iphonesimulator swiftc -typecheck \
  -target arm64-apple-ios17.0-simulator \
  Slippy/Services/TripCallAPI.swift Slippy/Services/SupabaseManager.swift Slippy/App/Config.swift
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Services/TripCallAPI.swift
git commit -m "feat(trips): add TripCallAPI — fetches a LiveKit token via the web app"
```

---

## Task 15: iOS — TripCallViewModel (LiveKit room connect/disconnect)

**Files:**
- Create: `ios/Slippy/ViewModels/TripCallViewModel.swift`

**Interfaces:**
- Consumes: `TripCallAPI` from Task 14; `Room` from the `LiveKit` package (Task 13).
- Produces: `@MainActor class TripCallViewModel: ObservableObject` with `@Published var connected: Bool`, `@Published var connecting: Bool`, `@Published var errorText: String?`, methods `join(tripId:) async`, `leave() async`.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/ViewModels/TripCallViewModel.swift
import Foundation
import LiveKit

/// Voice-only for this plan — never requests or publishes a camera track.
@MainActor
final class TripCallViewModel: ObservableObject {
    @Published var connected = false
    @Published var connecting = false
    @Published var errorText: String?

    private var room: Room?

    func join(tripId: String) async {
        connecting = true
        defer { connecting = false }
        do {
            let callToken = try await TripCallAPI.requestToken(tripId: tripId)
            let room = Room()
            try await room.connect(url: callToken.url, token: callToken.token)
            try await room.localParticipant.setMicrophone(enabled: true)
            self.room = room
            connected = true
        } catch {
            errorText = error.localizedDescription
        }
    }

    func leave() async {
        await room?.disconnect()
        room = nil
        connected = false
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd ios && xcrun --sdk iphonesimulator swiftc -typecheck \
  -target arm64-apple-ios17.0-simulator \
  Slippy/ViewModels/TripCallViewModel.swift Slippy/Services/TripCallAPI.swift Slippy/Services/SupabaseManager.swift Slippy/App/Config.swift
```
Expected: no errors. If `room.connect(url:token:)` or `setMicrophone(enabled:)` don't match the installed LiveKit version's exact labels, this step names the mismatch — fix the call site, not the intent.

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/ViewModels/TripCallViewModel.swift
git commit -m "feat(trips): add TripCallViewModel — voice-only LiveKit room connect/disconnect"
```

---

## Task 16: iOS — call UI in TripDetailView

**Files:**
- Modify: `ios/Slippy/Views/Trips/TripDetailView.swift`

**Interfaces:**
- Consumes: `TripCallViewModel` from Task 15.
- Produces: a "โทร" button in the trip's toolbar menu, connecting/connected states, a minimal in-call banner with a hang-up button.

- [ ] **Step 1: Add the view model**

Alongside the other `@State`/`@StateObject` properties in `TripDetailView`:
```swift
@StateObject private var callVM = TripCallViewModel()
```

- [ ] **Step 2: Add the call button to the toolbar menu**

In the existing `Menu { ... }` in `.toolbar`, add a new `Button` before the closing brace:
```swift
Button {
    hapticLight()
    Task {
        if callVM.connected { await callVM.leave() } else { await callVM.join(tripId: trip.id) }
    }
} label: {
    Label(callVM.connected ? "วางสาย" : "โทรคุยกับทริปนี้",
          systemImage: callVM.connected ? "phone.down.fill" : "phone.fill")
}
```

- [ ] **Step 3: Add a connected-call banner**

In the outer `ZStack` in `body`, after `ScrollView { ... }`, add:
```swift
if callVM.connected {
    VStack {
        Spacer()
        HStack(spacing: 8) {
            Image(systemName: "phone.fill").foregroundColor(.white)
            Text("กำลังคุยสาย").font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
            Spacer()
            Button { Task { await callVM.leave() } } label: {
                Image(systemName: "phone.down.fill").foregroundColor(.white)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.red.opacity(0.9), in: Capsule())
        .padding(.horizontal, 16).padding(.bottom, 16)
    }
}
```

- [ ] **Step 4: Show call errors**

Add a new `.alert` modifier, mirroring the existing `toolError` alert pattern already in this file:
```swift
.alert("โทรไม่สำเร็จ", isPresented: .constant(callVM.errorText != nil)) {
    Button("ตกลง") { callVM.errorText = nil }
} message: { Text(callVM.errorText ?? "") }
```

- [ ] **Step 5: Build**

Run:
```bash
cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy \
  -destination 'platform=iOS Simulator,id=<simulator-udid>' build
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 6: Commit**

```bash
git add ios/Slippy/Views/Trips/TripDetailView.swift
git commit -m "feat(trips): add voice call button and in-call banner to TripDetailView"
```

---

## Task 17: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Location sharing, cross-platform**

On two devices/sessions (one iOS simulator, one web browser) signed in as two different members of the same trip: start sharing from iOS with "15 นาที"; confirm the web session's map shows a moving pin within ~15 seconds; stop sharing from iOS; confirm the web pin greys out within ~60 seconds and disappears once the session's `expires_at` (or an explicit stop) has passed.

- [ ] **Step 2: Voice call, cross-platform**

From the same two sessions: start a call from web; confirm iOS can join the same room (same `room_name` — check `trip_call_sessions` in Supabase Studio) and two-way audio works; hang up from iOS; confirm web's room shows the participant left.

- [ ] **Step 3: Authorization**

As a user who is NOT a participant on the trip, confirm `POST /api/trips/:id/location-sessions` and `POST /api/trips/:id/calls/token` both return 404 (not 403 — see Global Constraints), and that iOS's direct Supabase writes to `trip_location_sessions`/`trip_member_locations` for that trip fail (RLS denies the insert).

- [ ] **Step 4: Removal revokes access**

Remove a participant from the trip (existing member-removal flow) while they have an active location session; confirm their session's `expires_at`/RLS makes it stop appearing to remaining members promptly (within one poll cycle, ≤10s on web / ≤10s on iOS).

- [ ] **Step 5: Report results**

No further steps if all four pass. If anything fails, fix it in the task it belongs to (do not patch around it in Task 17) and re-run that task's own verification before returning here.

---

## Explicitly deferred — not part of this plan

Per the spec addendum (§12) and the sequencing decision made when this plan was written (2026-08-31):

- **CallKit + PushKit native ringing** — needs Apple Developer capabilities (Push Notifications, Voice over IP background mode) and an APNs VoIP auth key that have not been configured yet. Once that's done, this becomes its own plan: a PushKit-triggered incoming-call flow that reports to CallKit and joins the same `trip_call_sessions` room this plan already builds — no schema or route changes needed, only the native call-UI layer.
- **360 action-camera photo/video import + viewer**, and **YouTube Live broadcasting via LiveKit Ingress/Egress** — lower priority, and the YouTube Live path depends on Insta360 shipping the X6's promised live-streaming firmware update (not yet confirmed live as of the spec's research). Each gets its own plan once prioritized; neither blocks anything in this plan.
