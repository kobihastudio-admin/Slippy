// Static checks for supabase/migrations/20261113100000_related_profiles_rpc.sql.
// The SQL is NOT run here (no Postgres on this machine); this guards the shape that was reviewed:
//   1. only four columns come out, never phone / date_of_birth / is_superadmin;
//   2. rows only for the caller, friends (pending/accepted, not blocked) and people in a shared conversation;
//   3. the email is withheld from everyone but the caller and accepted friends;
//   4. SECURITY DEFINER with a pinned search_path, callable by authenticated only, no policy on public.users touched.
// Run: node --test supabase/tests/related-profiles-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261113100000_related_profiles_rpc.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

test("the migration file exists and its header says whether it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  assert.match(sql.split("\n").slice(0, 3).join("\n"), /NOT APPLIED|APPLIED \d{4}-\d{2}-\d{2}/)
})

test("the function returns exactly id, full_name, avatar_url and email", () => {
  const m = code.match(/RETURNS TABLE \(([^)]*)\)/)
  assert.ok(m, "RETURNS TABLE missing")
  assert.deepEqual(m[1].split(",").map((s) => s.trim().split(/\s+/)[0]), ["id", "full_name", "avatar_url", "email"])
  for (const secret of ["phone", "date_of_birth", "is_superadmin", "account_mode", "bio"]) {
    assert.ok(!code.includes(secret), `${secret} must not be exposed`)
  }
})

test("it is SECURITY DEFINER, STABLE, with a pinned search_path", () => {
  assert.match(code, /LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/)
})

test("nothing is returned to an unauthenticated caller, and the id list is capped", () => {
  assert.match(code, /WHERE auth\.uid\(\) IS NOT NULL/)
  assert.match(code, /u\.id = ANY \(p_ids\[1:200\]\)/)
})

test("rows are limited to the caller, pending/accepted friends (either direction) and shared-conversation members", () => {
  const where = code.slice(code.indexOf("FROM public.users u"))
  assert.match(where, /u\.id = auth\.uid\(\)/)
  assert.match(where, /f\.status IN \('pending', 'accepted'\)/)
  assert.doesNotMatch(where, /'blocked'/)
  assert.match(where, /f\.requester_id = auth\.uid\(\) AND f\.addressee_id = u\.id/)
  assert.match(where, /f\.addressee_id = auth\.uid\(\) AND f\.requester_id = u\.id/)
  assert.match(where, /mine\.user_id = auth\.uid\(\) AND theirs\.user_id = u\.id/)
})

test("the email is given to the caller and accepted friends only; everyone else gets ''", () => {
  const sel = code.slice(code.indexOf("CASE"), code.indexOf("END AS email"))
  assert.match(sel, /WHEN u\.id = auth\.uid\(\) THEN COALESCE\(u\.email, ''\)/)
  assert.match(sel, /f\.status = 'accepted'/)
  assert.match(sel, /ELSE ''/)
})

test("only authenticated (and service_role) may call it; nothing for PUBLIC or anon", () => {
  assert.match(code, /REVOKE ALL ON FUNCTION public\.get_related_profiles\(uuid\[\]\) FROM PUBLIC, anon;/)
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.get_related_profiles\(uuid\[\]\) TO authenticated, service_role;/)
})

test("no policy, table or data is touched; only the function is created", () => {
  assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|ALTER TABLE|DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE public/i)
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1)
})

test("a rollback is documented as a comment", () => {
  assert.match(sql, /-- ROLLBACK[\s\S]*-- {3}DROP FUNCTION IF EXISTS public\.get_related_profiles\(uuid\[\]\);/)
})
