// Static checks for supabase/migrations/20261113130000_open_direct_conversation.sql.
// The SQL is NOT run here (no Postgres on this machine); this guards the shape that was reviewed:
//   1. only an accepted friend can be opened, as the signed-in caller, never as yourself;
//   2. an existing room is reused (by pair key, or by its two members) and a lost race returns the winner's room;
//   3. the room and both members are created together, inside a SECURITY DEFINER function with a pinned search_path;
//   4. callable by authenticated only; the pair-key guard now looks at the executing role, so a user's own JWT still cannot
//      set the key but this function can; no policy is touched.
// Run: node --test supabase/tests/open-direct-conversation-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261113130000_open_direct_conversation.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
const fn = (name) => code.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)([\\s\\S]*?)\\n\\$\\$;`))?.[1] ?? ""

test("the migration file exists and its header says whether it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  assert.match(sql.split("\n").slice(0, 3).join("\n"), /NOT APPLIED|APPLIED \d{4}-\d{2}-\d{2}/)
})

test("open_direct_conversation is SECURITY DEFINER with a pinned search_path and returns the room id", () => {
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.open_direct_conversation\(p_friend_id uuid\) RETURNS uuid\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/)
})

test("the caller must be signed in, cannot open a chat with themselves, and must have an ACCEPTED friendship", () => {
  const f = fn("open_direct_conversation")
  assert.match(f, /me\s+uuid := auth\.uid\(\)/)
  assert.match(f, /IF me IS NULL THEN\s+RAISE EXCEPTION 'not_authenticated'/)
  assert.match(f, /p_friend_id IS NULL OR p_friend_id = me/)
  assert.match(f, /f\.status = 'accepted'/)
  assert.match(f, /f\.requester_id = me AND f\.addressee_id = p_friend_id/)
  assert.match(f, /f\.addressee_id = me AND f\.requester_id = p_friend_id/)
  assert.match(f, /RAISE EXCEPTION 'not_friends'/)
  assert.doesNotMatch(f, /'pending'|'blocked'/, "pending and blocked friendships do not allow a chat")
})

test("the pair key is the smaller id first in plain code-unit order, like the web helper", () => {
  const f = fn("open_direct_conversation")
  assert.match(f, /me::text COLLATE "C" < p_friend_id::text COLLATE "C"/)
  assert.match(f, /key := me::text \|\| ':' \|\| p_friend_id::text/)
  assert.match(f, /key := p_friend_id::text \|\| ':' \|\| me::text/)
})

test("an existing room is reused: by pair key, then by exactly its two members", () => {
  const f = fn("open_direct_conversation")
  assert.match(f, /c\.type = 'direct' AND c\.direct_pair_key = key/)
  assert.match(f, /count\(\*\) FROM public\.conversation_members m WHERE m\.conversation_id = c\.id\) = 2/)
  assert.match(f, /IF room IS NOT NULL THEN\s+RETURN room;/)
})

test("a new room is created with the key and both members (caller admin), and a lost race returns the winner", () => {
  const f = fn("open_direct_conversation")
  assert.match(f, /INSERT INTO public\.conversations \(type, created_by, direct_pair_key\)\s+VALUES \('direct', me, key\)/)
  assert.match(f, /EXCEPTION WHEN unique_violation THEN/)
  assert.match(f, /INSERT INTO public\.conversation_members \(conversation_id, user_id, role\)\s+VALUES \(room, me, 'admin'\), \(room, p_friend_id, 'member'\)/)
})

test("only authenticated and service_role may execute; nothing for PUBLIC or anon", () => {
  assert.match(code, /REVOKE ALL ON FUNCTION public\.open_direct_conversation\(uuid\) FROM PUBLIC, anon;/)
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.open_direct_conversation\(uuid\) TO authenticated, service_role;/)
})

test("the pair-key guard refuses a user's own role (authenticated / anon), not the SECURITY DEFINER owner or the service role", () => {
  const g = fn("guard_direct_pair_key")
  assert.match(g, /IF current_user IN \('authenticated', 'anon'\)/)
  assert.doesNotMatch(g, /auth\.uid\(\)/, "it must not depend on the JWT claims any more")
  assert.match(g, /TG_OP = 'INSERT' AND NEW\.direct_pair_key IS NOT NULL/)
  assert.match(g, /TG_OP = 'UPDATE' AND NEW\.direct_pair_key IS DISTINCT FROM OLD\.direct_pair_key/)
  assert.match(g, /RAISE EXCEPTION[^;]*ERRCODE = '42501'/)
})

test("no policy, table, trigger or data is touched; only the two functions are (re)defined", () => {
  assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|ALTER TABLE|DROP TABLE|CREATE TRIGGER|DROP TRIGGER|TRUNCATE|DELETE FROM|UPDATE public/i)
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2)
})

test("a rollback is documented as a comment, including how to restore the previous guard", () => {
  assert.match(sql, /-- ROLLBACK[\s\S]*-- {3}DROP FUNCTION IF EXISTS public\.open_direct_conversation\(uuid\);[\s\S]*-- {3}CREATE OR REPLACE FUNCTION public\.guard_direct_pair_key\(\)/)
})
