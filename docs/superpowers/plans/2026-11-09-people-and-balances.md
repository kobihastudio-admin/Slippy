# One Person + "ยอดค้าง" Between Friends — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link bill/sport participants to real Slippy users, and show a per-friend "ยอดค้าง" (balance) in the friends list, the 1:1 chat and a detail screen, computed from bills, sport sessions, trips and standalone payment requests.

**Architecture:** One additive migration adds `split_participants.user_id` and a read-only `SECURITY DEFINER` function `friend_balances()` (bills, sport, requests, scoped to the caller and to accepted friends). Trips live in a separate function `friend_balances_trips()` behind a verification gate (Task 2), so it can be dropped without touching the rest. iOS gets a Foundation-only `BalancePresentation` (tested with `swiftc`), a small `BalanceViewModel`, and thin views. Bill creation on iOS learns to pick social friends and send `user_id`.

**Tech Stack:** Postgres/Supabase (SQL, local-only psql tests), Swift 5 / SwiftUI (iOS 17), supabase-swift 2.48.0 (unchanged), `swiftc` host scripts, `xcodebuild` + `simctl`.

**Spec:** `docs/superpowers/specs/2026-11-09-people-and-balances-design.md` (approved 2026-11-09). Section 9 there lists the planning amendments found while writing this plan — read it first.

## Global Constraints

- Scope: linking + read-only balances. **No change to how any amount is calculated or settled**, no "mark paid"/"request money"/reminders, no chat money cards, no web UI, no LINE changes beyond using `line_connections` for linking.
- **No `git commit`, `git push`, merge, branch change.** Commit authority is a separate approval. "Checkpoint" steps only list changed files.
- **No production database writes and no production migration.** SQL is applied and tested **only on a local Supabase** (`127.0.0.1`). The production migration, any read of real rows, and any deploy are separate approvals. Never read real bills, friends, requests or conversations while verifying; fixtures only. Never enter credentials.
- Work in place at `/Users/chainimitsakhorn/Documents/Project/Slippy` (the preview mechanism in `SlippyApp.swift` is uncommitted work a worktree would lack). Pre-existing dirty files (51 entries at planning time: 48 earlier + 3 spec docs, plus this plan = 52) stay byte-for-byte untouched, **including `ios/Slippy/ViewModels/TripsViewModel.swift` and `ios/Slippy/Models/TripModels.swift`**, except the additive hunk in `ios/Slippy/App/SlippyApp.swift` (Task 7).
- Host scripts: `PATH=/usr/local/bin:$PATH node …` (nvm node is x86_64). `xcodegen` does **not** run on this Mac (Intel binary, no Rosetta): register new Swift files with the Ruby helper in Preflight Step 3 and say so in the final report.
- Money rules (verbatim from the spec, with the planning rulings in spec §9): a row that cannot be attributed is **never added to any amount**; amounts are shown with the breakdown, never only the net; counterparts are **accepted friends only**; payment requests that carry `split_bill_id` are never counted; only `THB`.
- UI strings (Thai, exact): friends chip `ค้างคุณ ฿<n>` / `คุณค้าง ฿<n>`; chat line `ค้างกัน ฿<n> · ดูรายละเอียด`; empty `ยังไม่มียอดค้างกับ <ชื่อ>`; unattributed `มี <N> รายการที่คำนวณยอดให้ไม่ได้`; trips missing `ยังไม่รวมยอดจากทริป`; failure `โหลดยอดค้างไม่สำเร็จ ลองใหม่อีกครั้ง`. Money format `฿1,234.50` (no decimals when whole).
- Palette: adaptive colors from `SlippyColors.swift` only.
- Deployment order is part of the design: **migration first, iOS second.** An iOS build that sends `user_id` against a database without the column fails bill creation.

## Review Focus

1. **Wrong money.** Each source rule must hold: payer detection (single receipt payer; sport → creator; otherwise unattributed), unpaid only, payer's own row excluded, guests excluded, a bill+request counted once, expired/non-THB requests ignored, mirrored views equal. → Task 1 SQL test.
2. **Unsolicited debts.** Any org member can insert a participant with any `user_id` (existing policy). A non-friend linked to a bill must not produce a row for anyone. → Task 1 SQL test (stranger case).
3. **The trip settlement function may lose money for 3+ people** (`calculate_trip_settlement` credits the payer only with their *own* share). Do not build on it unless proven correct. → Task 2 gate.
4. **Non-THB trips and requests** must be flagged/ignored, not summed with baht. → Tasks 1, 2.
5. **Chat room reuse + failure honesty.** `FriendChatRoomView` is also the trip chat: no balance line there. If the balance call fails, hide the UI (never show a misleading zero). → Tasks 3, 5 review.
6. **Existing LINE participants** (a `line_user_id` with no `user_id`) must resolve at read time, including ones created after the migration. → Task 1 SQL test.

---

## Preflight (do once, before Task 1)

- [ ] **Step 1: Confirm target files are clean**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short ios/Slippy/Views/Social ios/Slippy/Views/Split ios/Slippy/Views/Chat ios/Slippy/ViewModels/MessagesViewModel.swift ios/Slippy/ViewModels/SplitViewModel.swift ios/Slippy/ViewModels/SocialViewModel.swift ios/Slippy/Models/MessageModels.swift ios/Slippy/Models/SplitModels.swift ios/Slippy/Utils supabase/migrations supabase/tests | grep -v -E "medication"
git status --short | wc -l
git log --oneline -1
```

Expected: first command prints nothing; count is `52` (record the actual number — it is the baseline for Task 7); HEAD is `e07a128` or later descendant on `feat/ios-friend-management`. If the first command prints anything, stop and report `CHECKPOINT_DRIFT`.

- [ ] **Step 2: Local Supabase availability** (Tasks 1–2 need it)

```bash
docker info >/dev/null 2>&1 && echo "docker up" || echo "docker DOWN"
supabase --version
```

Expected: `docker up`. If `docker DOWN`: ask the user to start Docker Desktop (do not install anything). If it cannot be started, **stop at Task 1**, report SQL verification as not obtainable, and do not proceed to Tasks 3+ that depend on the function's shape being proven (Tasks 3–6 can still be built against fixtures, but must be reported as unverified against the database).
Then, from the repo root: `supabase start` and `supabase db reset` (applies all migrations to the **local** database only). Expected: both succeed. If `db reset` fails on a pre-existing migration for reasons outside this plan, report the exact error and stop.

- [ ] **Step 3: Project-registration helper** (xcodegen cannot run here)

Create `$SCRATCH/add_files.rb` (SCRATCH = the session scratchpad directory; **not** in the repo):

```ruby
require 'xcodeproj'
root = '/Users/chainimitsakhorn/Documents/Project/Slippy/ios'
proj = Xcodeproj::Project.open("#{root}/Slippy.xcodeproj")
target = proj.targets.find { |t| t.name == 'Slippy' } or abort 'no Slippy target'
files = ARGV
abort 'usage: ruby add_files.rb <path relative to ios/> ...' if files.empty?
files.each do |rel|
  abs = "#{root}/#{rel}"
  abort "missing file #{rel}" unless File.exist?(abs)
  if proj.files.any? { |f| f.real_path.to_s == abs }
    puts "already: #{rel}"; next
  end
  group = proj.main_group
  File.dirname(rel).split('/').each do |part|
    child = group.children.find { |c| c.is_a?(Xcodeproj::Project::Object::PBXGroup) && (c.display_name == part || c.path == part) }
    abort "missing group #{part} for #{rel}" unless child
    group = child
  end
  ref = group.new_file(abs)
  target.source_build_phase.add_file_reference(ref)
  puts "added: #{rel}"
end
proj.save
```

- [ ] **Step 4: Baseline build** (so later "build succeeds" claims mean something)

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
./scripts/build-simulator.sh > /private/tmp/slippy-bal-baseline.log 2>&1; echo "exit=$?"
grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-bal-baseline.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. If it fails in files this plan does not touch, stop and report.

---

### Task 1: Migration — linking column + `friend_balances()` (bills, sport, requests) + local SQL test

**Files:**
- Create: `supabase/tests/friend_balances.test.sql`
- Create: `supabase/migrations/20261109120000_friend_balances.sql`

**Interfaces:**
- Produces (SQL):
  - `split_participants.user_id uuid null references users(id) on delete set null`, partial index on it, index `split_bills(creator_id)`.
  - `public.friend_balances()` → `TABLE(counterpart_user_id uuid, direction text, amount numeric, source_kind text, source_id uuid, title text, occurred_at timestamptz, attributed boolean)`. `direction` ∈ `they_owe_me | i_owe_them`; `source_kind` ∈ `bill | sport | request`; `attributed=false` rows have a friend counterpart and are **never summed**. Executable by `authenticated` only.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/friend_balances.test.sql`:

