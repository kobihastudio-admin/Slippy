// Static checks for supabase/migrations/20261111120000_direct_conversation_pair_key.sql.
// The SQL is NOT run here (no Postgres on this machine); this only guards the shape that was reviewed:
//   1. a nullable key column, a partial UNIQUE index on it for direct rooms only, and a shape CHECK;
//   2. the backfill orders ids with COLLATE "C", like the application (plain code-unit order);
//   3. a user's own JWT cannot set or change the key (otherwise anyone could squat another pair's key);
//   4. policies, RLS and data of other tables are untouched.
// Run: node --test supabase/tests/direct-pair-key-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261111120000_direct_conversation_pair_key.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

test("the migration file exists and its header says whether it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  const header = sql.split("\n").slice(0, 3).join("\n")
  assert.match(header, /NOT APPLIED|APPLIED \d{4}-\d{2}-\d{2}/)
})

test("direct_pair_key is a nullable text column (writers that do not set it keep working)", () => {
  assert.match(code, /ALTER TABLE public\.conversations ADD COLUMN IF NOT EXISTS direct_pair_key text;/)
  assert.doesNotMatch(code, /direct_pair_key text NOT NULL/i)
})

test("the UNIQUE index is partial: direct rooms with a key only", () => {
  const m = code.match(/CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_key_key\s+ON public\.conversations \(direct_pair_key\)\s+WHERE ([^;]*);/)
  assert.ok(m, "unique index missing")
  assert.match(m[1], /type = 'direct'/)
  assert.match(m[1], /direct_pair_key IS NOT NULL/)
})

test("the CHECK allows a key only on direct rooms, as two ordered lower-case uuids", () => {
  const m = code.match(/ADD CONSTRAINT conversations_direct_pair_key_shape CHECK \(([\s\S]*?)\n\);/)
  assert.ok(m, "check missing")
  assert.match(m[1], /direct_pair_key IS NULL/)
  assert.match(m[1], /type = 'direct'/)
  assert.match(m[1], /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}:/)
  assert.match(m[1], /split_part\(direct_pair_key, ':', 1\) COLLATE "C" < split_part\(direct_pair_key, ':', 2\) COLLATE "C"/)
})

test("the backfill covers direct rooms with exactly two distinct members and orders with COLLATE \"C\"", () => {
  const m = code.match(/UPDATE public\.conversations c([\s\S]*?);\s*\n\s*\nCREATE UNIQUE INDEX/)
  assert.ok(m, "backfill missing")
  assert.match(m[1], /min\(m\.user_id::text COLLATE "C"\) \|\| ':' \|\| max\(m\.user_id::text COLLATE "C"\)/)
  assert.match(m[1], /cc\.type = 'direct'/)
  assert.match(m[1], /HAVING count\(\*\) = 2 AND count\(DISTINCT m\.user_id\) = 2/)
  assert.match(m[1], /c\.direct_pair_key IS NULL/)
})

test("the key is created and backfilled before the unique index", () => {
  const at = (re) => code.search(re)
  assert.ok(at(/ADD COLUMN IF NOT EXISTS direct_pair_key/) < at(/UPDATE public\.conversations c/))
  assert.ok(at(/UPDATE public\.conversations c/) < at(/CREATE UNIQUE INDEX/))
})

test("a user's own JWT cannot set or change the key; the service role and SQL can", () => {
  const fn = code.match(/CREATE OR REPLACE FUNCTION public\.guard_direct_pair_key\(\)([\s\S]*?)\$\$;/)
  assert.ok(fn, "guard function missing")
  assert.match(fn[1], /auth\.uid\(\) IS NOT NULL/)
  assert.match(fn[1], /TG_OP = 'INSERT' AND NEW\.direct_pair_key IS NOT NULL/)
  assert.match(fn[1], /TG_OP = 'UPDATE' AND NEW\.direct_pair_key IS DISTINCT FROM OLD\.direct_pair_key/)
  assert.match(fn[1], /RAISE EXCEPTION/)
  assert.match(fn[1], /SET search_path = public/)
  assert.doesNotMatch(fn[1], /SECURITY DEFINER/i)
  assert.match(code, /CREATE TRIGGER conversations_guard_direct_pair_key\s+BEFORE INSERT OR UPDATE ON public\.conversations\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_direct_pair_key\(\)/)
})

test("no policy, RLS setting or other table is touched, and no data is deleted", () => {
  assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|DISABLE ROW LEVEL SECURITY|DROP TABLE|TRUNCATE|DELETE FROM/i)
  // every schema-qualified name in the executable SQL is one of the two chat tables or an object this migration adds
  const names = new Set([...code.matchAll(/public\.(\w+)/g)].map((x) => x[1]))
  const allowed = new Set(["conversations", "conversation_members", "guard_direct_pair_key"])
  assert.deepEqual([...names].filter((n) => !allowed.has(n)), [])
  assert.ok(!/\bmessages\b|\busers\b/.test(code), "other tables must not be referenced")
})

test("a rollback block is documented (as comments) and removes every object the migration adds", () => {
  for (const drop of [
    /-- {3}DROP TRIGGER IF EXISTS conversations_guard_direct_pair_key/,
    /-- {3}DROP FUNCTION IF EXISTS public\.guard_direct_pair_key\(\)/,
    /-- {3}DROP INDEX IF EXISTS public\.conversations_direct_pair_key_key/,
    /-- {3}ALTER TABLE public\.conversations DROP CONSTRAINT IF EXISTS conversations_direct_pair_key_shape/,
    /-- {3}ALTER TABLE public\.conversations DROP COLUMN IF EXISTS direct_pair_key/,
  ]) assert.match(sql, drop)
})
