// Host test for Slippy/Utils/ProfileIds.swift (Foundation only): how ids are prepared for the get_related_profiles RPC.
// Run: node ios/scripts/verify-profile-directory.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const sources = ['ProfileIds.swift', '../Models/UserProfile.swift'].map((n) => new URL(`../Slippy/Utils/${n}`, import.meta.url).pathname);
assert(readFileSync(sources[0], 'utf8').includes('enum ProfileIds'), 'ProfileIds.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-profile-ids-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
let a = "11111111-1111-4111-8111-111111111111"
let b = "22222222-2222-4222-8222-222222222222"

// --- normalized: lower-case, de-duplicated, first occurrence order, no blanks ---
check(ProfileIds.normalized([a, b]) == [a, b], "keeps order")
check(ProfileIds.normalized([a.uppercased(), b]) == [a, b], "upper-case uuids (UUID.uuidString) become lower-case, which is what Postgres returns")
check(ProfileIds.normalized([a, a.uppercased(), b, a]) == [a, b], "duplicates collapse, first one wins")
check(ProfileIds.normalized(["", "  ", a]) == [a], "blank ids are dropped")
check(ProfileIds.normalized([]).isEmpty, "empty in, empty out")

// --- chunks: the function reads at most 200 ids per call ---
check(ProfileIds.maxPerCall == 200, "matches the migration's p_ids[1:200]")
check(ProfileIds.chunks(["a", "b", "c", "d", "e"], size: 2) == [["a", "b"], ["c", "d"], ["e"]], "splits in order, last chunk short")
check(ProfileIds.chunks(["a"], size: 200) == [["a"]], "one id, one chunk")
check(ProfileIds.chunks([], size: 200).isEmpty, "nothing, no call")
let many = (0..<450).map { "id\\($0)" }
check(ProfileIds.chunks(many, size: ProfileIds.maxPerCall).map(\\.count) == [200, 200, 50], "450 ids -> 200 + 200 + 50")
check(ProfileIds.chunks(["a", "b"], size: 0) == [["a", "b"]], "a non-positive size cannot loop forever")

// --- the RPC row decodes into UserProfile (email is '' for non-friends) ---
let json = #"[{"id":"\\#(a)","full_name":"Somchai","avatar_url":null,"email":""},{"id":"\\#(b)","full_name":null,"avatar_url":"https://x/y.png","email":"b@example.com"}]"#
let rows = try JSONDecoder().decode([UserProfile].self, from: Data(json.utf8))
check(rows.count == 2 && rows[0].fullName == "Somchai" && rows[0].email == "", "a row with an empty email decodes")
check(rows[0].displayName == "Somchai", "name wins")
check(rows[1].displayName == "b", "no name: the email's local part")
let anonymous = try JSONDecoder().decode([UserProfile].self, from: Data(#"[{"id":"\\#(a)","full_name":null,"avatar_url":null,"email":""}]"#.utf8))
check(anonymous[0].displayName == "ผู้ใช้ Slippy", "no name and no email: a readable placeholder, not an empty or '—' label")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: profile directory (id preparation, chunking, RPC row decoding)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', ...sources, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