```sql
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
  ('f8000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'bal-d@test.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO organizations (id, name, slug) VALUES ('f8000000-0000-0000-0000-00000000000f', 'Balance Test Org', 'balance-test-org');

-- A–B accepted (A requested); C–A accepted (C requested). D is nobody's friend.
INSERT INTO friendships (requester_id, addressee_id, status) VALUES
  ('f8000000-0000-0000-0000-0000000000a1', 'f8000000-0000-0000-0000-0000000000b1', 'accepted'),
  ('f8000000-0000-0000-0000-0000000000c1', 'f8000000-0000-0000-0000-0000000000a1', 'accepted');

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
SELECT pg_temp.assert_num('A: B owes A = 100 (bill) + 80 (request)', pg_temp.sum_for('b1','they_owe_me'), 180);
SELECT pg_temp.assert_num('A: A owes B = 60 (sport)',                 pg_temp.sum_for('b1','i_owe_them'), 60);
SELECT pg_temp.assert_num('A: C owes A = 40 (LINE-linked row, paid row excluded)', pg_temp.sum_for('c1','they_owe_me'), 40);
SELECT pg_temp.assert_num('A: nothing owed to C', pg_temp.sum_for('c1','i_owe_them'), 0);
SELECT pg_temp.assert_num('A: no row at all for stranger D',
  'SELECT count(*) FROM friend_balances() WHERE counterpart_user_id = ''f8000000-0000-0000-0000-0000000000d1''', 0);
SELECT pg_temp.assert_num('A: exactly one unattributed row (b3, counterpart C)',
  'SELECT count(*) FROM friend_balances() WHERE NOT attributed AND counterpart_user_id = ''f8000000-0000-0000-0000-0000000000c1''', 1);
SELECT pg_temp.assert_num('A: unattributed rows are never part of an attributed sum (grand attributed total = 180+60+40)',
  'SELECT COALESCE(SUM(amount),0) FROM friend_balances() WHERE attributed', 280);
SELECT pg_temp.assert_num('A: the request that carries a bill is not counted (request rows = 1)',
  'SELECT count(*) FROM friend_balances() WHERE source_kind = ''request''', 1);
SELECT pg_temp.assert_num('A: sport row has kind sport',
  'SELECT count(*) FROM friend_balances() WHERE source_kind = ''sport'' AND attributed', 1);
RESET ROLE;

-- ── B (mirror of A's B-rows) ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT pg_temp.assert_num('B: B owes A = 100 + 80', pg_temp.sum_for('a1','i_owe_them'), 180);
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
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/friend_balances.test.sql 2>&1 | tail -6
```

