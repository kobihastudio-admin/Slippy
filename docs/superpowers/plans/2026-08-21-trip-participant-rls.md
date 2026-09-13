# Trip Participant-Scoped RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace organization-scoped RLS policies on the 8 trip child tables with participant-scoped ones, closing the gap where any org member can currently read every trip's participants, expenses, payments, itinerary, and preorder items via the two SSR pages that query through the RLS-bound Supabase client.

**Architecture:** One new `SECURITY DEFINER` helper function, `is_trip_participant(p_journey_id uuid)`, mirroring the existing `is_conversation_member()` pattern (migration 055) and matching `getTripAccess()`'s already-tested rule (owner OR active participant). Every hardened table's policy becomes a one-line call to it. No application code changes — every API route already enforces this correctly via service-role + `getTripAccess()`; only the two RLS-reliant SSR pages are affected, and only for the better (they'll return correctly-scoped rows instead of over-broad ones).

**Tech Stack:** PostgreSQL RLS policies, Supabase CLI (local stack for testing), plain SQL test script (no pgTAP — no existing test-SQL convention in this repo to extend, and this keeps the dependency footprint at zero).

**Spec:** [docs/superpowers/specs/2026-08-21-trip-participant-rls-design.md](../specs/2026-08-21-trip-participant-rls-design.md)

## Global Constraints

- Exactly these 8 tables get new policies: `trip_participants`, `trip_expenses`, `expense_splits`, `trip_payments`, `trip_itinerary_days`, `trip_itinerary_items`, `preorder_sessions`, `preorder_items`. (Spec: Scope)
- `life_journeys` and `trip_settlements` stay untouched — `life_journeys` is shared with the unrelated Life Graph feature, `trip_settlements` belongs to the unrelated `trip-groups`/`split_bills` system. (Spec: Decisions Confirmed, Complication)
- No application code changes anywhere in this plan — every API route already uses service-role + `getTripAccess()`. (Spec: No application code changes)
- New migration file number is `094` — the latest existing migration is `093_remove_legacy_upsert_vendor_overload.sql`. (Verify this is still true before writing the file — another migration may have landed since this plan was written.)
- Never run any step of this plan against the real dev/prod Supabase project — local stack only (`supabase start`, default local Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). (Spec: Testing, Decisions Confirmed #3)
- Do not touch historical migrations (001-093) — only add the new `094` file. Standard repo convention, confirmed in the earlier Trip Full Loop work.

---

## Task 1: Migration — `is_trip_participant()` helper and policy replacement

**Files:**
- Create: `supabase/migrations/094_trip_participant_scoped_rls.sql`

**Interfaces:**
- Produces: SQL function `public.is_trip_participant(p_journey_id uuid) RETURNS boolean`, and replaced RLS policies on the 8 tables listed in Global Constraints. Task 2 depends on the policy names this task creates (`tp_participant`, `te_participant`, `es_participant`, `tpay_participant`, `preorder_sessions_participant`, `preorder_items_participant`, `tid_participant`, `tii_participant`) only to confirm they exist — Task 2's actual test queries hit the tables directly, not the policy names, so exact naming doesn't constrain Task 2's SQL, only its verification step.

- [ ] **Step 1: Confirm the next migration number is still 094**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
ls supabase/migrations/ | sort | tail -5
```

Expected: highest-numbered file is `093_remove_legacy_upsert_vendor_overload.sql`. If a newer migration exists, use the next number after it instead of 094 throughout this plan.

- [ ] **Step 2: Write the migration file**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 094_trip_participant_scoped_rls.sql
--
-- Replaces organization-scoped RLS on the 8 trip child tables with
-- participant-scoped RLS, matching the rule already enforced (and tested) in
-- application code by getTripAccess() (web/src/lib/trips/trip-access.ts):
-- a user may see a trip's data if they own it (life_journeys.user_id) or are
-- an active participant (trip_participants row, user_id set, left_at NULL).
--
-- Every trip API route already uses the service-role client + getTripAccess()
-- for its real authorization, bypassing RLS entirely — this migration closes
-- the gap in the two server-rendered pages that read trip data through the
-- RLS-bound client instead: web/src/app/(app)/trips/page.tsx and
-- web/src/app/(app)/trips/[id]/page.tsx. No application code changes.
--
-- life_journeys itself is deliberately NOT touched here — it's shared with
-- the unrelated Life Graph feature (web/src/app/(app)/life/journey/page.tsx),
-- which intentionally lists every org journey regardless of trip
-- participation, and stays on its existing org-scoped policy
-- (life_journeys_member, migration 025).
--
-- trip_settlements is also NOT touched — it belongs to a different, older
-- feature (trip-groups/split_bills, web/src/app/api/liff/trip-groups/), not
-- the life_journeys-based trip system this migration hardens.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper function ──────────────────────────────────────────────────────────
-- Mirrors the is_conversation_member() pattern from 055_recent_features_security.sql.
CREATE OR REPLACE FUNCTION public.is_trip_participant(p_journey_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM life_journeys
    WHERE id = p_journey_id AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM trip_participants
    WHERE journey_id = p_journey_id AND user_id = auth.uid() AND left_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_trip_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_trip_participant(uuid) TO authenticated;

-- ── Direct journey_id tables (1 hop) ─────────────────────────────────────────
DROP POLICY IF EXISTS "tp_org_member" ON trip_participants;
CREATE POLICY "tp_participant" ON trip_participants FOR ALL USING (is_trip_participant(journey_id));

DROP POLICY IF EXISTS "te_org_member" ON trip_expenses;
CREATE POLICY "te_participant" ON trip_expenses FOR ALL USING (is_trip_participant(journey_id));

DROP POLICY IF EXISTS "tpay_org_member" ON trip_payments;
CREATE POLICY "tpay_participant" ON trip_payments FOR ALL USING (is_trip_participant(journey_id));

DROP POLICY IF EXISTS "preorder_sessions_org_member" ON preorder_sessions;
CREATE POLICY "preorder_sessions_participant" ON preorder_sessions FOR ALL USING (is_trip_participant(journey_id));

-- ── 2-hop tables ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "es_org_member" ON expense_splits;
CREATE POLICY "es_participant" ON expense_splits FOR ALL USING (
  is_trip_participant((SELECT journey_id FROM trip_expenses WHERE id = expense_splits.expense_id))
);

DROP POLICY IF EXISTS "preorder_items_org_member" ON preorder_items;
CREATE POLICY "preorder_items_participant" ON preorder_items FOR ALL USING (
  is_trip_participant((SELECT journey_id FROM preorder_sessions WHERE id = preorder_items.session_id))
);

-- ── Itinerary tables — consolidate the two redundant org-scoped policies ────
-- 055_recent_features_security.sql created trip_days_org_member/
-- trip_items_org_member scoped via the legacy split_bills path.
-- 074_itinerary_and_preorder.sql later added tid_org_member/tii_org_member
-- scoped via the current journey_id path, but never dropped the 055 ones —
-- both are active today (Postgres OR's multiple permissive policies
-- together). This block checks whether any row still only has the legacy
-- split_bill_id set (no journey_id) before deciding how to replace them: if
-- none do, the legacy path is provably dead and gets dropped cleanly; if any
-- do, their access is preserved via an OR-branch in the new single policy
-- rather than silently orphaning that data. Either way, the result is one
-- policy per table instead of two overlapping ones.
DO $$
DECLARE
  legacy_days_count  int;
  legacy_items_count int;
BEGIN
  SELECT count(*) INTO legacy_days_count
    FROM trip_itinerary_days
    WHERE journey_id IS NULL AND split_bill_id IS NOT NULL;

  SELECT count(*) INTO legacy_items_count
    FROM trip_itinerary_items
    WHERE day_id IN (
      SELECT id FROM trip_itinerary_days
      WHERE journey_id IS NULL AND split_bill_id IS NOT NULL
    );

  DROP POLICY IF EXISTS "tid_org_member" ON trip_itinerary_days;
  DROP POLICY IF EXISTS "trip_days_org_member" ON trip_itinerary_days;
  DROP POLICY IF EXISTS "tii_org_member" ON trip_itinerary_items;
  DROP POLICY IF EXISTS "trip_items_org_member" ON trip_itinerary_items;

  IF legacy_days_count = 0 AND legacy_items_count = 0 THEN
    RAISE NOTICE 'No rows depend on the legacy split_bill_id path — dropping it cleanly.';

    EXECUTE 'CREATE POLICY "tid_participant" ON trip_itinerary_days FOR ALL USING (
      journey_id IS NOT NULL AND is_trip_participant(journey_id)
    )';

    EXECUTE 'CREATE POLICY "tii_participant" ON trip_itinerary_items FOR ALL USING (
      is_trip_participant((SELECT journey_id FROM trip_itinerary_days WHERE id = trip_itinerary_items.day_id))
    )';
  ELSE
    RAISE NOTICE 'Found % legacy day row(s) and % legacy item row(s) still on split_bill_id — preserving their access.', legacy_days_count, legacy_items_count;

    EXECUTE 'CREATE POLICY "tid_participant" ON trip_itinerary_days FOR ALL USING (
      (journey_id IS NOT NULL AND is_trip_participant(journey_id))
      OR (split_bill_id IS NOT NULL AND split_bill_id IN (
        SELECT b.id FROM split_bills b
        JOIN organization_members om ON om.organization_id = b.organization_id
        WHERE om.user_id = auth.uid()
      ))
    )';

    EXECUTE 'CREATE POLICY "tii_participant" ON trip_itinerary_items FOR ALL USING (
      day_id IN (
        SELECT id FROM trip_itinerary_days d WHERE
          (d.journey_id IS NOT NULL AND is_trip_participant(d.journey_id))
          OR (d.split_bill_id IS NOT NULL AND d.split_bill_id IN (
            SELECT b.id FROM split_bills b
            JOIN organization_members om ON om.organization_id = b.organization_id
            WHERE om.user_id = auth.uid()
          ))
      )
    )';
  END IF;
END $$;
```

- [ ] **Step 3: Start the local Supabase stack**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
supabase start
```

Expected: starts successfully and prints local connection details, including `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`. If it's already running (from a previous task), this command reports that and exits cleanly rather than erroring — either outcome is fine.

- [ ] **Step 4: Apply all migrations fresh, including 094**

```bash
supabase db reset
```

Expected: completes without any line containing `ERROR`. Watch for the `RAISE NOTICE` lines from Step 2's `DO` block — either "No rows depend on the legacy split_bill_id path" (expected on a fresh local DB with no seed data referencing `split_bills`) or the "Found N legacy..." branch. Either is a correct outcome; note which one printed, since Task 2 doesn't need to change based on it, but it's worth recording in the report.

- [ ] **Step 5: Verify the new policies exist and the old ones are gone**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN (
  'trip_participants','trip_expenses','expense_splits','trip_payments',
  'trip_itinerary_days','trip_itinerary_items','preorder_sessions','preorder_items'
)
ORDER BY tablename, policyname;
"
```

Expected: exactly one policy per table, all ending in `_participant` (`tp_participant`, `te_participant`, `es_participant`, `tpay_participant`, `tid_participant`, `tii_participant`, `preorder_sessions_participant`, `preorder_items_participant`). No `_org_member` names anywhere in the output.

- [ ] **Step 6: Verify `life_journeys` and `trip_settlements` are unchanged**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('life_journeys','trip_settlements')
ORDER BY tablename, policyname;
"
```

Expected: `life_journeys_member` on `life_journeys`, `trip_settlements_org_member` on `trip_settlements` — both untouched, matching Global Constraints.

- [ ] **Step 7: Commit**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git add supabase/migrations/094_trip_participant_scoped_rls.sql
git commit -m "feat(db): participant-scoped RLS on trip child tables

Replaces organization-scoped RLS with participant-scoped RLS (owner or
active trip_participants row) on trip_participants, trip_expenses,
expense_splits, trip_payments, trip_itinerary_days,
trip_itinerary_items, preorder_sessions, and preorder_items — matching
the rule already enforced in application code by getTripAccess().
Closes the gap where any org member could read another member's trip
details via the two SSR pages that query through the RLS-bound client.
life_journeys and trip_settlements are untouched (shared with unrelated
features). No application code changes."
```

---

## Task 2: SQL RLS verification script + regression check

**Files:**
- Create: `supabase/tests/094_trip_participant_scoped_rls.test.sql`

**Interfaces:**
- Consumes: the 8 policies and `is_trip_participant()` function from Task 1, applied to the local Supabase instance already running from Task 1 Step 3.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/094_trip_participant_scoped_rls.test.sql
--
-- Verifies the participant-scoped RLS added by
-- 094_trip_participant_scoped_rls.sql actually restricts visibility on the 8
-- hardened trip tables. Creates a trip owner, an active participant, an
-- org-outsider (same organization, never added to the trip), and a departed
-- participant (was on the trip, left) — then simulates each one via
-- request.jwt.claims and asserts who can see what.
--
-- LOCAL SUPABASE ONLY. Never run against the real dev/prod project.
-- Run: supabase start && supabase db reset (applies 094), then:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/094_trip_participant_scoped_rls.test.sql

\set ON_ERROR_STOP on

-- ── Setup (as postgres superuser — bypasses RLS entirely) ──────────────────
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'rls-owner@test.local',       'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'rls-participant@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'rls-outsider@test.local',    'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'rls-departed@test.local',    'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
-- NOTE: if this INSERT errors on a column that doesn't exist or isn't
-- nullable in this Supabase version's auth.users schema, run
-- `\d auth.users` locally and adjust the column list to match — the row's
-- shape (a valid authenticated user this project's own handle_new_user()
-- trigger can act on) is what matters, not these exact optional columns.

INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'RLS Test Org', 'rls-test-org-094')
ON CONFLICT (id) DO NOTHING;

INSERT INTO organization_members (organization_id, user_id, role)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b', 'viewer'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000c', 'viewer'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000d', 'viewer')
ON CONFLICT (organization_id, user_id) DO NOTHING;

INSERT INTO life_journeys (id, organization_id, user_id, title, journey_type, trip_type)
VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'RLS Test Trip', 'trip', 'travel')
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_participants (id, journey_id, user_id, display_name, is_host)
VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a', 'Owner', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_participants (id, journey_id, user_id, display_name)
VALUES ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'Participant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_participants (id, journey_id, user_id, display_name, left_at)
VALUES ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000d', 'Departed', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_expenses (id, journey_id, paid_by_id, title, amount)
VALUES ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', 'Test Expense', 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_splits (id, expense_id, participant_id, amount)
VALUES ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f4', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_payments (id, journey_id, from_participant, to_participant, amount)
VALUES ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f3', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_itinerary_days (id, journey_id, day_number)
VALUES ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000f2', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trip_itinerary_items (id, day_id, title)
VALUES ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000f9', 'Test Activity')
ON CONFLICT (id) DO NOTHING;

