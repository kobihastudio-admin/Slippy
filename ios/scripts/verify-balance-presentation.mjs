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
eq(B.sentence(name: "พลอย", net: 0, hasBreakdown: true), "ยอดหักล้างกันพอดี", "net zero with a breakdown must not say 'no balance'")
eq(B.sentence(name: "พลอย", net: 450, hasBreakdown: true), "พลอย ค้างคุณ ฿450", "breakdown flag does not change a real balance")
eq(B.sentence(name: "พลอย", net: 0, hasBreakdown: false), "ยังไม่มียอดค้างกับ พลอย", "net zero, nothing listed")
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

// --- duplicate rows: one friend picked twice in the same bill -> one row, amounts added, unique ids ---
func dupEntry(_ amount: Double) -> B.Entry {
    B.Entry(counterpartUserId: "b1", direction: .theyOweMe, amount: amount, sourceKind: .bill, sourceId: "d1", title: "ซ้ำ", occurredAt: nil, attributed: true)
}
let dupSums = B.summaries([dupEntry(30), dupEntry(25.5)])["b1"]!
check(dupSums.entries.count == 1, "duplicate source rows merge into one, got \\(dupSums.entries.count)")
check(abs(dupSums.theyOweMe - 55.5) < 0.0001, "merged amount is the sum (55.50), got \\(dupSums.theyOweMe)")
check(Set(b.entries.map(\\.id)).count == b.entries.count, "entry ids are unique within a breakdown")

// --- empty ---
check(B.summaries([]).isEmpty, "no entries -> no summaries")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: balance presentation (money, wording, decoding, summaries, mirror)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