Expected: FAIL — `column "user_id" of relation "split_participants" does not exist` (the migration is not applied yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261109120000_friend_balances.sql`:

```sql
-- 20261109120000_friend_balances.sql
-- One person across features + a read-only per-friend balance function.
--
-- 1. split_participants gets an optional user_id so bill/sport participants can
--    be the same person as a Slippy friend (trip_participants already has it).
-- 2. friend_balances(): what the caller owes / is owed by each ACCEPTED friend
--    across bills, sport sessions and standalone payment requests.
--    SECURITY DEFINER because bills are readable per organization while the
--    friend may be in another organization. It is scoped to auth.uid() and to
--    accepted friends, and exposes only the minimum a person needs to
--    understand their own debt. Trips are a separate function (see
--    20261109120100_friend_balances_trips.sql).
--
-- Rules (see docs/superpowers/specs/2026-11-09-people-and-balances-design.md):
--  - participant person = COALESCE(user_id, the user connected to its LINE id)
--  - bill payer = the single receipt payer; a sport session with no receipts is
--    paid by its creator; anything else is "unattributed" (attributed = false,
--    never to be summed by clients)
--  - only unpaid (paid_at IS NULL), amount > 0 participant rows owe money, never
--    the payer's own row
--  - requests with a split_bill_id are not counted (the bill is the debt); only
--    pending, unexpired, THB requests between two users count
--  - only accepted friends are returned (stops strangers being linked to a bill
--    to attach a debt to someone)

-- ── 1. Linking column ──────────────────────────────────────────────────────
ALTER TABLE public.split_participants
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_split_parts_user
  ON public.split_participants(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_split_bills_creator
  ON public.split_bills(creator_id);

-- Backfill only the unambiguous case: a LINE id that is connected to a user.
-- line_connections.line_user_id is UNIQUE, so this can never pick between two
-- people. Never match by name. Later rows are resolved at read time below.
UPDATE public.split_participants sp
SET user_id = lc.user_id
FROM public.line_connections lc
WHERE sp.user_id IS NULL
  AND sp.line_user_id IS NOT NULL
  AND sp.line_user_id = lc.line_user_id;

-- ── 2. friend_balances() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_balances()
RETURNS TABLE (
  counterpart_user_id uuid,
  direction           text,
  amount              numeric,
  source_kind         text,
  source_id           uuid,
  title               text,
  occurred_at         timestamptz,
  attributed          boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH me AS (SELECT auth.uid() AS uid),
friends AS (
  SELECT CASE WHEN f.requester_id = (SELECT uid FROM me) THEN f.addressee_id ELSE f.requester_id END AS fid
  FROM friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = (SELECT uid FROM me) OR f.addressee_id = (SELECT uid FROM me))
),
my_bills AS (
  SELECT b.id AS bill_id FROM split_bills b WHERE b.creator_id = (SELECT uid FROM me)
  UNION
  SELECT sp.split_bill_id
  FROM split_participants sp
  LEFT JOIN line_connections lc ON lc.line_user_id = sp.line_user_id
  WHERE COALESCE(sp.user_id, lc.user_id) = (SELECT uid FROM me)
),
parts AS (
  SELECT sp.id, sp.split_bill_id, sp.amount, sp.paid_at,
         COALESCE(sp.user_id, lc.user_id) AS uid
  FROM split_participants sp
  LEFT JOIN line_connections lc ON lc.line_user_id = sp.line_user_id
  WHERE sp.split_bill_id IN (SELECT bill_id FROM my_bills)
),
receipt_payers AS (
  SELECT r.split_bill_id,
         count(DISTINCT r.paid_by_participant_id) AS payers,
         count(*) FILTER (WHERE r.paid_by_participant_id IS NULL) AS unknown_payers,
         (array_agg(r.paid_by_participant_id) FILTER (WHERE r.paid_by_participant_id IS NOT NULL))[1] AS payer_part
  FROM split_bill_receipts r
  WHERE r.split_bill_id IN (SELECT bill_id FROM my_bills)
  GROUP BY r.split_bill_id
),
bill_payer AS (
  SELECT b.id AS bill_id, b.title, b.created_at, b.category, b.creator_id,
         CASE
           WHEN rp.split_bill_id IS NOT NULL THEN
             CASE WHEN rp.payers = 1 AND rp.unknown_payers = 0
                  THEN (SELECT p.uid FROM parts p WHERE p.id = rp.payer_part) END
           WHEN b.category = 'sport' THEN b.creator_id
         END AS payer_uid
  FROM split_bills b
  LEFT JOIN receipt_payers rp ON rp.split_bill_id = b.id
  WHERE b.id IN (SELECT bill_id FROM my_bills)
),
bill_debts AS (
  SELECT p.uid AS debtor, bp.payer_uid AS creditor, p.amount,
         bp.bill_id, bp.title, bp.created_at,
         CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END AS kind
  FROM bill_payer bp
  JOIN parts p ON p.split_bill_id = bp.bill_id
  WHERE bp.payer_uid IS NOT NULL
    AND p.uid IS NOT NULL
    AND p.uid <> bp.payer_uid
    AND p.paid_at IS NULL
    AND p.amount > 0
),
requests AS (
  SELECT pr.id, pr.requester_id, pr.payer_id, pr.amount, pr.created_at,
         COALESCE(pr.description, 'ขอเงิน') AS title
  FROM payment_requests pr
  WHERE pr.split_bill_id IS NULL
    AND pr.status = 'pending'
    AND pr.currency = 'THB'
    AND pr.payer_id IS NOT NULL
    AND (pr.expires_at IS NULL OR pr.expires_at > now())
    AND ((pr.requester_id = (SELECT uid FROM me)) OR (pr.payer_id = (SELECT uid FROM me)))
)
-- bill / sport: they owe me
SELECT d.debtor, 'they_owe_me'::text, d.amount, d.kind, d.bill_id, d.title, d.created_at, true
FROM bill_debts d
WHERE d.creditor = (SELECT uid FROM me) AND d.debtor IN (SELECT fid FROM friends)
UNION ALL
-- bill / sport: I owe them
SELECT d.creditor, 'i_owe_them', d.amount, d.kind, d.bill_id, d.title, d.created_at, true
FROM bill_debts d
WHERE d.debtor = (SELECT uid FROM me) AND d.creditor IN (SELECT fid FROM friends)
UNION ALL
-- unattributed: I am an unpaid linked participant and the payer is unknown → tie it to the creator when a friend
SELECT bp.creator_id, 'i_owe_them', p.amount,
       CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END,
       bp.bill_id, bp.title, bp.created_at, false
FROM bill_payer bp
JOIN parts p ON p.split_bill_id = bp.bill_id
WHERE bp.payer_uid IS NULL
  AND p.uid = (SELECT uid FROM me)
  AND p.paid_at IS NULL AND p.amount > 0
  AND bp.creator_id <> (SELECT uid FROM me)
  AND bp.creator_id IN (SELECT fid FROM friends)
UNION ALL
-- unattributed: I created the bill, a friend is a linked unpaid participant, payer unknown
SELECT p.uid, 'they_owe_me', p.amount,
       CASE WHEN bp.category = 'sport' THEN 'sport' ELSE 'bill' END,
       bp.bill_id, bp.title, bp.created_at, false
FROM bill_payer bp
JOIN parts p ON p.split_bill_id = bp.bill_id
WHERE bp.payer_uid IS NULL
  AND bp.creator_id = (SELECT uid FROM me)
  AND p.uid IN (SELECT fid FROM friends)
  AND p.paid_at IS NULL AND p.amount > 0
UNION ALL
-- standalone requests: they owe me
SELECT r.payer_id, 'they_owe_me', r.amount, 'request', r.id, r.title, r.created_at, true
FROM requests r
WHERE r.requester_id = (SELECT uid FROM me) AND r.payer_id IN (SELECT fid FROM friends)
UNION ALL
-- standalone requests: I owe them
SELECT r.requester_id, 'i_owe_them', r.amount, 'request', r.id, r.title, r.created_at, true
FROM requests r
WHERE r.payer_id = (SELECT uid FROM me) AND r.requester_id IN (SELECT fid FROM friends);
$$;

-- Same lockdown pattern as accept_friend_invite (070), plus anon: Supabase's
-- default privileges grant EXECUTE on new functions to anon explicitly, which
-- REVOKE ... FROM PUBLIC alone does not remove.
REVOKE ALL ON FUNCTION public.friend_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_balances() TO authenticated;

COMMENT ON FUNCTION public.friend_balances() IS
  'Per-friend balances for auth.uid() across bills, sport sessions and standalone payment requests. attributed=false rows must never be summed.';
```

- [ ] **Step 4: Apply to the local database and run the test**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
supabase db reset 2>&1 | tail -3
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/friend_balances.test.sql 2>&1 | grep -E "PASS|FAIL|ERROR|ALL friend_balances"
```

Expected: every line `PASS: …` and finally `ALL friend_balances CHECKS PASSED`. On any `FAIL`, fix the **migration** (not the expectation) unless the expectation contradicts the spec rules above. Common first-run errors to expect and fix: a column named differently in a table (verify with `\d split_bill_receipts`, `\d payment_requests`), `min`/`array_agg` typing, a `UNION ALL` column type mismatch (cast the first branch's literals).

- [ ] **Step 5: Re-run the existing RLS expectations to prove nothing else moved**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/094_trip_participant_scoped_rls.test.sql 2>&1 | grep -E "FAIL|ERROR" | head -3; echo "rls-check-exit=$?"
```

Expected: no `FAIL`/`ERROR` lines (grep prints nothing).

- [ ] **Step 6: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short supabase/migrations/20261109120000_friend_balances.sql supabase/tests/friend_balances.test.sql
```

Expected: two `??` lines. **Do not apply this migration to any non-local database.**

---

### Task 2: Gate — is the trip settlement function correct? Then `friend_balances_trips()`

**Files:**
- Create: `supabase/tests/trip_settlement_threeway.test.sql`
- Conditionally create (only if the gate passes): `supabase/migrations/20261109120100_friend_balances_trips.sql`, `supabase/tests/friend_balances_trips.test.sql`

**Interfaces:**
- Consumes: `calculate_trip_settlement(p_journey_id uuid)` → `(from_name, to_name, amount, from_id, to_id)` (migration 060), `trip_participants(user_id, left_at)`, `trip_payments(status)`, `life_journeys(base_currency, title, created_at)`.
- Produces: `public.friend_balances_trips()` with the **same row shape** as `friend_balances()` and `source_kind = 'trip'`, `source_id = journey id`. `attributed = (life_journeys.base_currency = 'THB')`.

Background (why this is a gate): the 060 function computes each participant's balance as `SUM(own split on expenses they paid) − SUM(own split on expenses others paid)`. For a payer who paid 300 split three ways that is `+100`, not `+200`, so a 3-person trip loses one debtor's transfer. A pure-script re-implementation of that formula (not the real function) gave `B→A 100` only. This task proves or refutes it on the real function.

- [ ] **Step 1: Write the 3-person settlement test**

Create `supabase/tests/trip_settlement_threeway.test.sql`:

```sql
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
```

- [ ] **Step 2: Run it**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/trip_settlement_threeway.test.sql 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED"
```

- [ ] **Step 3: Decide — this is a hard gate**

- **If it prints `TRIP SETTLEMENT 3-WAY CHECK PASSED`:** the suspicion was wrong; continue with Steps 4–7.
- **If it prints `FAIL: … transfers 100 in 1 transfer(s)`:** the existing trip settlement loses money for 3+ people (it affects the web trip page, the LIFF page and the iOS trip screen, which all call it). **Stop this task.** Do not create `friend_balances_trips()`; ship the rest without trip rows (iOS shows `ยังไม่รวมยอดจากทริป`). Report to the user immediately with the test output, and propose a **separate, separately approved** fix migration that replaces the function with `balance = Σ(amount_base_currency-based splits owed to the payer) − Σ(own splits on others' expenses)` (credit the payer for everyone else's share, not their own). Do not edit `060` or add that fix here: it changes how money is settled, which is out of this plan's scope. Then continue with Task 3.

- [ ] **Step 4: (gate passed only) Write the trips test**

Create `supabase/tests/friend_balances_trips.test.sql` (same guard, `BEGIN … ROLLBACK` shape and `pg_temp.assert_num` helper as `friend_balances.test.sql`) with this fixture and these assertions:

```sql
-- users A, B (friends), E (stranger-participant with no friendship); org; line? not needed
-- j1 (THB): A,B,C(guest, no user_id); A paid 200 split A100/B100  → B→A 100 open
-- j2 (THB): A,B; A paid 200 split 100/100; confirmed trip_payments B→A     → hidden
-- j3 (JPY): A,B; A paid 200 split 100/100                                 → attributed=false
-- j4 (THB): A and E (E not a friend of A); A paid 200 split 100/100       → no row
-- j5 (THB): A left (left_at set); A has an open transfer                   → A sees nothing
```

Assertions (as A): B owes A 100 for `source_kind='trip'` attributed (j1); no row for j2; one row for j3 with `attributed=false`; nothing for E; nothing for j5. As B: mirror (`i_owe_them` A 100 for j1). As E: zero rows (not a friend). Use the existing `trip_participants(id, journey_id, user_id, display_name, left_at)`, `trip_expenses(id, journey_id, paid_by_id, title, amount, amount_base_currency)`, `expense_splits(expense_id, participant_id, amount)`, `trip_payments(journey_id, from_participant, to_participant, amount, status)` and `life_journeys(id, organization_id, user_id, title, journey_type, trip_type, base_currency)` exactly as `trip_settlement_threeway.test.sql` and `094_trip_participant_scoped_rls.test.sql` insert them. Run it before the migration and confirm it fails with `function friend_balances_trips() does not exist`.

- [ ] **Step 5: (gate passed only) Write the trips migration**

Create `supabase/migrations/20261109120100_friend_balances_trips.sql`:

```sql
-- 20261109120100_friend_balances_trips.sql
-- Trip transfers between the caller and accepted friends, from the existing
-- calculate_trip_settlement(). A suggested transfer is hidden when a CONFIRMED
-- trip_payments row exists for the same (from, to) pair — exactly what the web
-- trip page does (trip-detail-client.tsx: alreadyPaid). Trips whose
-- base_currency is not THB are returned with attributed = false (never summed).
-- Guests (participants without a user) have no friend to attach to and are skipped.
CREATE OR REPLACE FUNCTION public.friend_balances_trips()
RETURNS TABLE (
  counterpart_user_id uuid,
  direction           text,
  amount              numeric,
  source_kind         text,
  source_id           uuid,
  title               text,
  occurred_at         timestamptz,
  attributed          boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH me AS (SELECT auth.uid() AS uid),
friends AS (
  SELECT CASE WHEN f.requester_id = (SELECT uid FROM me) THEN f.addressee_id ELSE f.requester_id END AS fid
  FROM friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = (SELECT uid FROM me) OR f.addressee_id = (SELECT uid FROM me))
),
my_trips AS (
  SELECT DISTINCT tp.journey_id
  FROM trip_participants tp
  WHERE tp.user_id = (SELECT uid FROM me) AND tp.left_at IS NULL
),
transfers AS (
  SELECT t.journey_id, s.from_id, s.to_id, s.amount
  FROM my_trips t
  CROSS JOIN LATERAL calculate_trip_settlement(t.journey_id) s
),
open_transfers AS (
  SELECT tr.journey_id, tr.amount, fp.user_id AS from_uid, tpp.user_id AS to_uid
  FROM transfers tr
  JOIN trip_participants fp  ON fp.id  = tr.from_id
  JOIN trip_participants tpp ON tpp.id = tr.to_id
  WHERE NOT EXISTS (
    SELECT 1 FROM trip_payments pay
    WHERE pay.journey_id = tr.journey_id
      AND pay.from_participant = tr.from_id
      AND pay.to_participant   = tr.to_id
      AND pay.status = 'confirmed'
  )
)
SELECT CASE WHEN o.to_uid = (SELECT uid FROM me) THEN o.from_uid ELSE o.to_uid END,
       CASE WHEN o.to_uid = (SELECT uid FROM me) THEN 'they_owe_me' ELSE 'i_owe_them' END,
       o.amount, 'trip'::text, o.journey_id, lj.title, lj.created_at,
       (lj.base_currency = 'THB')
FROM open_transfers o
JOIN life_journeys lj ON lj.id = o.journey_id
WHERE (o.to_uid = (SELECT uid FROM me) OR o.from_uid = (SELECT uid FROM me))
  AND (CASE WHEN o.to_uid = (SELECT uid FROM me) THEN o.from_uid ELSE o.to_uid END) IN (SELECT fid FROM friends);
$$;

REVOKE ALL ON FUNCTION public.friend_balances_trips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_balances_trips() TO authenticated;
COMMENT ON FUNCTION public.friend_balances_trips() IS
  'Open trip transfers between auth.uid() and accepted friends (existing settlement, confirmed-payment pairs hidden). attributed=false for non-THB trips.';
```

- [ ] **Step 6: (gate passed only) Apply locally and run the trips test**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
supabase db reset 2>&1 | tail -2
for f in friend_balances friend_balances_trips trip_settlement_threeway; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/$f.test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED"; done
```

Expected: three `… PASSED` lines and no `FAIL`/`ERROR`.

- [ ] **Step 7: Checkpoint (no commit)**

```bash
git status --short supabase/ | grep -E "friend_balances|trip_settlement"
```

Record in your notes whether the gate passed. Everything after this task is written to work with or without trip rows.

---

### Task 3: `BalancePresentation` (pure logic) + host verification

**Files:**
- Create: `ios/Slippy/Utils/BalancePresentation.swift`
- Create: `ios/scripts/verify-balance-presentation.mjs`

**Interfaces:**
- Produces (all in `enum BalancePresentation`, Foundation only):
  - `enum Direction: String, Codable { theyOweMe = "they_owe_me", iOweThem = "i_owe_them" }`
  - `enum SourceKind: String, Codable { bill, sport, trip, request }`
  - `struct Entry: Codable, Equatable, Identifiable` — fields `counterpartUserId: String?, direction, amount: Double, sourceKind, sourceId: String, title: String?, occurredAt: String?, attributed: Bool` with snake_case `CodingKeys`
  - `struct Summary: Equatable` — `friendId: String, theyOweMe: Double, iOweThem: Double, entries: [Entry]` (attributed only, newest first), `unattributedCount: Int`, computed `net: Double` (`> 0` = they owe me)
  - `static func summaries(_ entries: [Entry]) -> [String: Summary]` (keyed by friend user id; entries without a counterpart are ignored)
  - `static func money(_ value: Double) -> String` — `฿1,234.50`, whole numbers without decimals, absolute value
  - `static func chipText(net: Double) -> String?` — `nil` when the net rounds to 0.00
  - `static func chatLine(net: Double) -> String?`
  - `static func sentence(name: String, net: Double) -> String`
  - `static func kindTitle(_ kind: SourceKind) -> String`

- [ ] **Step 1: Write the failing host script**

Create `ios/scripts/verify-balance-presentation.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/BalancePresentation.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('enum BalancePresentation'), 'BalancePresentation.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-balance-presentation-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
func eq(_ actual: String?, _ expected: String?, _ message: String) {
    check(actual == expected, "\\(message): expected [\\(expected ?? "nil")] got [\\(actual ?? "nil")]")
}
typealias B = BalancePresentation

// --- money formatting ---
eq(B.money(450), "฿450", "whole")
eq(B.money(450.5), "฿450.50", "one decimal pads")
eq(B.money(1234.5), "฿1,234.50", "thousands")
eq(B.money(1234567), "฿1,234,567", "millions")
eq(B.money(-450), "฿450", "absolute value")
eq(B.money(0.1 + 0.2), "฿0.30", "floating point drift")
eq(B.money(0.005), "฿0.01", "half satang rounds up")

// --- chip / chat line / sentence ---
eq(B.chipText(net: 450), "ค้างคุณ ฿450", "they owe me")
eq(B.chipText(net: -450), "คุณค้าง ฿450", "I owe them")
eq(B.chipText(net: 0), nil, "zero hides")
eq(B.chipText(net: 0.004), nil, "sub-satang hides")
eq(B.chipText(net: -0.004), nil, "negative sub-satang hides")
eq(B.chatLine(net: 450), "ค้างกัน ฿450 · ดูรายละเอียด", "chat line")
eq(B.chatLine(net: 0), nil, "chat line hides at zero")
eq(B.sentence(name: "พลอย", net: 450), "พลอย ค้างคุณ ฿450", "sentence they owe")
eq(B.sentence(name: "พลอย", net: -450), "คุณค้าง พลอย ฿450", "sentence I owe")
eq(B.sentence(name: "พลอย", net: 0), "ยังไม่มียอดค้างกับ พลอย", "sentence empty")
eq(B.kindTitle(.bill), "บิล", "kind bill")
eq(B.kindTitle(.sport), "นัดกีฬา", "kind sport")
eq(B.kindTitle(.trip), "ทริป", "kind trip")
eq(B.kindTitle(.request), "ขอเงิน", "kind request")

// --- decoding the RPC rows (snake_case, nulls) ---
let json = """
[
 {"counterpart_user_id":"b1","direction":"they_owe_me","amount":100,"source_kind":"bill","source_id":"s1","title":"ข้าวเย็น","occurred_at":"2026-11-09T05:30:00.123456+00:00","attributed":true},
 {"counterpart_user_id":"b1","direction":"they_owe_me","amount":0.1,"source_kind":"request","source_id":"s2","title":null,"occurred_at":null,"attributed":true},
 {"counterpart_user_id":"b1","direction":"they_owe_me","amount":0.2,"source_kind":"request","source_id":"s3","title":"x","occurred_at":"2026-11-08T05:30:00+00:00","attributed":true},
 {"counterpart_user_id":"b1","direction":"i_owe_them","amount":60,"source_kind":"sport","source_id":"s4","title":"แบด","occurred_at":"2026-11-07T05:30:00+00:00","attributed":true},
 {"counterpart_user_id":"b1","direction":"i_owe_them","amount":999,"source_kind":"bill","source_id":"s5","title":"unknown payer","occurred_at":null,"attributed":false},
 {"counterpart_user_id":"c1","direction":"i_owe_them","amount":40,"source_kind":"bill","source_id":"s6","title":"y","occurred_at":null,"attributed":true},
 {"counterpart_user_id":null,"direction":"they_owe_me","amount":5,"source_kind":"bill","source_id":"s7","title":"z","occurred_at":null,"attributed":false}
]
""".data(using: .utf8)!
let entries: [B.Entry]
do { entries = try JSONDecoder().decode([B.Entry].self, from: json) } catch { print("FAIL: decode \\(error)"); exit(1) }
check(entries.count == 7, "decoded 7 rows")
check(entries[1].title == nil && entries[1].occurredAt == nil, "nulls decode")
check(entries[6].counterpartUserId == nil, "null counterpart decodes")

// --- summaries ---
let sums = B.summaries(entries)
check(sums.keys.sorted() == ["b1", "c1"], "one summary per friend, null counterpart ignored")
let b = sums["b1"]!
check(abs(b.theyOweMe - 100.30) < 0.0001, "b they owe me = 100 + 0.1 + 0.2 exactly 100.30, got \\(b.theyOweMe)")
check(b.iOweThem == 60, "b I owe = 60 (unattributed 999 excluded), got \\(b.iOweThem)")
check(abs(b.net - 40.30) < 0.0001, "b net = 40.30, got \\(b.net)")
check(b.unattributedCount == 1, "b has 1 unattributed row")
check(b.entries.count == 4, "b breakdown lists attributed rows only (4)")
check(b.entries.first?.sourceId == "s1", "newest first: s1 (Nov 9) leads, got \\(b.entries.first?.sourceId ?? "nil")")
check(b.entries.last?.occurredAt == nil, "rows without a date sort last")
let c = sums["c1"]!
check(c.net == -40 && c.unattributedCount == 0, "c: I owe 40")
eq(B.chipText(net: b.net), "ค้างคุณ ฿40.30", "chip from summary")

// --- mirror: the other side's rows give the negated net ---
let mirror = entries.filter { $0.counterpartUserId == "b1" && $0.attributed }.map { e in
    B.Entry(counterpartUserId: "a1", direction: e.direction == .theyOweMe ? .iOweThem : .theyOweMe, amount: e.amount, sourceKind: e.sourceKind, sourceId: e.sourceId, title: e.title, occurredAt: e.occurredAt, attributed: true)
}
let m = B.summaries(mirror)["a1"]!
check(abs(m.net + b.net) < 0.0001, "mirror net is negated, got \\(m.net) vs \\(b.net)")

// --- empty ---
check(B.summaries([]).isEmpty, "no entries -> no summaries")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: balance presentation (money, wording, decoding, summaries, mirror)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-balance-presentation.mjs 2>&1 | tail -3
```

Expected: FAIL (`BalancePresentation.swift is missing` or a missing-file error).

- [ ] **Step 3: Implement**

Create `ios/Slippy/Utils/BalancePresentation.swift`:

```swift
import Foundation

/// Pure logic for the "ยอดค้าง" (friend balance) UI: decoding the RPC rows,
/// per-friend sums, and the Thai wording. Foundation only, so
/// `ios/scripts/verify-balance-presentation.mjs` can compile this file alone.
///
/// Rules that matter (see the spec): rows with `attributed == false` are
/// counted but NEVER added to an amount; sums are done in whole satang to avoid
/// floating-point drift; a net that rounds to 0.00 shows nothing.
enum BalancePresentation {

    enum Direction: String, Codable {
        case theyOweMe = "they_owe_me"
        case iOweThem  = "i_owe_them"
    }

    enum SourceKind: String, Codable { case bill, sport, trip, request }

    struct Entry: Codable, Equatable, Identifiable {
        let counterpartUserId: String?
        let direction: Direction
        let amount: Double
        let sourceKind: SourceKind
        let sourceId: String
        let title: String?
        let occurredAt: String?
        let attributed: Bool

        var id: String {
            "\(sourceKind.rawValue)|\(sourceId)|\(direction.rawValue)|\(counterpartUserId ?? "-")"
        }

        enum CodingKeys: String, CodingKey {
            case counterpartUserId = "counterpart_user_id"
            case direction, amount
            case sourceKind = "source_kind"
            case sourceId = "source_id"
            case title
            case occurredAt = "occurred_at"
            case attributed
        }
    }

    struct Summary: Equatable {
        let friendId: String
        let theyOweMe: Double
        let iOweThem: Double
        /// Attributed rows only, newest first; rows without a date last.
        let entries: [Entry]
        let unattributedCount: Int

        /// > 0: they owe me. < 0: I owe them. Computed in whole satang.
        var net: Double { Double(BalancePresentation.satang(theyOweMe) - BalancePresentation.satang(iOweThem)) / 100 }
    }

    // MARK: – Sums

    fileprivate static func satang(_ value: Double) -> Int { Int((value * 100).rounded()) }

    static func summaries(_ entries: [Entry]) -> [String: Summary] {
        var grouped: [String: [Entry]] = [:]
        for entry in entries {
            guard let friend = entry.counterpartUserId else { continue }
            grouped[friend, default: []].append(entry)
        }
        var result: [String: Summary] = [:]
        for (friend, list) in grouped {
            let attributed = list.filter(\.attributed)
            let theyOweMe = attributed.filter { $0.direction == .theyOweMe }.reduce(0) { $0 + satang($1.amount) }
            let iOweThem  = attributed.filter { $0.direction == .iOweThem }.reduce(0) { $0 + satang($1.amount) }
            let sorted = attributed.sorted { lhs, rhs in
                switch (lhs.occurredAt, rhs.occurredAt) {
                case let (l?, r?): return l > r
                case (_?, nil):    return true
                default:           return false
                }
            }
            result[friend] = Summary(
                friendId: friend,
                theyOweMe: Double(theyOweMe) / 100,
                iOweThem: Double(iOweThem) / 100,
                entries: sorted,
                unattributedCount: list.count - attributed.count)
        }
        return result
    }

    // MARK: – Wording

    /// `฿1,234.50`; whole amounts without decimals; always the absolute value.
    static func money(_ value: Double) -> String {
        let total = abs(satang(value))
        let baht = total / 100, cents = total % 100
        var grouped = ""
        for (index, character) in String(baht).reversed().enumerated() {
            if index > 0 && index % 3 == 0 { grouped.append(",") }
            grouped.append(character)
        }
        let whole = String(grouped.reversed())
        return cents == 0 ? "฿\(whole)" : "฿\(whole).\(String(format: "%02d", cents))"
    }

    /// Friends-list chip. `nil` when there is nothing to say.
    static func chipText(net: Double) -> String? {
        switch satang(net) {
        case 1...:  return "ค้างคุณ \(money(net))"
        case ...(-1): return "คุณค้าง \(money(net))"
        default:    return nil
        }
    }

    /// Slim line under the chat title.
    static func chatLine(net: Double) -> String? {
        satang(net) == 0 ? nil : "ค้างกัน \(money(net)) · ดูรายละเอียด"
    }

    /// Headline of the detail screen.
    static func sentence(name: String, net: Double) -> String {
        switch satang(net) {
        case 1...:  return "\(name) ค้างคุณ \(money(net))"
        case ...(-1): return "คุณค้าง \(name) \(money(net))"
        default:    return "ยังไม่มียอดค้างกับ \(name)"
        }
    }

    static func kindTitle(_ kind: SourceKind) -> String {
        switch kind {
        case .bill:    return "บิล"
        case .sport:   return "นัดกีฬา"
        case .trip:    return "ทริป"
        case .request: return "ขอเงิน"
        }
    }
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-balance-presentation.mjs 2>&1 | grep -E "FAIL|PASS|failed"
```

Expected: `PASS: balance presentation (money, wording, decoding, summaries, mirror)`. On a `FAIL:` fix the Swift, not the expectation (unless it contradicts the Global Constraints).

- [ ] **Step 5: Checkpoint (no commit)** — `git status --short ios/Slippy/Utils/BalancePresentation.swift ios/scripts/verify-balance-presentation.mjs` → two `??` lines.

---

### Task 4: `BalanceViewModel` (RPC, failure handling, DEBUG fixture flag)

**Files:**
- Create: `ios/Slippy/ViewModels/BalanceViewModel.swift`

**Interfaces:**
- Consumes: `BalancePresentation.{Entry, Summary, summaries}`; RPCs `friend_balances`, `friend_balances_trips` (the latter may not exist — see Task 2 gate).
- Produces: `@MainActor final class BalanceViewModel: ObservableObject` with `@Published private(set) var summaries: [String: BalancePresentation.Summary]`, `@Published private(set) var loadFailed: Bool`, `@Published private(set) var tripsIncluded: Bool`, `func load() async`, `func summary(for friendId: String) -> BalancePresentation.Summary?`, DEBUG-only `var isFixture = false` and `static func fixture() -> BalanceViewModel`.

- [ ] **Step 1: Create the file**

```swift
import SwiftUI
import Supabase

/// Per-friend balances for the signed-in user. Reads two read-only RPCs
/// (`friend_balances`, `friend_balances_trips`). If the main call fails the
/// screens hide the balance UI (`loadFailed`) rather than show a misleading
/// zero. If only the trips call fails (for example the trips function is not
/// deployed) the rest still shows, flagged by `tripsIncluded == false`.
@MainActor
final class BalanceViewModel: ObservableObject {
    @Published private(set) var summaries: [String: BalancePresentation.Summary] = [:]
    @Published private(set) var loadFailed = false
    @Published private(set) var tripsIncluded = true

    #if DEBUG
    /// Synthetic-data mode for simulator screenshots: no network.
    var isFixture = false
    #endif

    private let db = SupabaseManager.shared.client

    func summary(for friendId: String) -> BalancePresentation.Summary? { summaries[friendId] }

    func load() async {
        #if DEBUG
        if isFixture { return }
        #endif
        let main: [BalancePresentation.Entry]
        do {
            main = try await db.rpc("friend_balances").execute().value
        } catch {
            loadFailed = true
            return
        }
        var trips: [BalancePresentation.Entry] = []
        do {
            trips = try await db.rpc("friend_balances_trips").execute().value
            tripsIncluded = true
        } catch {
            tripsIncluded = false
        }
        summaries = BalancePresentation.summaries(main + trips)
        loadFailed = false
    }

    #if DEBUG
    static func fixture(failed: Bool = false, tripsIncluded: Bool = true) -> BalanceViewModel {
        let vm = BalanceViewModel()
        vm.isFixture = true
        vm.loadFailed = failed
        vm.tripsIncluded = tripsIncluded
        func entry(_ friend: String, _ direction: BalancePresentation.Direction, _ amount: Double,
                   _ kind: BalancePresentation.SourceKind, _ id: String, _ title: String,
                   _ date: String?, attributed: Bool = true) -> BalancePresentation.Entry {
            .init(counterpartUserId: friend, direction: direction, amount: amount, sourceKind: kind,
                  sourceId: id, title: title, occurredAt: date, attributed: attributed)
        }
        vm.summaries = BalancePresentation.summaries([
            entry(MessagesViewModel.fixtureFriendId, .theyOweMe, 300, .bill, "fx-b1", "ข้าวเย็นร้านชาบู", "2026-11-08T12:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .theyOweMe, 150.5, .request, "fx-r1", "ค่าแท็กซี่", "2026-11-05T09:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .iOweThem, 60, .sport, "fx-s1", "แบดมินตันวันศุกร์", "2026-11-03T11:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .iOweThem, 500, .bill, "fx-b2", "ค่าเช่าบ้านพัก (ยังไม่ระบุผู้จ่าย)", nil, attributed: false),
            entry("fx-golf", .iOweThem, 1234.5, .trip, "fx-t1", "ทริปเชียงใหม่", "2026-10-20T08:00:00+00:00"),
        ])
        return vm
    }
    #endif
}
```

- [ ] **Step 2: Register and build** (the file compiles together with Task 5/6/7 in the combined build; compile it now to catch errors early)

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
ruby "$SCRATCH/add_files.rb" Slippy/Utils/BalancePresentation.swift Slippy/ViewModels/BalanceViewModel.swift
./scripts/build-simulator.sh > /private/tmp/slippy-bal-task4-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-bal-task4-build.log | sort -u | head; grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-bal-task4-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. If `db.rpc("friend_balances")` without parameters does not compile in supabase-swift 2.48.0, use the overload with an explicit empty encodable: `struct NoArgs: Encodable {}` and `db.rpc("friend_balances", params: NoArgs())`; keep the rest unchanged.

- [ ] **Step 3: Checkpoint (no commit)** — `git status --short ios/Slippy/ViewModels/BalanceViewModel.swift` → `??`.

---

### Task 5: Chat plumbing, balance views, friends chip, chat line

**Files:**
- Modify: `ios/Slippy/Models/MessageModels.swift` (add `otherUserId` to `ChatConversation`)
- Modify: `ios/Slippy/ViewModels/MessagesViewModel.swift` (set it in `loadConversations`)
- Create: `ios/Slippy/Views/Social/FriendBalanceViews.swift` (`FriendBalanceChip`, `FriendRow`, `BalanceDetailView`, `BalanceChatLine`)
- Modify: `ios/Slippy/Views/Social/SocialView.swift` (friends rows + sheet + load)
- Modify: `ios/Slippy/Views/Chat/FriendChatRoomView.swift` (optional balance line)
- Modify: `ios/Slippy/Views/Chat/FriendChatListView.swift` (create/inject `BalanceViewModel`, pass to the room)

**Interfaces:**
- Consumes: `BalanceViewModel`, `BalancePresentation`, `UserProfile` (`id`, `displayName`, `email`), `InitialsCircle`, `ChatPresentation.{parseISO, dateLabel}`, `MessagesViewModel.fixtureFriendId`.
- Produces: `ChatConversation.otherUserId: String?` (default `nil`); `FriendChatRoomView(vm:conversationId:currentUserId:friendName:friendAvatarUrl:showsAvatars:friendUserId:balanceViewModel:)` (last two default `nil`); `FriendRow(friend: UserProfile, net: Double?)`; `BalanceDetailView(friendId:friendName:vm:)`.

- [ ] **Step 1: `ChatConversation.otherUserId`**

In `ios/Slippy/Models/MessageModels.swift`, replace

```swift
    var lastMessageBody: String?
    var lastMessageType: String?
}
```

(the end of `struct ChatConversation`) with

```swift
    var lastMessageBody: String?
    var lastMessageType: String?
    /// The other person's user id in a direct chat; `nil` for groups.
    var otherUserId: String? = nil
}
```

In `ios/Slippy/ViewModels/MessagesViewModel.swift`, in `loadConversations`, change the `ChatConversation(` construction (the call ending `lastMessageBody: last?.body, lastMessageType: last?.msgType`) to

```swift
                    lastMessageBody: last?.body, lastMessageType: last?.msgType,
                    otherUserId: conv.type == "direct" ? other?.id : nil
```

- [ ] **Step 2: Create the shared views**

Create `ios/Slippy/Views/Social/FriendBalanceViews.swift`:

```swift
import SwiftUI

// "ยอดค้าง" UI: the friends-list row with its chip, the slim chat line, and
// the detail screen. All of it hides when the balance cannot be loaded.

struct FriendBalanceChip: View {
    let text: String
    let theyOweMe: Bool

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(theyOweMe ? Color.brand500 : Color.textSecondary)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(theyOweMe ? Color.brand50 : Color.surfaceMuted)
            .clipShape(Capsule())
    }
}

/// A friend in the friends list. `net` is `nil` when unknown or not loaded.
struct FriendRow: View {
    let friend: UserProfile
    let net: Double?

    var body: some View {
        HStack(spacing: 12) {
            InitialsCircle(name: friend.displayName)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Text(friend.email)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
            }
            Spacer()
            if let net, let text = BalancePresentation.chipText(net: net) {
                FriendBalanceChip(text: text, theyOweMe: net > 0)
            } else {
                Image(systemName: "person.fill.checkmark")
                    .foregroundColor(Color.brand500.opacity(0.7))
                    .font(.system(size: 16))
            }
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Slim tappable line under a 1:1 chat's title. Hidden when the net is zero,
/// unknown, or the load failed.
struct BalanceChatLine: View {
    @ObservedObject var vm: BalanceViewModel
    let friendId: String
    let friendName: String
    @State private var showDetail = false

    var body: some View {
        if !vm.loadFailed,
           let summary = vm.summary(for: friendId),
           let text = BalancePresentation.chatLine(net: summary.net) {
            Button { hapticLight(); showDetail = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bahtsign.circle")
                    Text(text)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color.brand500)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(Color.brand50)
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showDetail) {
                BalanceDetailView(friendId: friendId, friendName: friendName, vm: vm)
            }
        }
    }
}

struct BalanceDetailView: View {
    let friendId: String
    let friendName: String
    @ObservedObject var vm: BalanceViewModel
    @Environment(\.dismiss) private var dismiss

    private let order: [BalancePresentation.SourceKind] = [.bill, .sport, .trip, .request]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if vm.loadFailed {
                        Text("โหลดยอดค้างไม่สำเร็จ ลองใหม่อีกครั้ง")
                            .font(.system(size: 14)).foregroundColor(Color.textSecondary)
                    } else if let summary = vm.summary(for: friendId),
                              !summary.entries.isEmpty || summary.unattributedCount > 0 {
                        content(summary)
                    } else {
                        Text(BalancePresentation.sentence(name: friendName, net: 0))
                            .font(.system(size: 16, weight: .medium)).foregroundColor(Color.textSecondary)
                    }
                    if !vm.tripsIncluded {
                        Text("ยังไม่รวมยอดจากทริป")
                            .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle("ยอดค้างกับ \(friendName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } } }
            .task { await vm.load() }
        }
    }

    @ViewBuilder private func content(_ summary: BalancePresentation.Summary) -> some View {
        Text(BalancePresentation.sentence(name: friendName, net: summary.net))
            .font(.system(size: 22, weight: .bold)).foregroundColor(Color.textPrimary)

        ForEach(order, id: \.self) { kind in
            let rows = summary.entries.filter { $0.sourceKind == kind }
            if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(BalancePresentation.kindTitle(kind))
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                    ForEach(rows) { row in entryRow(row) }
                }
            }
        }

        if summary.unattributedCount > 0 {
            Text("มี \(summary.unattributedCount) รายการที่คำนวณยอดให้ไม่ได้")
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
        }
    }

    private func entryRow(_ row: BalancePresentation.Entry) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title ?? BalancePresentation.kindTitle(row.sourceKind))
                    .font(.system(size: 15, weight: .medium)).foregroundColor(Color.textPrimary).lineLimit(2)
                Text(subtitle(row))
                    .font(.system(size: 12)).foregroundColor(Color.textSecondary)
            }
            Spacer()
            Text(BalancePresentation.money(row.amount))
                .font(.system(size: 15, weight: .semibold)).foregroundColor(Color.textPrimary)
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func subtitle(_ row: BalancePresentation.Entry) -> String {
        let who = row.direction == .theyOweMe ? "ค้างคุณ" : "คุณค้าง"
        guard let raw = row.occurredAt, let date = ChatPresentation.parseISO(raw) else { return who }
        return "\(who) · \(ChatPresentation.dateLabel(date, now: Date()))"
    }
}
```

- [ ] **Step 3: Friends list (`SocialView`)**

In `ios/Slippy/Views/Social/SocialView.swift`:

1. Add two properties next to the existing `@State private var showAddFriend = false` (line 9):

```swift
    @StateObject private var balanceVM = BalanceViewModel()
    @State private var balanceFriend: UserProfile?
