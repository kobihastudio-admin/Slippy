// Static checks for supabase/migrations/20261112100000_document_reports.sql.
// The SQL is NOT run here (no Postgres on this machine); this guards the shape that was reviewed:
//   1. categories/status are closed lists that match the iOS enum (ios/Slippy/Utils/DocumentReportSupport.swift);
//   2. a member can insert only as themselves, for their own organization's document, with status 'open';
//   3. a user's JWT can read only its own reports and cannot update or delete anything;
//   4. table privileges are narrowed, and nothing else is touched.
// Run: node --test supabase/tests/document-reports-migration.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const path = new URL("../migrations/20261112100000_document_reports.sql", import.meta.url)
let sql = ""
try { sql = readFileSync(path, "utf8") } catch { /* asserted below */ }
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
const list = (m) => (m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [])

test("the migration file exists and its header says whether it was applied", () => {
  assert.ok(sql.length > 0, `missing ${path.pathname}`)
  assert.match(sql.split("\n").slice(0, 3).join("\n"), /NOT APPLIED|APPLIED \d{4}-\d{2}-\d{2}/)
})

test("categories match the iOS enum, in the same order", () => {
  const m = code.match(/category\s+text\s+NOT NULL\s+CHECK \(category IN \(([^)]*)\)\)/)
  const swift = readFileSync(new URL("../../ios/Slippy/Utils/DocumentReportSupport.swift", import.meta.url), "utf8")
  const enumBlock = swift.slice(swift.indexOf("enum DocumentReportCategory"), swift.indexOf("var id: String"))
  const cases = [...enumBlock.matchAll(/case \w+ = "([a-z_]+)"/g)].map((x) => x[1])
  assert.deepEqual(list(m), ["wrong_amount", "wrong_vendor", "wrong_date", "wrong_tax", "unreadable", "duplicate", "other"])
  assert.deepEqual(cases, list(m))
})

test("status is a closed list defaulting to open", () => {
  const m = code.match(/status\s+text\s+NOT NULL DEFAULT 'open'\s+CHECK \(status IN \(([^)]*)\)\)/)
  assert.deepEqual(list(m), ["open", "reviewing", "resolved", "dismissed"])
})

test("the note is 1..1000 characters when present, and required for 'other'", () => {
  assert.match(code, /note\s+text\s+CHECK \(note IS NULL OR char_length\(note\) BETWEEN 1 AND 1000\)/)
  assert.match(code, /CONSTRAINT document_reports_other_needs_note CHECK \(category <> 'other' OR note IS NOT NULL\)/)
})

test("document, organization and reporter are foreign keys that cascade", () => {
  assert.match(code, /document_id\s+uuid\s+NOT NULL REFERENCES public\.documents\(id\) ON DELETE CASCADE/)
  assert.match(code, /organization_id\s+uuid\s+NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE/)
  assert.match(code, /reporter_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/)
})

test("one open report per (document, reporter, category): a partial unique index", () => {
  const m = code.match(/CREATE UNIQUE INDEX IF NOT EXISTS document_reports_open_unique\s+ON public\.document_reports \(([^)]*)\)\s+WHERE status = 'open';/)
  assert.ok(m, "unique index missing")
  assert.deepEqual(m[1].split(",").map((s) => s.trim()), ["document_id", "reporter_id", "category"])
})

test("RLS is on, and members insert only as themselves, open, for their own organization's document", () => {
  assert.match(code, /ALTER TABLE public\.document_reports ENABLE ROW LEVEL SECURITY;/)
  const p = code.match(/CREATE POLICY document_reports_member_insert ON public\.document_reports([\s\S]*?\n  \);)/)
  assert.ok(p, "insert policy missing")
  assert.match(p[1], /FOR INSERT TO authenticated/)
  assert.match(p[1], /reporter_id = auth\.uid\(\)/)
  assert.match(p[1], /status = 'open'/)
  assert.match(p[1], /organization_id = ANY \(get_my_org_ids\(\)\)/)
  assert.match(p[1], /d\.id = document_reports\.document_id/)
  assert.match(p[1], /d\.organization_id = document_reports\.organization_id/)
})

test("a user can read only their own reports; no update or delete policy exists", () => {
  const p = code.match(/CREATE POLICY document_reports_own_select ON public\.document_reports([\s\S]*?);/)
  assert.ok(p, "select policy missing")
  assert.match(p[1], /FOR SELECT TO authenticated/)
  assert.match(p[1], /USING \(reporter_id = auth\.uid\(\)\)/)
  assert.equal((code.match(/CREATE POLICY/g) ?? []).length, 2)
  assert.doesNotMatch(code, /FOR (UPDATE|DELETE|ALL)/)
})

test("privileges: nothing for public/anon, only SELECT+INSERT for authenticated", () => {
  assert.match(code, /REVOKE ALL ON TABLE public\.document_reports FROM PUBLIC, anon, authenticated;/)
  assert.match(code, /GRANT SELECT, INSERT ON TABLE public\.document_reports TO authenticated;/)
  assert.match(code, /GRANT ALL ON TABLE public\.document_reports TO service_role;/)
  assert.doesNotMatch(code, /GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE)\b[^;]*TO authenticated/)
})

test("only the new table is created or changed; no other table, policy or data is touched", () => {
  const names = new Set([...code.matchAll(/public\.(\w+)/g)].map((x) => x[1]))
  assert.deepEqual([...names].sort(), ["document_reports", "documents", "organizations", "users"])
  assert.doesNotMatch(code, /DROP (TABLE|POLICY)|TRUNCATE|DELETE FROM|UPDATE public|ALTER TABLE public\.(documents|organizations|users)/i)
})

test("a rollback is documented as a comment", () => {
  assert.match(sql, /-- ROLLBACK[\s\S]*-- {3}DROP TABLE IF EXISTS public\.document_reports;/)
})
