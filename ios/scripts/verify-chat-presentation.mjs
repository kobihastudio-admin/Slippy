import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const presentation = new URL('../Slippy/Utils/ChatPresentation.swift', import.meta.url).pathname;
assert(readFileSync(presentation, 'utf8').includes('enum ChatPresentation'), 'ChatPresentation.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-chat-presentation-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) {
    if !ok { failures += 1; print("FAIL: \\(message)") }
}
func eq(_ actual: String, _ expected: String, _ message: String) {
    check(actual == expected, "\\(message): expected [\\(expected)] got [\\(actual)]")
}

var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "Asia/Bangkok")!
var buddhist = Calendar(identifier: .buddhist)
buddhist.timeZone = TimeZone(identifier: "Asia/Bangkok")!

func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ mi: Int, calendar: Calendar = cal) -> Date {
    calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: mi))!
}
// Monday 9 Nov 2026, 12:00 Bangkok
let now = at(2026, 11, 9, 12, 0)

// --- timestamp parsing: every server shape gives the same instant ---
let shapes = [
    "2026-11-09T05:30:00.123456+00:00",
    "2026-11-09T05:30:00.123+00:00",
    "2026-11-09T05:30:00+00:00",
    "2026-11-09T05:30:00Z",
    "2026-11-09T12:30:00.5+07:00",
]
for shape in shapes {
    guard let parsed = ChatPresentation.parseISO(shape) else { check(false, "parse failed: \\(shape)"); continue }
    eq(ChatPresentation.timeLabel(parsed, calendar: cal), "12:30", "time of \\(shape)")
}
check(ChatPresentation.parseISO("") == nil, "empty string must not parse")
check(ChatPresentation.parseISO("not a date") == nil, "garbage must not parse")

// --- list time label ---
func list(_ iso: String, calendar: Calendar = cal) -> String { ChatPresentation.listTimeLabel(iso, now: now, calendar: calendar) }
eq(list("2026-11-09T05:30:00.123456+00:00"), "12:30", "same day -> HH:mm")
eq(list("2026-11-08T17:30:00+00:00"), "00:30", "UTC yesterday evening is Bangkok today 00:30")
eq(list("2026-11-08T16:59:00+00:00"), "เมื่อวาน", "23:59 Bangkok yesterday")
eq(list("2026-11-07T05:00:00Z"), "ส.", "2 days ago Saturday")
eq(list("2026-11-06T05:00:00Z"), "ศ.", "3 days ago Friday")
eq(list("2026-11-05T05:00:00Z"), "พฤ.", "4 days ago Thursday")
eq(list("2026-11-04T05:00:00Z"), "พ.", "5 days ago Wednesday")
eq(list("2026-11-03T05:00:00Z"), "อ.", "6 days ago Tuesday")
eq(list("2026-11-02T05:00:00Z"), "2/11", "7 days ago -> d/M")
eq(list("2025-12-31T05:00:00Z"), "31/12/25", "other year -> d/M/yy")
eq(list("2026-01-01T05:00:00Z"), "1/1", "same year, January")
eq(list("2026-11-10T05:00:00Z"), "12:00", "future (clock skew) -> HH:mm, never negative")
eq(list("garbage"), "", "unparseable -> empty")
eq(list("2025-12-31T05:00:00Z", calendar: buddhist), "31/12/25", "Buddhist device calendar still prints Gregorian yy")
eq(list("2026-11-02T05:00:00Z", calendar: buddhist), "2/11", "Buddhist device calendar, same year")
// midnight boundary: 2 minutes apart but a different calendar day
let justAfterMidnight = at(2026, 11, 9, 0, 1)
eq(ChatPresentation.listTimeLabel("2026-11-08T16:59:00Z", now: justAfterMidnight, calendar: cal), "เมื่อวาน", "23:59 vs 00:01 next day")
eq(ChatPresentation.listTimeLabel("2026-11-08T17:00:00Z", now: justAfterMidnight, calendar: cal), "00:00", "exactly midnight is today")

// --- day chips ---
eq(ChatPresentation.dayChipLabel(at(2026, 11, 9, 8, 0), now: now, calendar: cal), "วันนี้", "chip today")
eq(ChatPresentation.dayChipLabel(at(2026, 11, 8, 23, 59), now: now, calendar: cal), "เมื่อวาน", "chip yesterday")
eq(ChatPresentation.dayChipLabel(at(2026, 11, 2, 9, 0), now: now, calendar: cal), "2/11", "chip older same year")
eq(ChatPresentation.dayChipLabel(at(2025, 3, 5, 9, 0), now: now, calendar: cal), "5/3/25", "chip other year")

// --- message layout: day chips and avatar runs ---
let me = "me", friend = "friend"
let items: [(senderId: String, date: Date?)] = [
    (friend, at(2026, 11, 8, 20, 0)),   // 0 first ever -> chip + avatar
    (friend, at(2026, 11, 8, 20, 1)),   // 1 same run -> nothing
    (me,     at(2026, 11, 8, 20, 2)),   // 2 me -> never avatar
    (friend, at(2026, 11, 8, 20, 3)),   // 3 new friend run -> avatar
    (friend, at(2026, 11, 9, 9, 0)),    // 4 new day, same sender -> chip + avatar again
    (friend, nil),                      // 5 unparseable date: no chip, continues run
    (me,     at(2026, 11, 9, 9, 5)),    // 6 me, same day -> nothing
]
let layout = ChatPresentation.layouts(items: items, me: me, now: now, calendar: cal)
check(layout.count == items.count, "one layout per message")
check(layout[0] == .init(dayChip: "เมื่อวาน", showsAvatar: true), "layout[0] \\(layout[0])")
check(layout[1] == .init(dayChip: nil, showsAvatar: false), "layout[1] \\(layout[1])")
check(layout[2] == .init(dayChip: nil, showsAvatar: false), "layout[2] \\(layout[2])")
check(layout[3] == .init(dayChip: nil, showsAvatar: true), "layout[3] \\(layout[3])")
check(layout[4] == .init(dayChip: "วันนี้", showsAvatar: true), "layout[4] \\(layout[4])")
check(layout[5] == .init(dayChip: nil, showsAvatar: false), "layout[5] \\(layout[5])")
check(layout[6] == .init(dayChip: nil, showsAvatar: false), "layout[6] \\(layout[6])")
check(ChatPresentation.layouts(items: [], me: me, now: now, calendar: cal).isEmpty, "empty input")