```

2. Replace the friend row loop body. Replace this block exactly:

```swift
                ForEach(vm.friends) { friend in
                    HStack(spacing: 12) {
                        initialsView(name: friend.displayName)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(friend.displayName)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(Color.textPrimary)
                            Text(friend.email)
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "person.fill.checkmark")
                            .foregroundColor(Color.brand500.opacity(0.7))
                            .font(.system(size: 16))
                    }
                    .padding(12)
                    .background(Color.surface)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
                }
```

with

```swift
                ForEach(vm.friends) { friend in
                    Button {
                        hapticLight()
                        balanceFriend = friend
                    } label: {
                        FriendRow(friend: friend,
                                  net: balanceVM.loadFailed ? nil : balanceVM.summary(for: friend.id)?.net)
                    }
                    .buttonStyle(.plain)
                }
```

3. Replace

```swift
        .task {
            guard !userId.isEmpty else { return }
            await vm.load(userId: userId)
        }
```

with

```swift
        .task {
            guard !userId.isEmpty else { return }
            await vm.load(userId: userId)
            await balanceVM.load()
        }
        .sheet(item: $balanceFriend) { friend in
            BalanceDetailView(friendId: friend.id, friendName: friend.displayName, vm: balanceVM)
        }
```

4. In `friendsTab`, replace `.refreshable {\n            await vm.load(userId: userId)\n        }` with

```swift
        .refreshable {
            await vm.load(userId: userId)
            await balanceVM.load()
        }
