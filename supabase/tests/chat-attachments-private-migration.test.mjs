// Static checks for supabase/migrations/20261114100000_chat_attachments_private.sql.
// The SQL is NOT run here (no Postgres on this machine); the behaviour was run separately with simulated users in a
// transaction that was rolled back (see docs/superpowers/specs/2026-11-14-private-chat-files-design.md). This guards the
// shape that was reviewed:
//   1. the bucket becomes private and the two open policies are gone;
//   2. read and upload are limited to members of the conversation named in the object path, with one shared helper;
//   3. nothing else is touched (no data, no other bucket, the delete policy stays);
//   4. a rollback is documented.
// Run: node --test supabase/tests/chat-attachments-private-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261114100000_chat_attachments_private.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

test("the migration file exists and its header says whether it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  assert.match(sql.split("\n").slice(0, 3).join("\n"), /NOT APPLIED|APPLIED \d{4}-\d{2}-\d{2}/)
})

test("the bucket becomes private, and only that bucket", () => {
  assert.match(code, /UPDATE storage\.buckets SET public = false WHERE id = 'chat-attachments';/)
  assert.equal((code.match(/UPDATE storage\.buckets/g) ?? []).length, 1)
})

test("the open policies are dropped", () => {
  assert.match(code, /DROP POLICY IF EXISTS "chat_attachments_select_public" ON storage\.objects;/)
  assert.match(code, /DROP POLICY IF EXISTS "chat_attachments_insert_authenticated" ON storage\.objects;/)
})

test("read and upload are for members of the conversation in the path, authenticated only", () => {
  for (const [name, verb, clause] of [
    ["chat_attachments_select_members", "SELECT", "USING"],
    ["chat_attachments_insert_members", "INSERT", "WITH CHECK"],
  ]) {
    const policy = code.match(new RegExp(`CREATE POLICY "${name}" ON storage\\.objects FOR ${verb} TO authenticated\\s+${clause} \\(([\\s\\S]*?)\\);`))?.[1] ?? ""
    assert.match(policy, /bucket_id = 'chat-attachments'/, `${name} is limited to the bucket`)
    assert.match(policy, /public\.is_conversation_member\(public\.chat_attachment_conversation\(name\)\)/, `${name} checks membership of the path's room`)
  }
})

test("the helper accepts only chat/<uuid>/<name>.<ext>, is immutable and strict, and has a pinned search_path", () => {
  const fn = code.match(/CREATE OR REPLACE FUNCTION public\.chat_attachment_conversation\(p_name text\) RETURNS uuid([\s\S]*?)\n\$\$;/)?.[1] ?? ""
  assert.match(fn, /IMMUTABLE/)
  assert.match(fn, /STRICT/)
  assert.match(fn, /SET search_path = public/)
  assert.match(fn, /\^chat\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\/\[a-z0-9\]\+\\\.\[a-z0-9\]\{1,8\}\$/)
  assert.match(code, /REVOKE ALL ON FUNCTION public\.chat_attachment_conversation\(text\) FROM PUBLIC;/)
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.chat_attachment_conversation\(text\) TO authenticated, service_role;/)
})

test("no data, no other table, and the delete-own policy are left alone", () => {
  assert.doesNotMatch(code, /DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE|INSERT INTO|UPDATE public/i)
  assert.doesNotMatch(code, /chat_attachments_delete_own/, "the delete policy is not touched")
  assert.doesNotMatch(code, /trip-photos|trip-documents|'documents'|avatars|payment-proofs/)
})

test("the header explains the order: clients first, migration second", () => {
  assert.match(sql, /ORDER: 1\) deploy the web image and install the iOS build that sign URLs[\s\S]*2\) apply this migration/)
})

test("a rollback is documented as a comment, restoring the public bucket and both old policies", () => {
  assert.match(sql, /-- ROLLBACK[\s\S]*-- {3}UPDATE storage\.buckets SET public = true WHERE id = 'chat-attachments';[\s\S]*chat_attachments_select_public[\s\S]*chat_attachments_insert_authenticated/)
})