INSERT INTO preorder_sessions (id, journey_id, title)
VALUES ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000f2', 'Test Preorder')
ON CONFLICT (id) DO NOTHING;

INSERT INTO preorder_items (id, session_id, participant_id, name, price)
VALUES ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000f4', 'Test Item', 60)
ON CONFLICT (id) DO NOTHING;

-- ── Assertion helper ─────────────────────────────────────────────────────────
-- Plain SECURITY INVOKER function: runs under whatever role/JWT the calling
-- session has active via SET LOCAL, so it sees exactly what that
-- impersonated user would see through RLS.
CREATE OR REPLACE FUNCTION pg_temp.assert_visible(p_label text, p_sql text, p_expect_visible boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  EXECUTE p_sql INTO n;
  IF p_expect_visible AND n = 0 THEN
    RAISE EXCEPTION 'FAIL: % — expected the row to be visible, saw none', p_label;
  ELSIF NOT p_expect_visible AND n > 0 THEN
    RAISE EXCEPTION 'FAIL: % — expected the row to be hidden, saw %', p_label, n;
  ELSE
    RAISE NOTICE 'PASS: %', p_label;
  END IF;
END;
$$;

-- ── Per-user, per-table checks ───────────────────────────────────────────────
-- One BEGIN/COMMIT block per simulated user so SET LOCAL doesn't leak between
-- them. Each block re-runs the same 8 counts; TABLE_CHECKS is inlined per
-- block rather than looped, since looping would require its own layer of
-- dynamic SQL for no real reduction in what's being verified.

-- Macro-ish helper: the 8 count queries, reused across all 4 user blocks.
-- (Written out per block below, not abstracted further — see plan's Task 2
-- rationale for why: this repo has no existing SQL test-looping convention
-- to extend, and four inlined blocks are more auditable than a generic loop
-- for a script this size.)

-- Owner: must see everything.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
SELECT pg_temp.assert_visible('owner sees trip_participants',    'SELECT count(*) FROM trip_participants WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('owner sees trip_expenses',        'SELECT count(*) FROM trip_expenses WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('owner sees expense_splits',       'SELECT count(*) FROM expense_splits WHERE id = ''00000000-0000-0000-0000-0000000000f7''', true);
SELECT pg_temp.assert_visible('owner sees trip_payments',        'SELECT count(*) FROM trip_payments WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('owner sees trip_itinerary_days',  'SELECT count(*) FROM trip_itinerary_days WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('owner sees trip_itinerary_items', 'SELECT count(*) FROM trip_itinerary_items WHERE id = ''00000000-0000-0000-0000-0000000000fa''', true);
SELECT pg_temp.assert_visible('owner sees preorder_sessions',    'SELECT count(*) FROM preorder_sessions WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('owner sees preorder_items',       'SELECT count(*) FROM preorder_items WHERE id = ''00000000-0000-0000-0000-0000000000fc''', true);
COMMIT;

-- Active participant: must see everything too.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
SELECT pg_temp.assert_visible('participant sees trip_participants',    'SELECT count(*) FROM trip_participants WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('participant sees trip_expenses',        'SELECT count(*) FROM trip_expenses WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('participant sees expense_splits',       'SELECT count(*) FROM expense_splits WHERE id = ''00000000-0000-0000-0000-0000000000f7''', true);
SELECT pg_temp.assert_visible('participant sees trip_payments',        'SELECT count(*) FROM trip_payments WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('participant sees trip_itinerary_days',  'SELECT count(*) FROM trip_itinerary_days WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('participant sees trip_itinerary_items', 'SELECT count(*) FROM trip_itinerary_items WHERE id = ''00000000-0000-0000-0000-0000000000fa''', true);
SELECT pg_temp.assert_visible('participant sees preorder_sessions',    'SELECT count(*) FROM preorder_sessions WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', true);
SELECT pg_temp.assert_visible('participant sees preorder_items',       'SELECT count(*) FROM preorder_items WHERE id = ''00000000-0000-0000-0000-0000000000fc''', true);
COMMIT;

-- Org-outsider: same org, never added to the trip — must see nothing. This
-- is the case that was BROKEN before this migration (org-scoped RLS let
-- them see everything); it's the core regression this whole plan exists to fix.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
SELECT pg_temp.assert_visible('outsider does NOT see trip_participants',    'SELECT count(*) FROM trip_participants WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
SELECT pg_temp.assert_visible('outsider does NOT see trip_expenses',        'SELECT count(*) FROM trip_expenses WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
SELECT pg_temp.assert_visible('outsider does NOT see expense_splits',       'SELECT count(*) FROM expense_splits WHERE id = ''00000000-0000-0000-0000-0000000000f7''', false);
SELECT pg_temp.assert_visible('outsider does NOT see trip_payments',        'SELECT count(*) FROM trip_payments WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
SELECT pg_temp.assert_visible('outsider does NOT see trip_itinerary_days',  'SELECT count(*) FROM trip_itinerary_days WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
SELECT pg_temp.assert_visible('outsider does NOT see trip_itinerary_items', 'SELECT count(*) FROM trip_itinerary_items WHERE id = ''00000000-0000-0000-0000-0000000000fa''', false);
SELECT pg_temp.assert_visible('outsider does NOT see preorder_sessions',    'SELECT count(*) FROM preorder_sessions WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
SELECT pg_temp.assert_visible('outsider does NOT see preorder_items',       'SELECT count(*) FROM preorder_items WHERE id = ''00000000-0000-0000-0000-0000000000fc''', false);
COMMIT;

-- Departed participant: left_at is set — must see nothing (mirrors the
-- existing unit test "a departed participant loses trip access" in
-- trip-conversation.test.mjs, verified here at the RLS layer instead of the
-- application layer). Checked once via trip_participants — the rule lives
-- entirely inside is_trip_participant(), shared by all 8 policies, so this
-- is sufficient to prove departure is honored, not something that needs
-- re-verifying per table.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
SELECT pg_temp.assert_visible('departed participant does NOT see trip_participants', 'SELECT count(*) FROM trip_participants WHERE journey_id = ''00000000-0000-0000-0000-0000000000f2''', false);
COMMIT;

-- If every line above printed PASS with no FAIL/ERROR, and psql was invoked
-- with -v ON_ERROR_STOP=1, this script exits 0. Any RAISE EXCEPTION aborts
-- the containing transaction and returns nonzero.
```

- [ ] **Step 2: Run the test script**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/094_trip_participant_scoped_rls.test.sql
```

Expected: 25 `NOTICE:  PASS: ...` lines (8 owner + 8 participant + 8 outsider + 1 departed), zero `FAIL`, exit code 0. If the `auth.users` INSERT in Step 1 errors, run `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d auth.users"` to see the actual local schema and adjust the column list in the script to match, then re-run.

- [ ] **Step 3: If anything FAILed, fix Task 1's migration, not this test**

A `FAIL` here means the policy logic in `094_trip_participant_scoped_rls.sql` doesn't match the intended rule — go back to Task 1 Step 2, fix the specific policy, re-run `supabase db reset`, then re-run this script from Step 2. Do not weaken an assertion in this script to make it pass; the assertions encode the actual requirement from the spec's Problem section.

- [ ] **Step 4: Regression — confirm no application code was affected**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run typecheck
npm run test:trips
```

Expected: typecheck passes with zero errors; `test:trips` shows `# tests 17`, `# pass 17`, `# fail 0` — identical to before this plan, since no application file was touched.

- [ ] **Step 5: Commit**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git add supabase/tests/094_trip_participant_scoped_rls.test.sql
git commit -m "test(db): verify participant-scoped RLS on trip tables

SQL script simulating a trip owner, active participant, org-outsider,
and departed participant against a local Supabase instance, asserting
each of the 8 hardened tables is visible only to the owner and active
participant — the org-outsider case is the regression this migration
exists to fix. Local-only; never run against real data."
```

---

## Known follow-ups (deliberately not in this plan)

- The Life Graph feature (`/life/journey`, `/api/life/journeys`, `/api/life/graph`) was confirmed to legitimately depend on `life_journeys` staying org-scoped, and is otherwise untouched by this plan. If a future need arises to also restrict trip-type journeys from Life Graph's org-wide view, that requires product-level scoping decisions (does Life Graph filter out trip_type rows for non-participants, or show them redacted?) beyond what this plan's spec settled — a new design conversation, not a mechanical follow-on.
- Route-level integration tests for the trip API routes (flagged as out of scope in the earlier Trip Members UI plan) remain a separate, un-started piece of work — unrelated to RLS, no dependency either direction.