```

`initialsView` stays (still used elsewhere in the file; if the compiler reports it unused, leave it — it is only a warning-free private helper).

- [ ] **Step 4: Chat room line** (`FriendChatRoomView.swift`)

Add two defaulted properties after `var showsAvatars = false`:

```swift
    /// Set only for 1:1 chats so the trip chat is unchanged.
    var friendUserId: String? = nil
    var balanceViewModel: BalanceViewModel? = nil
```

In `body`, insert at the top of the outer `VStack(spacing: 0) {` (before `ScrollViewReader`):

```swift
            if let balanceViewModel, let friendUserId {
                BalanceChatLine(vm: balanceViewModel, friendId: friendUserId, friendName: friendName ?? "")
            }
```

In the existing `.task { … }` add as its last line `await balanceViewModel?.load()`.

- [ ] **Step 5: Chat list** (`FriendChatListView.swift`)

Add `@StateObject private var balanceVM: BalanceViewModel` after `socialVM`, extend the initializer and pass the values:

```swift
    init(viewModel: MessagesViewModel? = nil, socialViewModel: SocialViewModel? = nil, balanceViewModel: BalanceViewModel? = nil) {
        _vm = StateObject(wrappedValue: viewModel ?? MessagesViewModel())
        _socialVM = StateObject(wrappedValue: socialViewModel ?? SocialViewModel())
        _balanceVM = StateObject(wrappedValue: balanceViewModel ?? BalanceViewModel())
    }
```

and in the `navigationDestination` closure add the two arguments to `FriendChatRoomView(...)`:

```swift
                    showsAvatars: info?.type == "direct",
                    friendUserId: info?.otherUserId,
                    balanceViewModel: info?.otherUserId == nil ? nil : balanceVM)
