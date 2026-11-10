// Host test for Slippy/Utils/ChatPaging.swift (Foundation only): newest-page history, merge, cursor, direct-room pick.
// Run: node ios/scripts/verify-chat-paging.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/ChatPaging.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('enum ChatPaging'), 'ChatPaging.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-chat-paging-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }

struct M: PagedMessage, Equatable { let id: String; let createdAt: String; var tag = "" }
func ids(_ list: [M]) -> [String] { list.map(\\.id) }

// --- merge: dedupe by id, incoming wins, oldest first ---
let a = M(id: "a", createdAt: "2026-11-09T10:00:00+00:00")
let b = M(id: "b", createdAt: "2026-11-09T10:01:00+00:00")
let c = M(id: "c", createdAt: "2026-11-09T10:02:00+00:00")
check(ids(ChatPaging.merge(existing: [a, b], incoming: [b, c])) == ["a", "b", "c"], "merge adds the new message once")
check(ChatPaging.merge(existing: [a, b], incoming: [M(id: "b", createdAt: b.createdAt, tag: "new"), c]).first { $0.id == "b" }?.tag == "new", "incoming copy wins for the same id")
check(ids(ChatPaging.merge(existing: [c, a], incoming: [b])) == ["a", "b", "c"], "result is ordered oldest first whatever the input order")
check(ids(ChatPaging.merge(existing: [], incoming: [c, a, b])) == ["a", "b", "c"], "empty existing")
check(ids(ChatPaging.merge(existing: [b, a], incoming: [])) == ["a", "b"], "empty incoming keeps and orders existing")
check(ids(ChatPaging.merge(existing: [a], incoming: [b, b, b])) == ["a", "b"], "duplicates inside one page collapse")
check(ChatPaging.merge(existing: [M](), incoming: [M]()).isEmpty, "nothing in, nothing out")

// --- ordering inside one second: Postgres sends 0-6 fraction digits and trims zeros ---
let s0 = M(id: "s0", createdAt: "2026-11-09T10:00:12+00:00")
let s45 = M(id: "s45", createdAt: "2026-11-09T10:00:12.45+00:00")
let s5 = M(id: "s5", createdAt: "2026-11-09T10:00:12.5+00:00")
let s512 = M(id: "s512", createdAt: "2026-11-09T10:00:12.512345+00:00")
check(ids(ChatPaging.merge(existing: [s512, s5, s0], incoming: [s45])) == ["s0", "s45", "s5", "s512"], "fraction digits compare numerically (.45 < .5 < .512345)")

// --- same instant: stable by id, and Z equals +00:00 ---
let t1 = M(id: "m2", createdAt: "2026-11-09T10:00:00Z")
let t2 = M(id: "m1", createdAt: "2026-11-09T10:00:00+00:00")
check(ids(ChatPaging.merge(existing: [t1], incoming: [t2])) == ["m1", "m2"], "same instant orders by id")

// --- different offsets are compared as instants ---
let local = M(id: "l", createdAt: "2026-11-09T17:30:00+07:00")   // = 10:30 UTC
let utc = M(id: "u", createdAt: "2026-11-09T10:15:00+00:00")
check(ids(ChatPaging.merge(existing: [local], incoming: [utc])) == ["u", "l"], "+07:00 is converted before comparing")

// --- unparsable timestamps never crash and never get lost ---
let junk = M(id: "j", createdAt: "not a date")
check(Set(ids(ChatPaging.merge(existing: [a], incoming: [junk]))) == ["a", "j"], "an unparsable timestamp is kept")

// --- cursor value for the "older than" query: no raw '+' in a query string ---
check(ChatPaging.cursorValue("2026-11-09T15:55:12.123456+00:00") == "2026-11-09T15:55:12.123456Z", "+00:00 becomes Z, microseconds kept")
check(ChatPaging.cursorValue("2026-11-09T15:55:12.5+00:00") == "2026-11-09T15:55:12.5Z", "short fraction kept as is")
check(ChatPaging.cursorValue("2026-11-09T15:55:12Z") == "2026-11-09T15:55:12Z", "already Z")
check(ChatPaging.cursorValue("2026-11-09T22:55:12.123456+07:00") == "2026-11-09T15:55:12.123456Z", "other offsets are converted to UTC")
check(ChatPaging.cursorValue("2026-11-09T05:00:00.25-05:00") == "2026-11-09T10:00:00.25Z", "negative offsets too")
check(ChatPaging.cursorValue("garbage") == nil, "garbage gives no cursor")
check(ChatPaging.cursorValue("") == nil, "empty gives no cursor")
check(!(ChatPaging.cursorValue("2026-11-09T15:55:12.123456+00:00") ?? "+").contains("+"), "no '+' survives")

// --- is there more history? ---
check(ChatPaging.hasMoreOlder(fetched: 50, pageSize: 50, newlyAdded: nil), "a full first page may have older messages")
check(!ChatPaging.hasMoreOlder(fetched: 49, pageSize: 50, newlyAdded: nil), "a short page is the beginning of the chat")
check(!ChatPaging.hasMoreOlder(fetched: 0, pageSize: 50, newlyAdded: nil), "an empty chat")
check(ChatPaging.hasMoreOlder(fetched: 50, pageSize: 50, newlyAdded: 49), "a full older page that added rows keeps going")
check(!ChatPaging.hasMoreOlder(fetched: 50, pageSize: 50, newlyAdded: 0), "a full page that added nothing cannot make progress, stop")
check(!ChatPaging.hasMoreOlder(fetched: 20, pageSize: 50, newlyAdded: 20), "a short older page is the beginning")

// --- direct room pick (same rules as web/src/lib/chat-access.ts) ---
typealias D = ChatPaging.DirectCandidate
let me = "11111111-1111-4111-8111-111111111111"
let other = "22222222-2222-4222-8222-222222222222"
let third = "33333333-3333-4333-8333-333333333333"
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [me, other])], me: me, other: other) == "d1", "the direct room of the two")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [other, me])], me: me, other: other) == "d1", "member order does not matter")
check(ChatPaging.pickDirectConversation([D(id: "g1", type: "group", memberIds: [me, other, third])], me: me, other: other) == nil, "a shared group is never a direct chat")
check(ChatPaging.pickDirectConversation([D(id: "g1", type: "group", memberIds: [me, other])], me: me, other: other) == nil, "a two-person GROUP is still a group")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [me, other, third])], me: me, other: other) == nil, "a direct-typed room with a third member is not a direct chat")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [me, third])], me: me, other: other) == nil, "wrong pair")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [other])], me: me, other: other) == nil, "I am not a member")
check(ChatPaging.pickDirectConversation([D(id: "g1", type: "group", memberIds: [me, other]), D(id: "d2", type: "direct", memberIds: [me, other]), D(id: "d3", type: "direct", memberIds: [me, other])], me: me, other: other) == "d2", "first suitable room in the given order")
check(ChatPaging.pickDirectConversation([], me: me, other: other) == nil, "no rooms")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [me])], me: me, other: me) == nil, "chatting with myself is not a direct room")
check(ChatPaging.pickDirectConversation([D(id: "d1", type: "direct", memberIds: [me.uppercased(), other])], me: me, other: other.uppercased()) == "d1", "uuid case does not matter")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: chat paging (merge/order, cursor, has-more, direct-room pick)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