// --- avatar initials ---
eq(ChatPresentation.initial(for: "เอ"), "อ", "leading เ is skipped")
eq(ChatPresentation.initial(for: "แมว"), "ม", "leading แ is skipped")
eq(ChatPresentation.initial(for: "โอ๊ต"), "อ", "leading โ is skipped")
eq(ChatPresentation.initial(for: "ไก่"), "ก", "leading ไ is skipped")
eq(ChatPresentation.initial(for: "ใจ"), "จ", "leading ใ is skipped")
eq(ChatPresentation.initial(for: "พลอย"), "พ", "plain Thai")
eq(ChatPresentation.initial(for: "  bob"), "B", "leading spaces, lowercase latin")
eq(ChatPresentation.initial(for: "John Doe"), "J", "latin")
eq(ChatPresentation.initial(for: "👍 ploy"), "P", "emoji skipped, next letter used")
eq(ChatPresentation.initial(for: "👍"), "?", "emoji only")
eq(ChatPresentation.initial(for: "เ"), "?", "only a prefix vowel")
eq(ChatPresentation.initial(for: "   "), "?", "blank")
eq(ChatPresentation.initial(for: ""), "?", "empty")

// --- last-message preview ---
eq(ChatPresentation.previewText(type: "image", body: nil), "📷 รูปภาพ", "image")
eq(ChatPresentation.previewText(type: "video", body: "x"), "🎬 วิดีโอ", "video")
eq(ChatPresentation.previewText(type: "file", body: nil), "📎 ไฟล์แนบ", "file")
eq(ChatPresentation.previewText(type: "text", body: "สวัสดี"), "สวัสดี", "text")
eq(ChatPresentation.previewText(type: "text", body: "  \\n "), "เริ่มสนทนา...", "blank text")
eq(ChatPresentation.previewText(type: nil, body: nil), "เริ่มสนทนา...", "no message yet")

// --- local filter ---
check(ChatPresentation.matches(query: "", name: "พลอย", lastMessage: nil), "empty query matches all")
check(ChatPresentation.matches(query: "   ", name: "พลอย", lastMessage: nil), "blank query matches all")
check(ChatPresentation.matches(query: "ploy", name: "Ploy", lastMessage: nil), "case-insensitive name")
check(ChatPresentation.matches(query: "พลอ", name: "พลอย", lastMessage: nil), "thai prefix of name")
check(ChatPresentation.matches(query: "เจอกัน", name: "พลอย", lastMessage: "20:00 เจอกัน 👍"), "last message match")
check(!ChatPresentation.matches(query: "zzz", name: "พลอย", lastMessage: "hi"), "no match")
check(!ChatPresentation.matches(query: "zzz", name: "พลอย", lastMessage: nil), "no match, no message")

// --- draft retention ---
eq(ChatPresentation.draftAfterSend(current: "hello", sent: "hello", succeeded: true), "", "success clears")
eq(ChatPresentation.draftAfterSend(current: "hello", sent: "hello", succeeded: false), "hello", "failure keeps")
eq(ChatPresentation.draftAfterSend(current: "hello world", sent: "hello", succeeded: true), "world", "newer typing survives success and the sent part is not repeated")
eq(ChatPresentation.draftAfterSend(current: "hello", sent: "hello", succeeded: true), "", "unchanged field clears")
eq(ChatPresentation.draftAfterSend(current: "oh hello", sent: "hello", succeeded: true), "oh hello", "edited elsewhere: leave as is")
eq(ChatPresentation.draftAfterSend(current: "hello world", sent: "hello", succeeded: false), "hello world", "failure keeps everything")
eq(ChatPresentation.draftAfterSend(current: "", sent: "hello", succeeded: true), "", "emptied field stays empty")
eq(ChatPresentation.draftAfterSend(current: "edited", sent: "hello", succeeded: false), "edited", "failure never rewrites the field")

// --- opening a chat failed: Thai wording for what the RPC / network says ---
check(ChatPresentation.openChatFailureMessage("PostgrestError(message: not_friends)").contains("เพื่อน"), "not_friends -> must be friends")
check(ChatPresentation.openChatFailureMessage("not_authenticated").contains("เข้าสู่ระบบ"), "not signed in")
check(ChatPresentation.openChatFailureMessage("The Internet connection appears to be offline.").contains("อินเทอร์เน็ต"), "offline")
check(ChatPresentation.openChatFailureMessage("The request timed out.").contains("อินเทอร์เน็ต"), "timeout")
check(ChatPresentation.openChatFailureMessage("row-level security").hasPrefix("เปิดแชทไม่สำเร็จ"), "anything else: Thai prefix")
check(ChatPresentation.openChatFailureMessage("something odd").contains("something odd"), "the original text is not lost")
check(ChatPresentation.openChatFailureMessage("ต้องเป็นเพื่อนกัน") == "ต้องเป็นเพื่อนกัน", "an already Thai message is shown as it is")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: chat presentation (labels, parsing, layout, initials, filter, draft)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', presentation, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