```

- [ ] **Step 6: Register, build, review**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
ruby "$SCRATCH/add_files.rb" Slippy/Views/Social/FriendBalanceViews.swift
./scripts/build-simulator.sh > /private/tmp/slippy-bal-task5-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-bal-task5-build.log | sort -u | head -20; grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-bal-task5-build.log
grep -E "warning:.*(FriendBalanceViews|BalanceViewModel|BalancePresentation|SocialView|FriendChatRoomView|FriendChatListView)" /private/tmp/slippy-bal-task5-build.log | sort -u | cut -c1-200
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`, no new warnings in the touched files. This build also compiles `JourneyPrototypeView`'s unchanged call to `FriendChatRoomView(vm:conversationId:currentUserId:)` (Review Focus 5). Read-check: `FriendChatRoomView` shows the line only when **both** `friendUserId` and `balanceViewModel` are non-nil; the trip chat passes neither.

- [ ] **Step 7: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Social/SocialView.swift ios/Slippy/Views/Chat ios/Slippy/Models/MessageModels.swift ios/Slippy/ViewModels/MessagesViewModel.swift
git status --short ios/Slippy/ViewModels/TripsViewModel.swift ios/Slippy/Models/TripModels.swift
```

Expected: only the six files above changed; the two Trip files keep their pre-plan ` M` state (not edited here).

---

### Task 6: Link friends when creating a bill (iOS)

**Files:**
- Modify: `ios/Slippy/Views/Split/SplitFriendPickerSheet.swift` (optional Slippy-friends section)
- Modify: `ios/Slippy/Views/Split/CreateSplitView.swift` (`DraftParticipant.userId`, load friends, pass them, send `userId`)
- Modify: `ios/Slippy/ViewModels/SplitViewModel.swift` (`createBill` accepts and inserts `user_id`)

**Interfaces:**
- Consumes: `SocialViewModel.friends: [UserProfile]`, `SocialViewModel.load(userId:)`.
- Produces: `SplitFriendPickerSheet(accountID:slippyFriends:onAddSlippyFriend:onAdd:)` (new params default to `[]` / `nil`, so the two `SlippyApp.swift` preview calls and any other caller compile unchanged); `DraftParticipant.userId: String?` (default `nil`); `SplitViewModel.createBill(…, participants: [(name: String, amount: Double, userId: String?)])`.

Participant `user_id` is only set by choosing a Slippy friend here — never by name matching. Sport-roster linking (`SportGroupsViewModel`) is **not** in this plan.

- [ ] **Step 1: Picker sheet**

In `SplitFriendPickerSheet.swift`, after `let onAdd: (String, Double) -> Void` add:

```swift
    /// Accepted Slippy friends. Choosing one links the participant to their account.
    var slippyFriends: [UserProfile] = []
    var onAddSlippyFriend: ((UserProfile, Double) -> Void)? = nil
