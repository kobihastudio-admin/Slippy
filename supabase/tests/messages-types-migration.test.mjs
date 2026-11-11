// Static checks for supabase/migrations/20261110130000_messages_types_and_insert_policy.sql.
// The SQL is NOT run here (no Postgres on this machine); this only guards the shape that was reviewed:
//   1. video + file become valid message types (the web chat sends them and the old CHECK rejected them);
//   2. members can only insert user-authored types, so payment_request / slip / system stay server-only.
// Run: node --test supabase/tests/messages-types-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261110130000_messages_types_and_insert_policy.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
const list = (m) => (m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : [])

test("the migration file exists and its header records that it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  const header = sql.split("\n").slice(0, 4).join("\n")
  assert.match(header, /APPLIED 2026-11-11/)
  assert.doesNotMatch(header, /NOT APPLIED/)
})

test("the CHECK lists exactly the old five types plus video and file", () => {
  const m = code.match(/ADD CONSTRAINT messages_msg_type_check\s+CHECK \(msg_type IN \(([^)]*)\)\)/)
  assert.deepEqual(list(m), ["file", "image", "payment_request", "slip", "system", "text", "video"])
})

test("the old constraint is dropped first, by name, only that one", () => {
  assert.match(code, /ALTER TABLE public\.messages DROP CONSTRAINT IF EXISTS messages_msg_type_check/)
  assert.doesNotMatch(code, /messages_sender_required/)
})

test("members may insert only text/image/video/file, as themselves, into rooms they belong to", () => {
  const policy = code.match(/CREATE POLICY messages_member_insert ON public\.messages([\s\S]*?);/)
  assert.ok(policy, "policy statement missing")
  const body = policy[1]
  assert.match(body, /FOR INSERT TO authenticated/)
  assert.match(body, /sender_id = auth\.uid\(\)/)
  assert.match(body, /public\.is_conversation_member\(conversation_id\)/)
  assert.deepEqual(list(body.match(/msg_type IN \(([^)]*)\)/)), ["file", "image", "text", "video"])
  for (const serverOnly of ["payment_request", "slip", "system"]) assert.ok(!body.includes(serverOnly), serverOnly)
})

test("the policy is replaced in place; the read policy, RLS and the table are untouched", () => {
  assert.match(code, /DROP POLICY IF EXISTS messages_member_insert ON public\.messages/)
  assert.equal((code.match(/CREATE POLICY/g) ?? []).length, 1)
  assert.doesNotMatch(code, /messages_member_read|DISABLE ROW LEVEL SECURITY|DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.messages/i)
})

test("a rollback block is documented (as comments) so the change can be undone", () => {
  assert.match(sql, /-- ROLLBACK[\s\S]*ADD CONSTRAINT messages_msg_type_check[\s\S]*CREATE POLICY messages_member_insert/)
})