```

Inside the `Form`, directly after the `if let error { … }` line and before `Section("เพิ่มเพื่อน")`, add:

```swift
                if !slippyFriends.isEmpty {
                    Section("เพื่อนใน Slippy") {
                        ForEach(slippyFriends) { friend in
                            Button {
                                do {
                                    let value = try parsedAmount()
                                    if let onAddSlippyFriend { onAddSlippyFriend(friend, value) }
                                    else { onAdd(friend.displayName, value) }
                                    dismiss()
                                } catch { self.error = error.localizedDescription }
                            } label: {
                                Text(friend.displayName).foregroundStyle(Color.textPrimary)
                            }
                        }
                    }
                }
```

(The amount field below stays the single amount input; leaving it empty splits equally, as today.)

- [ ] **Step 2: `SplitViewModel.createBill`**

Change the parameter type and the insert:

```swift
        participants: [(name: String, amount: Double, userId: String?)]
```

```swift
        struct ParticipantInsert: Encodable {
            let split_bill_id: String
            let name: String
            let amount: Double
            let user_id: String?   // nil is omitted from the JSON, so an unlinked person inserts exactly as before
        }

        let participantRows = participants.map {
            ParticipantInsert(split_bill_id: row.id, name: $0.name, amount: $0.amount, user_id: $0.userId)
        }
```

- [ ] **Step 3: `CreateSplitView`**

1. `DraftParticipant`: add `var userId: String? = nil` as the last stored property (its existing memberwise call sites keep compiling).

2. Add near the other `@State`/`@StateObject` declarations:

```swift
    @StateObject private var socialVM = SocialViewModel()
```

and load the friends on appear. Find the view's existing `.task`/`.onAppear` chain on the root view and add (if none exists, add `.task` to the outermost view):

```swift
            .task {
                if let id = authVM.session?.user.id.uuidString { await socialVM.load(userId: id) }
            }
```

3. Extract the existing picker closure body into a method so both callbacks share it. Replace the picker sheet

```swift
                SplitFriendPickerSheet(accountID: authVM.session?.user.id.uuidString ?? "") { name, amount in
                    let pct = participants.isEmpty ? 100.0 : 0.0
                    participants.append(DraftParticipant(name: name, amount: amount, percentage: pct, items: []))
                    for index in receipts.indices where receipts[index].splitMode == .percentage {
                        normalizeReceiptPercentages($receipts[index])
                    }
                    if splitMode == .equal { recalcEqual() }
                    if splitMode == .percentage { normalizePercentages() }
                }
```

with

```swift
                SplitFriendPickerSheet(
                    accountID: authVM.session?.user.id.uuidString ?? "",
                    onAdd: { name, amount in appendParticipant(name: name, amount: amount, userId: nil) },
                    slippyFriends: socialVM.friends,
                    onAddSlippyFriend: { friend, amount in
                        appendParticipant(name: friend.displayName, amount: amount, userId: friend.id)
                    })
```

and add this method next to `effectiveAmounts()`:

```swift
    private func appendParticipant(name: String, amount: Double, userId: String?) {
        let pct = participants.isEmpty ? 100.0 : 0.0
        participants.append(DraftParticipant(name: name, amount: amount, percentage: pct, items: [], userId: userId))
        for index in receipts.indices where receipts[index].splitMode == .percentage {
            normalizeReceiptPercentages($receipts[index])
        }
        if splitMode == .equal { recalcEqual() }
        if splitMode == .percentage { normalizePercentages() }
    }
```

4. In `save()`, change the `createBill` argument (the amounts array is index-aligned with `participants`):

```swift
                    participants: amounts.indices.map { (amounts[$0].name, amounts[$0].amount, participants[$0].userId) }
```

- [ ] **Step 4: Build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
./scripts/build-simulator.sh > /private/tmp/slippy-bal-task6-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-bal-task6-build.log | sort -u | head -20; grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-bal-task6-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. If `CreateSplitView` has no single root view for the `.task`, attach it to the `NavigationStack`/`ZStack` that already carries `.sheet(isPresented: $showAddParticipant)`.

- [ ] **Step 5: Review by reading**

Confirm: (a) `user_id` is non-nil **only** when `onAddSlippyFriend` ran; (b) typing a name by hand or choosing from the device address book still passes `nil`; (c) `git diff ios/Slippy/Views/Split/CreateSplitView.swift` shows only the hunks above (the file is large: a bigger diff means something was pasted wrongly).

- [ ] **Step 6: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Split ios/Slippy/ViewModels/SplitViewModel.swift
```

---

### Task 7: Fixtures, screenshots, final verification

**Files:**
- Create: `ios/Slippy/Views/Social/BalanceFixtures.swift` (entire file `#if DEBUG`)
- Modify: `ios/Slippy/Views/Chat/ChatFixtures.swift` (room fixture shows the balance line)
- Modify: `ios/Slippy/App/SlippyApp.swift` — **additive**: two `case` lines after the existing `case "add-friend-test": …` line. The file already carries other uncommitted work; do not touch any other line.

**Interfaces:**
- Consumes: `BalanceViewModel.fixture()`, `FriendRow`, `BalanceDetailView`, `FriendChatRoomView(…friendUserId:balanceViewModel:)`, `MessagesViewModel.{fixtureFriendId, fixtureMyId}`, `UserProfile(id:email:fullName:avatarUrl:)`.
- Produces: preview screens `friend-balance-test`, `balance-detail-test` (and the existing `chat-room-test` now shows the line), selectable via `SLIPPY_APPEARANCE_PREVIEW` with `SLIPPY_MAPS_TEST_STYLE=light|dark`.

- [ ] **Step 1: Fixture file**

Create `ios/Slippy/Views/Social/BalanceFixtures.swift`:

```swift
#if DEBUG
import SwiftUI

// Synthetic data for simulator screenshots of the balance UI
// (SLIPPY_APPEARANCE_PREVIEW=friend-balance-test | balance-detail-test).
// No network: BalanceViewModel.isFixture short-circuits its load.

struct FriendBalanceFixtureScreen: View {
    @StateObject private var balances = BalanceViewModel.fixture()
    private let friends = [
        UserProfile(id: MessagesViewModel.fixtureFriendId, email: "ploy@example.invalid", fullName: "พลอย", avatarUrl: nil),
        UserProfile(id: "fx-golf", email: "golf@example.invalid", fullName: "กอล์ฟ", avatarUrl: nil),
        UserProfile(id: "fx-mint", email: "mint@example.invalid", fullName: "มิ้นท์", avatarUrl: nil),
    ]
    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(friends) { friend in
                    FriendRow(friend: friend, net: balances.summary(for: friend.id)?.net)
                }
            }
            .padding(20)
        }
        .background(Color.background.ignoresSafeArea())
    }
}

struct BalanceDetailFixtureScreen: View {
    @StateObject private var balances = BalanceViewModel.fixture(tripsIncluded: false)
    var body: some View {
        BalanceDetailView(friendId: MessagesViewModel.fixtureFriendId, friendName: "พลอย", vm: balances)
    }
}
#endif
```

- [ ] **Step 2: Chat room fixture shows the line**

In `ChatFixtures.swift`, change `ChatRoomFixtureScreen` to keep a balance view model and pass it:

```swift
struct ChatRoomFixtureScreen: View {
    @StateObject private var messages = MessagesViewModel.chatFixture()
    @StateObject private var balances = BalanceViewModel.fixture()
    var body: some View {
        NavigationStack {
            FriendChatRoomView(
                vm: messages,
                conversationId: MessagesViewModel.fixtureConversationId,
                currentUserId: MessagesViewModel.fixtureMyId,
                friendName: "พลอย", friendAvatarUrl: nil, showsAvatars: true,
                friendUserId: MessagesViewModel.fixtureFriendId,
                balanceViewModel: balances)
        }
    }
}
```

- [ ] **Step 3: Two cases in `SlippyApp.swift`**

Edit with this exact old string (it exists once, added by the chat redesign):

old:
```swift
            case "add-friend-test": AddFriendFixtureScreen()
```
new:
```swift
            case "add-friend-test": AddFriendFixtureScreen()
            case "friend-balance-test": FriendBalanceFixtureScreen()
            case "balance-detail-test": BalanceDetailFixtureScreen()
```

Prove the hunk is additive:

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff -U0 ios/Slippy/App/SlippyApp.swift | grep -c '^+.*\(friend-balance-test\|balance-detail-test\)'
git diff --stat ios/Slippy/App/SlippyApp.swift | tail -1
```

Expected: `2`, and the file's total reads `+2` relative to the state recorded at Preflight (committed HEAD already contains the 3 chat cases only if they were committed with the whole hunk — compare against `git diff --stat` taken at Preflight and require exactly 2 more insertions).

- [ ] **Step 4: Register, build, install**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
ruby "$SCRATCH/add_files.rb" Slippy/Views/Social/BalanceFixtures.swift
./scripts/build-simulator.sh > /private/tmp/slippy-bal-task7-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-bal-task7-build.log | sort -u | head; grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-bal-task7-build.log
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068
xcrun simctl list devices | grep "$UDID"; xcrun simctl boot "$UDID" 2>&1 | head -1
xcrun simctl install "$UDID" /private/tmp/slippy-simulator-derived/Build/Products/Debug-iphonesimulator/Slippy.app && echo installed
```

Expected: build succeeded, device listed, `installed`. If the UDID is stale pick any iPhone from `xcrun simctl list devices available`.

- [ ] **Step 5: Screenshots (Light and Dark)**

```bash
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068; OUT=/private/tmp/slippy-balance-shots; mkdir -p "$OUT"
for screen in friend-balance-test balance-detail-test chat-room-test; do
  for style in light dark; do
    SIMCTL_CHILD_SLIPPY_APPEARANCE_PREVIEW=$screen SIMCTL_CHILD_SLIPPY_MAPS_TEST_STYLE=$style \
      xcrun simctl launch --terminate-running-process "$UDID" app.slippy.ios >/dev/null
    sleep 4
    xcrun simctl io "$UDID" screenshot "$OUT/$screen-$style.png" 2>&1 | tail -1
  done
done
ls -1 "$OUT"
```

Expected: six PNGs. Open each with the Read tool and check against the spec:
- `friend-balance-test`: พลอย shows chip `ค้างคุณ ฿390.50` (300 + 150.50 − 60, the unattributed 500 excluded); กอล์ฟ shows `คุณค้าง ฿1,234.50`; มิ้นท์ shows the plain check icon (no chip). Legible in Dark.
- `balance-detail-test`: headline `พลอย ค้างคุณ ฿390.50`; sections บิล / นัดกีฬา / ขอเงิน with title, `ค้างคุณ`/`คุณค้าง · d/M`, amount; the footnote `มี 1 รายการที่คำนวณยอดให้ไม่ได้` and `ยังไม่รวมยอดจากทริป`; the 500 is **not** in any amount.
- `chat-room-test`: the slim line `ค้างกัน ฿390.50 · ดูรายละเอียด` under the title; bubbles, composer and day chips as before.

If a screenshot is blank, wrong or unreadable, fix the view (not the fixture) and repeat from Step 4. Do not describe a screen you did not look at. The simulator may show a stale screenshot right after a tap/launch: wait and capture again.

- [ ] **Step 6: Interaction + failure path on the simulator**

Using `mcp__Claude_Code_iOS_Simulator__control`: launch `chat-room-test` (light), tap the balance line → the detail sheet opens with the breakdown; close it. Then launch `balance-detail-test` and confirm the content. For the failure path, temporarily run a fixture with `BalanceViewModel.fixture(failed: true)` (edit `BalanceDetailFixtureScreen` locally, screenshot, **revert the edit**) and confirm it shows `โหลดยอดค้างไม่สำเร็จ ลองใหม่อีกครั้ง` and the friends/chat UI show no chip/line. Record what you actually saw; if the simulator control is unavailable, say the interaction check was not obtained.

- [ ] **Step 7: Run every check, then confirm repository state**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
export PATH=/usr/local/bin:$PATH
node scripts/verify-balance-presentation.mjs
node scripts/verify-chat-presentation.mjs
node scripts/verify-chat-send-contract.mjs
cd ..
for f in friend_balances trip_settlement_threeway friend_balances_trips; do
  [ -f supabase/tests/$f.test.sql ] && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/$f.test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED"
done
git diff --check; echo "diffcheck=$?"
git status --short | wc -l
git status --short | grep -E "Balance|Social|Split|Chat|MessageModels|MessagesViewModel|SlippyApp|friend_balances|trip_settlement|verify-balance"
```

Expected: the three host scripts print `PASS`; each SQL test that exists prints `… PASSED` (or, if the Task 2 gate failed, `trip_settlement_threeway` prints its `FAIL` line — that is the recorded finding, not a plan failure); `diffcheck=0`; the entry count equals the Preflight count plus these new files: `friend_balances.test.sql`, `friend_balances_trips.test.sql` (if created), `trip_settlement_threeway.test.sql`, the two migrations (one if the gate failed), `BalancePresentation.swift`, `BalanceViewModel.swift`, `FriendBalanceViews.swift`, `BalanceFixtures.swift`, `verify-balance-presentation.mjs`. The `grep` must list only files this plan names; any other changed file means something unintended moved — investigate before reporting.

- [ ] **Step 8: Final state — no commit**

Do not commit and do not apply either migration anywhere except the local database. Report to the user: which checks passed (with the actual output lines), the screenshot paths and what each showed, the failure-path observation, the **Task 2 gate result** (and, if it failed, the exact test output and the proposed separate fix), the list of changed/new files, the deployment order (migration → then iOS), and what was **not** verified: the production migration, hosted data and real multi-user flows, a physical device (provisioning profile is expired), the LINE participants on real data, web, and that existing participants stay unlinked until a friend is chosen or a LINE id is connected. Ask whether to commit; that is a separate approval, as is applying the migration to the hosted database.

---

## Self-Review (done while writing)

**Spec coverage:** §4.1 identity → Task 1 (column, LINE backfill + read-time resolution), Task 6 (friend picker); §4.2 rules → Task 1 SQL + test (bills, sport, requests, no double count, THB, expiry, unattributed, friends-only) and Task 2 (trips, confirmed-payment rule, base currency); §4.3 function → Tasks 1–2 (definer, `auth.uid()`, pinned `search_path`, REVOKE PUBLIC+anon); §4.4 UI → Task 5 (chip, chat line, detail screen, empty/failed/unattributed/trips-missing states); §6 verification → Tasks 1–3, 7; non-goals respected (no chat cards, no payments, no engine changes, no web). Spec §9 amendments (friends-only counterparts, trip rule mirrors web UI, `base_currency`, settlement gate, unattributed counterpart rule, read-time LINE resolution, linking only in bill creation) are implemented as written there.

**Placeholders:** the trips test in Task 2 Step 4 is given as fixture list + assertions that follow the exact insert shapes of two named existing tests; it is intentionally not repeated in full because Task 1's test file already shows the guard/helper/impersonation boilerplate and Task 2 Step 1 shows every trip insert needed. Everything else has full code.

**Type consistency:** `BalancePresentation.Entry` fields and `CodingKeys` match the SQL columns (`counterpart_user_id, direction, amount, source_kind, source_id, title, occurred_at, attributed`); `friend_balances()` and `friend_balances_trips()` share that shape; `FriendChatRoomView(…friendUserId:balanceViewModel:)` matches Tasks 5 and 7; `createBill` tuple label order `(name, amount, userId)` matches `CreateSplitView.save()`; `MessagesViewModel.fixtureFriendId` is used consistently in the fixtures.

**Known risks for the executor:** the SQL and Swift were written against the schema/code as read on 2026-11-09 and have **not been run or compiled**; expect small fixes (an unqualified column, a `UNION ALL` type, an `rpc` overload). `$SCRATCH` in the Ruby helper is the session scratchpad directory. The balance numbers for trips depend on the Task 2 gate. Sport sessions only show linked participants (host-added guests by name stay invisible until a later "link this person" action).
