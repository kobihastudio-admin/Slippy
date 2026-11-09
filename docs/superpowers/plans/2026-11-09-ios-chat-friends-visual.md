# iOS Chat and Add-Friend Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iOS chat list, 1:1 chat room and add-friend screen a LINE-like look (Slippy brand colors, Light and Dark), and keep a typed message until its send succeeds.

**Architecture:** All date/label/grouping/initial/filter/draft decisions live in one Foundation-only file (`ChatPresentation.swift`) that a host script compiles and tests with `swiftc`. SwiftUI views (`ChatAvatar`, the rewritten room, list and add-friend sheet) are thin layers over it. The search and request sections are extracted from `SocialView` into shared subviews so `SocialView` and the new sheet use identical code. A DEBUG-only fixture path (existing `SLIPPY_APPEARANCE_PREVIEW` mechanism) renders the three screens with synthetic data for simulator screenshots.

**Tech Stack:** Swift 5 / SwiftUI (iOS 17.0 deployment target), supabase-swift 2.48.0 (unchanged), xcodegen, `swiftc` host scripts under `ios/scripts`, `xcodebuild` + `simctl` for build and screenshots.

**Spec:** `docs/superpowers/specs/2026-11-09-ios-chat-friends-visual-design.md` (approved 2026-11-09; section 8 lists amendments found while planning — read it).

## Global Constraints

- Scope is iOS presentation plus one client-only behavior fix. No schema, RLS, security, provider, credential, web, deploy, signing or governance-repo changes.
- **No `git commit`, `git push`, merge or branch change.** Commit authority is a separate approval. Steps called "Checkpoint" only list changed files.
- Work in place at `/Users/chainimitsakhorn/Documents/Project/Slippy` (not a worktree: the preview mechanism in `SlippyApp.swift` is uncommitted work that a worktree would lack). The 48 pre-existing dirty files must stay byte-for-byte untouched except the single additive hunk in `ios/Slippy/App/SlippyApp.swift` (Task 8).
- Run host scripts with `PATH=/usr/local/bin:$PATH` (nvm node is x86_64 and fails with "Bad CPU type").
- New `.swift` files need `cd ios && xcodegen generate` (`Slippy.xcodeproj` is generated and gitignored).
- Bubble: corner radius 16, the corner nearest the sender is 4 (top-left friend, top-right me). Me = `Color.brand500` + white text; friend = `Color.surface`; screen = `Color.surfaceMuted`. Only adaptive palette colors, plus the existing LINE green `#06C755` on the LINE share button.
- Times are `HH:mm`, 24-hour, device timezone. Day chips: "วันนี้", "เมื่อวาน", else `d/M` (`d/M/yy` if not the current year, Gregorian). List weekday labels: `อา. จ. อ. พ. พฤ. ศ. ส.`
- Chat list title "แชท"; list avatar 44 pt; composer has only a text field and a send button.
- Failure text, exactly: `ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่`.
- Draft rule: clear the text only if the send succeeded **and** the field still equals the text that was sent.
- `MessagesViewModel.sendMessage` returns `true` once the message insert succeeded, even if the later `conversations.updated_at` touch fails (that failure is only recorded in `error`).
- No read receipts, unread badges, pin/mute/archive, attachments, stickers, voice, emoji picker, calls, email/Teams invite or contact import. No placeholder buttons.
- Existing decline (✕) and accept (✓) on friend requests are preserved exactly.
- Do not read or write real conversations/friends/requests while verifying; use fixtures only. Never enter credentials.

## Review Focus

1. Server timestamps arrive in several shapes (`…:30.123456+00:00` with microseconds, `…:30+00:00` / `…:30Z` without fraction, `+07:00` offsets): every one must parse and show the correct Bangkok-local time, and garbage must give an empty label, not a crash. → Task 1 tests.
2. A Thai-region device may use the Buddhist calendar: an older date must still read Gregorian (`31/12/25`, not `31/12/68`), and the same-year check must not misfire. → Task 1 tests.
3. The user keeps typing while a send is in flight: the newer text must survive a successful send; a failed send must keep the text and show the error; a double tap must not produce a false error. → Task 1 (`draftAfterSend`) and Task 4 (`submitting` guard).
4. Names that start with a Thai prefix vowel (เ แ โ ใ ไ), an emoji, only symbols, or nothing must still yield a sensible initial or `?`. → Task 1 tests.
5. `FriendChatRoomView` is also the trip chat (group, own title) in `JourneyPrototypeView`: it must still compile, keep its title, show no avatar slot, and must not show the previous conversation's messages for a moment. → Task 4 build + review.

---

## Preflight (do once, before Task 1)

- [ ] **Step 1: Confirm target files are clean and nothing else moved**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short ios/Slippy/Views/Chat ios/Slippy/Views/Social ios/Slippy/ViewModels/MessagesViewModel.swift ios/Slippy/ViewModels/SocialViewModel.swift ios/Slippy/Utils ios/Slippy/Models/MessageModels.swift
git status --short | wc -l
```

Expected: first command prints nothing; second prints `50` (48 earlier dirty entries + the spec + this plan). If the first command prints anything, stop and report `CHECKPOINT_DRIFT`; do not overwrite.

- [ ] **Step 2: Baseline build before touching code** (the Trip contract says a full app build has not been proven, so know the starting state)

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
xcodegen generate
./scripts/build-simulator.sh > /private/tmp/slippy-chat-baseline-build.log 2>&1; echo "exit=$?"
tail -5 /private/tmp/slippy-chat-baseline-build.log
```

Expected: `exit=0` and `** BUILD SUCCEEDED **`. If it fails for reasons in files this plan does not touch, stop and report the exact error to the user instead of working around it — later "build succeeds" claims would be meaningless.

---

### Task 1: ChatPresentation (pure logic) + host verification

**Files:**
- Create: `ios/Slippy/Utils/ChatPresentation.swift`
- Create: `ios/scripts/verify-chat-presentation.mjs`

**Interfaces:**
- Consumes: nothing (Foundation only).
- Produces (all `static` on `enum ChatPresentation`):
  - `parseISO(_ raw: String) -> Date?`
  - `timeLabel(_ date: Date, calendar: Calendar = .current) -> String` — `"HH:mm"`
  - `dayDifference(from date: Date, to now: Date, calendar: Calendar = .current) -> Int`
  - `isSameDay(_ a: Date, _ b: Date, calendar: Calendar = .current) -> Bool`
  - `dateLabel(_ date: Date, now: Date, calendar: Calendar = .current) -> String` — `d/M` or `d/M/yy`, Gregorian
  - `listTimeLabel(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String`
  - `dayChipLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String`
  - `struct MessageLayout: Equatable { let dayChip: String?; let showsAvatar: Bool }`
  - `layouts(items: [(senderId: String, date: Date?)], me: String, now: Date = Date(), calendar: Calendar = .current) -> [MessageLayout]`
  - `initial(for name: String) -> String`
  - `previewText(type: String?, body: String?) -> String`
  - `matches(query: String, name: String, lastMessage: String?) -> Bool`
  - `draftAfterSend(current: String, sent: String, succeeded: Bool) -> String`

Reference calendar for the tests: Nov 9 2026 is a **Monday**; Nov 8 Sunday, Nov 7 Saturday, … Nov 2 Monday.

- [ ] **Step 1: Write the failing host script**

Create `ios/scripts/verify-chat-presentation.mjs`:

```js
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
eq(ChatPresentation.draftAfterSend(current: "hello world", sent: "hello", succeeded: true), "hello world", "newer typing survives success")
eq(ChatPresentation.draftAfterSend(current: "", sent: "hello", succeeded: true), "", "emptied field stays empty")
eq(ChatPresentation.draftAfterSend(current: "edited", sent: "hello", succeeded: false), "edited", "failure never rewrites the field")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: chat presentation (labels, parsing, layout, initials, filter, draft)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', presentation, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-chat-presentation.mjs
```

Expected: FAIL with an assertion `ChatPresentation.swift is missing` (file not created yet).

- [ ] **Step 3: Implement `ChatPresentation.swift`**

Create `ios/Slippy/Utils/ChatPresentation.swift`:

```swift
import Foundation

/// Pure presentation decisions for the chat list, chat room and add-friend
/// screens. Foundation only, so `ios/scripts/verify-chat-presentation.mjs` can
/// compile this file on its own with `swiftc`.
enum ChatPresentation {

    // MARK: – Timestamps

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Parses the timestamp shapes Supabase returns: with or without
    /// fractional seconds (Postgres may send 6 digits), `Z` or `±hh:mm`.
    static func parseISO(_ raw: String) -> Date? {
        if let date = isoWithFraction.date(from: raw) { return date }
        if let date = isoPlain.date(from: raw) { return date }
        // Last resort: drop the fraction and parse at second precision.
        if let range = raw.range(of: #"\.\d+"#, options: .regularExpression) {
            var stripped = raw
            stripped.removeSubrange(range)
            return isoPlain.date(from: stripped)
        }
        return nil
    }

    /// `HH:mm`, 24-hour, in the calendar's timezone.
    static func timeLabel(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// Whole calendar days from `date` to `now` (0 = same day, 1 = yesterday).
    /// Negative when `date` is in the future (clock skew).
    static func dayDifference(from date: Date, to now: Date, calendar: Calendar = .current) -> Int {
        let start = calendar.startOfDay(for: date)
        let end = calendar.startOfDay(for: now)
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }

    static func isSameDay(_ a: Date, _ b: Date, calendar: Calendar = .current) -> Bool {
        calendar.isDate(a, inSameDayAs: b)
    }

    /// `d/M`, or `d/M/yy` when the year differs from `now`'s. Always Gregorian,
    /// even when the device calendar is Buddhist.
    static func dateLabel(_ date: Date, now: Date, calendar: Calendar = .current) -> String {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        let parts = gregorian.dateComponents([.year, .month, .day], from: date)
        let nowYear = gregorian.component(.year, from: now)
        let year = parts.year ?? nowYear
        let base = "\(parts.day ?? 1)/\(parts.month ?? 1)"
        return year == nowYear ? base : base + "/" + String(format: "%02d", year % 100)
    }

    private static let weekdayNames = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."]

    /// Right-hand time on a chat-list row.
    static func listTimeLabel(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date = parseISO(iso) else { return "" }
        switch dayDifference(from: date, to: now, calendar: calendar) {
        case ...0:
            return timeLabel(date, calendar: calendar)
        case 1:
            return "เมื่อวาน"
        case 2...6:
            return weekdayNames[calendar.component(.weekday, from: date) - 1]
        default:
            return dateLabel(date, now: now, calendar: calendar)
        }
    }

    /// Centered chip between days in the chat room.
    static func dayChipLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        switch dayDifference(from: date, to: now, calendar: calendar) {
        case ...0: return "วันนี้"
        case 1:    return "เมื่อวาน"
        default:   return dateLabel(date, now: now, calendar: calendar)
        }
    }

    // MARK: – Chat room layout

    struct MessageLayout: Equatable {
        /// Non-nil when a day chip is drawn above this message.
        let dayChip: String?
        /// True for the first message of each run from someone other than `me`.
        let showsAvatar: Bool
    }

    /// One entry per message, in order. A new day always starts a new run.
    /// A message with an unparseable date never produces a chip.
    static func layouts(
        items: [(senderId: String, date: Date?)],
        me: String,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [MessageLayout] {
        var result: [MessageLayout] = []
        var previousSender: String?
        var previousDate: Date?
        for item in items {
            var chip: String?
            if let date = item.date {
                if let previous = previousDate, isSameDay(previous, date, calendar: calendar) {
                    // same day: no chip
                } else {
                    chip = dayChipLabel(date, now: now, calendar: calendar)
                }
                previousDate = date
            }
            let startsRun = previousSender != item.senderId || chip != nil
            result.append(MessageLayout(dayChip: chip, showsAvatar: item.senderId != me && startsRun))
            previousSender = item.senderId
        }
        return result
    }

    // MARK: – Avatars, previews, filtering

    /// First letter of `name`, skipping Thai prefix vowels (เ แ โ ใ ไ) and
    /// anything that is not a letter. `?` when nothing qualifies.
    static func initial(for name: String) -> String {
        for scalar in name.unicodeScalars {
            if (0x0E40...0x0E44).contains(scalar.value) { continue }
            switch scalar.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
                return String(scalar).uppercased()
            default:
                continue
            }
        }
        return "?"
    }

    /// One-line text for a conversation's last message (also used by the filter).
    static func previewText(type: String?, body: String?) -> String {
        switch type {
        case "image": return "📷 รูปภาพ"
        case "video": return "🎬 วิดีโอ"
        case "file":  return "📎 ไฟล์แนบ"
        default:
            let text = body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return text.isEmpty ? "เริ่มสนทนา..." : text
        }
    }

    /// Local chat-list search: case-insensitive "contains" on name or last message.
    static func matches(query: String, name: String, lastMessage: String?) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if needle.isEmpty { return true }
        if name.localizedCaseInsensitiveContains(needle) { return true }
        return lastMessage?.localizedCaseInsensitiveContains(needle) ?? false
    }

    // MARK: – Draft retention

    /// What the composer should contain after a send attempt finished.
    /// Clear only when the send succeeded AND the user has not typed anything
    /// new since; otherwise leave the field exactly as it is.
    static func draftAfterSend(current: String, sent: String, succeeded: Bool) -> String {
        succeeded && current == sent ? "" : current
    }
}
```

- [ ] **Step 4: Run the script and confirm it passes**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-chat-presentation.mjs
```

Expected: `PASS: chat presentation (labels, parsing, layout, initials, filter, draft)`. If a `FAIL:` line appears, fix `ChatPresentation.swift` (not the expectation) unless the expectation contradicts the spec's rules in Global Constraints. In particular if the 6-digit microsecond shape fails in `parseISO`, the regex fallback must make it pass; do not delete that shape from the test.

- [ ] **Step 5: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short ios/Slippy/Utils/ChatPresentation.swift ios/scripts/verify-chat-presentation.mjs
```

Expected: two `??` lines.

---

### Task 2: `sendMessage` returns success + DEBUG fixture guard + contract check

**Files:**
- Modify: `ios/Slippy/ViewModels/MessagesViewModel.swift` (properties near line 16; `loadConversations` line 22; `loadMessages` line 161; `sendMessage` lines 176-207)
- Create: `ios/scripts/verify-chat-send-contract.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `@discardableResult func sendMessage(conversationId: String, senderId: String, body: String) async -> Bool`
  - DEBUG-only stored property `var isFixture = false` on `MessagesViewModel` (when true: `loadConversations`/`loadMessages` return immediately; `sendMessage` returns `false` after setting `error`).

- [ ] **Step 1: Write the failing contract check**

Create `ios/scripts/verify-chat-send-contract.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../Slippy/ViewModels/MessagesViewModel.swift', import.meta.url), 'utf8');
const start = source.indexOf('func sendMessage(');
assert(start >= 0, 'sendMessage is missing');

const declaration = source.slice(Math.max(0, start - 40), source.indexOf('{', start));
assert(declaration.includes('@discardableResult'), 'sendMessage must be @discardableResult');
assert(/async\s*->\s*Bool/.test(declaration), 'sendMessage must return Bool');

const body = source.slice(start);
const marker = '// MESSAGE STORED:';
const markerAt = body.indexOf(marker);
assert(markerAt > 0, `missing "${marker}" marker separating insert from the best-effort touch`);

const beforeStored = body.slice(0, markerAt);
const afterStored = body.slice(markerAt, body.indexOf('\n    }\n', markerAt) === -1 ? undefined : body.indexOf('\n    }\n', markerAt));

const falseReturns = (beforeStored.match(/return false/g) || []).length;
assert(falseReturns >= 2, `expected guard + insert-failure "return false" before the marker, found ${falseReturns}`);
assert(!/return false/.test(afterStored), 'a failure AFTER the message is stored must not return false (it would restore the draft and duplicate the message)');
assert(/return true/.test(afterStored), 'sendMessage must return true once the message is stored');
assert(/self\.error\s*=/.test(afterStored), 'a touch failure must still be recorded in error');

const fixtureGuards = (source.match(/isFixture/g) || []).length;
assert(fixtureGuards >= 4, `isFixture must be declared and guard load/load/send (found ${fixtureGuards} mentions)`);
assert(/#if DEBUG[\s\S]*var isFixture/.test(source), 'isFixture must be DEBUG-only');

console.log('PASS: chat send contract (Bool result, touch failure keeps success, DEBUG-only fixture guard)');
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-chat-send-contract.mjs
```

Expected: FAIL `sendMessage must be @discardableResult`.

- [ ] **Step 3: Add the DEBUG flag**

In `MessagesViewModel.swift`, after `@Published var error: String?` (line 16) insert:

```swift

    #if DEBUG
    /// Synthetic-data mode for simulator screenshots: no network reads or writes.
    var isFixture = false
    #endif
```

- [ ] **Step 4: Guard `loadConversations` and `loadMessages`**

In `loadConversations(myId:)` make the first line of the function body:

```swift
        #if DEBUG
        if isFixture { return }
        #endif
```

(before `isLoading = true`). In `loadMessages(conversationId:)` make the first line of the body:

```swift
        #if DEBUG
        if isFixture { return }
        #endif
```

- [ ] **Step 5: Replace `sendMessage`**

Replace the whole `func sendMessage(...)` (current lines 176-207) with:

```swift
    /// Returns `true` once the message is stored, `false` if it was not sent
    /// (blank text, a send already in flight, or the insert failed). The
    /// caller keeps the typed text on `false`.
    @discardableResult
    func sendMessage(conversationId: String, senderId: String, body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return false }
        isSending = true
        defer { isSending = false }

        #if DEBUG
        if isFixture {
            error = "fixture: sending is disabled"
            return false
        }
        #endif

        struct MsgInsert: Encodable {
            let conversation_id: String
            let sender_id: String
            let body: String
            let msg_type: String
        }
        do {
            let inserted: [FriendMessage] = try await db
                .from("messages")
                .insert(MsgInsert(conversation_id: conversationId, sender_id: senderId, body: trimmed, msg_type: "text"))
                .select("id, conversation_id, sender_id, body, msg_type, attachment_url, created_at")
                .execute()
                .value
            if let msg = inserted.first { messages.append(msg) }
        } catch {
            self.error = error.localizedDescription
            return false
        }

        // MESSAGE STORED: everything below is best-effort. A failure here must
        // not make the caller restore the draft, or the message is sent twice.
        do {
            struct TouchPatch: Encodable { let updated_at: String }
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try await db.from("conversations")
                .update(TouchPatch(updated_at: iso.string(from: Date())))
                .eq("id", value: conversationId)
                .execute()
        } catch {
            self.error = error.localizedDescription
        }
        return true
    }
```

- [ ] **Step 6: Run the contract check**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-chat-send-contract.mjs
```

Expected: `PASS: chat send contract …`. (Compilation of the Swift is checked by the build in Task 4; the room view is the only caller that cares about the result, and `@discardableResult` keeps `JourneyPrototypeView` and any other caller compiling.)

- [ ] **Step 7: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/ViewModels/MessagesViewModel.swift
```

Expected: only `MessagesViewModel.swift` changed, a few dozen lines.

---

### Task 3: `ChatAvatar`

**Files:**
- Create: `ios/Slippy/Views/Chat/ChatAvatar.swift`

**Interfaces:**
- Consumes: `ChatPresentation.initial(for:)` (Task 1); `Color.brand50`, `Color.accent`.
- Produces: `struct ChatAvatar: View` with memberwise init `ChatAvatar(name: String, url: String?, size: CGFloat = 44)`. Decorative (hidden from VoiceOver; callers label their rows).

- [ ] **Step 1: Create the view**

```swift
import SwiftUI

/// Round avatar for the chat list, chat room, friend picker and add-friend
/// screens: remote image when there is one, otherwise the name's initial.
struct ChatAvatar: View {
    let name: String
    let url: String?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Color.brand50)
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        initialView
                    }
                }
            } else {
                initialView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initialView: some View {
        Text(ChatPresentation.initial(for: name))
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundColor(Color.accent)
    }
}
```

- [ ] **Step 2: Checkpoint (no commit)** — it is compiled together with Task 4's build.

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short ios/Slippy/Views/Chat/ChatAvatar.swift
```

Expected: `?? ios/Slippy/Views/Chat/ChatAvatar.swift`.

---

### Task 4: Chat room (`FriendChatRoomView`) redesign + draft retention

**Files:**
- Modify (full rewrite): `ios/Slippy/Views/Chat/FriendChatRoomView.swift`

**Interfaces:**
- Consumes: `ChatPresentation.{layouts, parseISO, timeLabel, previewText, draftAfterSend, MessageLayout}`, `ChatAvatar`, `MessagesViewModel.sendMessage -> Bool`, `Color.errorText`.
- Produces: `FriendChatRoomView(vm:conversationId:currentUserId:friendName:friendAvatarUrl:showsAvatars:)` — the last three have defaults `nil`, `nil`, `false`, so `JourneyPrototypeView.swift:1506` (`FriendChatRoomView(vm:conversationId:currentUserId:)`) compiles unchanged.

- [ ] **Step 1: Replace the file**

```swift
import SwiftUI

/// Chat room for "แชทกับเพื่อน" (and the trip chat, which reuses it). No
/// realtime yet — polls on a short timer while the view is open, same tradeoff
/// DashboardView/SplitView make elsewhere in this app.
struct FriendChatRoomView: View {
    @ObservedObject var vm: MessagesViewModel
    let conversationId: String
    let currentUserId: String
    /// Set by the chat list for 1:1 chats. `nil` for other callers (the trip
    /// chat), which keep their own navigation title.
    var friendName: String? = nil
    var friendAvatarUrl: String? = nil
    /// Show the sender's avatar next to a run of messages. Only meaningful for 1:1 chats.
    var showsAvatars = false

    @State private var input = ""
    @State private var sendFailed = false
    @State private var submitting = false
    @FocusState private var inputFocused: Bool
    private let refreshTimer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    private struct Row: Identifiable {
        let message: FriendMessage
        let layout: ChatPresentation.MessageLayout
        let time: String
        var id: String { message.id }
    }

    private var rows: [Row] {
        let dates = vm.messages.map { ChatPresentation.parseISO($0.createdAt) }
        let layouts = ChatPresentation.layouts(
            items: zip(vm.messages, dates).map { (senderId: $0.0.senderId, date: $0.1) },
            me: currentUserId)
        return zip(zip(vm.messages, dates), layouts).map { pair, layout in
            Row(message: pair.0, layout: layout, time: pair.1.map { ChatPresentation.timeLabel($0) } ?? "")
        }
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !submitting && !vm.isSending
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(rows) { row in
                            ChatMessageRow(
                                message: row.message,
                                layout: row.layout,
                                time: row.time,
                                isMe: row.message.senderId == currentUserId,
                                friendName: friendName ?? "",
                                friendAvatarUrl: friendAvatarUrl,
                                showsAvatars: showsAvatars)
                            .id(row.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: vm.messages) { _, _ in
                    guard let last = vm.messages.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }

            composer
        }
        .background(Color.surfaceMuted.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .modifier(OptionalNavigationTitle(title: friendName))
        .task {
            // Never flash the previously opened conversation's messages.
            if let first = vm.messages.first, first.conversationId != conversationId { vm.messages = [] }
            await vm.loadMessages(conversationId: conversationId)
        }
        .onReceive(refreshTimer) { _ in
            Task { await vm.loadMessages(conversationId: conversationId) }
        }
        .onChange(of: input) { _, _ in
            if sendFailed { sendFailed = false }
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if sendFailed {
                Text("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.errorText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("พิมพ์ข้อความ...", text: $input, axis: .vertical)
                    .focused($inputFocused)
                    .font(.system(size: 15))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Color.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .lineLimit(1...4)

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(canSend ? Color.brand500 : Color.border)
                }
                .disabled(!canSend)
                .accessibilityLabel("ส่งข้อความ")
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
        .background(Color.surface)
    }

    private func send() {
        guard canSend else { return }
        let sent = input
        submitting = true
        sendFailed = false
        Task {
            let succeeded = await vm.sendMessage(conversationId: conversationId, senderId: currentUserId, body: sent)
            input = ChatPresentation.draftAfterSend(current: input, sent: sent, succeeded: succeeded)
            sendFailed = !succeeded
            submitting = false
        }
    }
}

/// Applies a navigation title only when one is provided, so a caller's own
/// `.navigationTitle` (the trip chat) is never overridden by an empty one.
private struct OptionalNavigationTitle: ViewModifier {
    let title: String?
    func body(content: Content) -> some View {
        if let title { content.navigationTitle(title) } else { content }
    }
}

private struct ChatMessageRow: View {
    let message: FriendMessage
    let layout: ChatPresentation.MessageLayout
    let time: String
    let isMe: Bool
    let friendName: String
    let friendAvatarUrl: String?
    let showsAvatars: Bool

    private var text: String { ChatPresentation.previewText(type: message.msgType, body: message.body) }

    var body: some View {
        VStack(spacing: 8) {
            if let chip = layout.dayChip { DayChip(text: chip).padding(.top, 6) }
            if isMe {
                HStack(alignment: .bottom, spacing: 5) {
                    Spacer(minLength: 48)
                    timeText
                    bubble
                }
            } else {
                HStack(alignment: .top, spacing: 6) {
                    avatarSlot
                    HStack(alignment: .bottom, spacing: 5) {
                        bubble
                        timeText
                    }
                    Spacer(minLength: 24)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(layout.dayChip.map { $0 + ", " } ?? "")\(isMe ? "ฉัน" : friendName), \(text), \(time)")
    }

    @ViewBuilder private var avatarSlot: some View {
        if showsAvatars {
            if layout.showsAvatar {
                ChatAvatar(name: friendName, url: friendAvatarUrl, size: 32)
            } else {
                Color.clear.frame(width: 32, height: 32)
            }
        }
    }

    private var timeText: some View {
        Text(time)
            .font(.system(size: 10))
            .foregroundColor(Color.textSecondary)
    }

    private var bubble: some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundColor(isMe ? .white : Color.textPrimary)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(isMe ? Color.brand500 : Color.surface)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: isMe ? 16 : 4,
                bottomLeadingRadius: 16,
                bottomTrailingRadius: 16,
                topTrailingRadius: isMe ? 4 : 16))
    }
}

private struct DayChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 10).padding(.vertical, 3)
            .background(Color.black.opacity(0.55))
            .clipShape(Capsule())
    }
}
```

- [ ] **Step 2: Regenerate the project and build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
xcodegen generate
./scripts/build-simulator.sh > /private/tmp/slippy-chat-task4-build.log 2>&1; echo "exit=$?"
grep -E "error:|warning:.*(FriendChatRoomView|ChatAvatar|ChatPresentation|MessagesViewModel)" /private/tmp/slippy-chat-task4-build.log | head -20
tail -3 /private/tmp/slippy-chat-task4-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`, no error lines, no new warnings naming the touched files. This build also compiles `JourneyPrototypeView`'s unchanged call to `FriendChatRoomView` (Review Focus 5) and `ChatAvatar`. If `UnevenRoundedRectangle` or a generic-inference error appears, fix in this file only.

- [ ] **Step 3: Review the three behaviors by reading, not trusting the build**

Confirm in `FriendChatRoomView.swift`: (a) `input` is only assigned inside `send()` after `await` and only through `draftAfterSend`; (b) `submitting` is set before the `Task` starts and reset after; (c) `.navigationTitle` is applied only through `OptionalNavigationTitle`; (d) `showsAvatars` default is `false` so the trip chat has no avatar slot.

- [ ] **Step 4: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Chat/FriendChatRoomView.swift; git status --short ios/Slippy/Views/Trips/JourneyPrototypeView.swift
```

Expected: the room file changed; `JourneyPrototypeView.swift` shows whatever it showed before this plan (it is not edited here).

---

### Task 5: Chat list (`FriendChatListView`) + friend picker

**Files:**
- Modify (full rewrite): `ios/Slippy/Views/Chat/FriendChatListView.swift`

**Interfaces:**
- Consumes: `ChatAvatar`, `ChatPresentation.{matches, previewText, listTimeLabel}`, `FriendChatRoomView(vm:conversationId:currentUserId:friendName:friendAvatarUrl:showsAvatars:)`, `MessagesViewModel`, `SocialViewModel` (`friends`, `load(userId:)`).
- Produces: `FriendChatListView(viewModel: MessagesViewModel? = nil, socialViewModel: SocialViewModel? = nil)`. `DashboardView` calls `FriendChatListView()`, which still compiles.

- [ ] **Step 1: Replace the file**

```swift
import SwiftUI

/// "แชท" — flat LINE-style list of 1:1 conversations. Tapping a friend who has
/// no conversation yet creates one on the spot.
struct FriendChatListView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm: MessagesViewModel
    @StateObject private var socialVM: SocialViewModel
    @State private var showFriendPicker = false
    @State private var openConv: ConvId?
    @State private var query = ""

    private struct ConvId: Identifiable, Hashable { let id: String }

    /// The optional view models exist so Debug fixtures can inject synthetic
    /// data; production callers use `FriendChatListView()`.
    init(viewModel: MessagesViewModel? = nil, socialViewModel: SocialViewModel? = nil) {
        _vm = StateObject(wrappedValue: viewModel ?? MessagesViewModel())
        _socialVM = StateObject(wrappedValue: socialViewModel ?? SocialViewModel())
    }

    private var myId: String { authVM.session?.user.id.uuidString ?? "" }

    private var visibleConversations: [ChatConversation] {
        vm.conversations.filter {
            ChatPresentation.matches(
                query: query,
                name: $0.displayName,
                lastMessage: ChatPresentation.previewText(type: $0.lastMessageType, body: $0.lastMessageBody))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.surface.ignoresSafeArea()

                if vm.isLoading && vm.conversations.isEmpty {
                    ProgressView().tint(Color.brand500)
                } else if vm.conversations.isEmpty {
                    emptyState
                } else if visibleConversations.isEmpty {
                    noResults
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(visibleConversations) { conv in
                                Button {
                                    hapticLight()
                                    openConv = ConvId(id: conv.id)
                                } label: {
                                    ConversationRowView(conv: conv)
                                }
                                .buttonStyle(.plain)
                                Divider().padding(.leading, 72)
                            }
                        }
                    }
                }
            }
            .navigationTitle("แชท")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "ค้นหา")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { hapticLight(); showFriendPicker = true } label: {
                        Image(systemName: "square.and.pencil")
                            .foregroundColor(Color.brand500)
                    }
                    .accessibilityLabel("เริ่มแชทใหม่")
                }
            }
            .navigationDestination(item: $openConv) { conv in
                let info = vm.conversations.first { $0.id == conv.id }
                FriendChatRoomView(
                    vm: vm, conversationId: conv.id, currentUserId: myId,
                    friendName: info?.displayName,
                    friendAvatarUrl: info?.displayAvatarUrl,
                    showsAvatars: info?.type == "direct")
            }
            .sheet(isPresented: $showFriendPicker) {
                FriendPickerSheet(friends: socialVM.friends) { friend in
                    showFriendPicker = false
                    Task {
                        if let convId = await vm.getOrCreateDirectConversation(myId: myId, friendId: friend.id) {
                            await vm.loadConversations(myId: myId)
                            openConv = ConvId(id: convId)
                        }
                    }
                }
            }
            .task {
                guard !myId.isEmpty else { return }
                await vm.loadConversations(myId: myId)
                await socialVM.load(userId: myId)
            }
            .refreshable {
                guard !myId.isEmpty else { return }
                await vm.loadConversations(myId: myId)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "message")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color.brand300)
            Text("ยังไม่มีการสนทนา")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Color.textSecondary)
            Button { hapticLight(); showFriendPicker = true } label: {
                Text("เริ่มแชทกับเพื่อน")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.brand500)
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResults: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 34, weight: .light))
                .foregroundColor(Color.textSecondary.opacity(0.6))
            Text("ไม่พบ “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ConversationRowView: View {
    let conv: ChatConversation

    var body: some View {
        HStack(spacing: 12) {
            ChatAvatar(name: conv.displayName, url: conv.displayAvatarUrl, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(conv.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(ChatPresentation.listTimeLabel(conv.updatedAt))
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                }
                Text(ChatPresentation.previewText(type: conv.lastMessageType, body: conv.lastMessageBody))
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct FriendPickerSheet: View {
    let friends: [UserProfile]
    let onPick: (UserProfile) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(friends) { friend in
                Button { onPick(friend) } label: {
                    HStack(spacing: 12) {
                        ChatAvatar(name: friend.displayName, url: friend.avatarUrl, size: 44)
                        Text(friend.displayName)
                            .font(.system(size: 15))
                            .foregroundColor(Color.textPrimary)
                    }
                }
            }
            .listStyle(.plain)
            .overlay {
                if friends.isEmpty {
                    Text("ยังไม่มีเพื่อน — เพิ่มเพื่อนก่อนเริ่มแชทได้ที่แท็บโซเชียล")
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(32)
                }
            }
            .navigationTitle("เลือกเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
./scripts/build-simulator.sh > /private/tmp/slippy-chat-task5-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-chat-task5-build.log | head -20
tail -3 /private/tmp/slippy-chat-task5-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. (`DashboardView.swift:432` still calls `FriendChatListView()`.)

- [ ] **Step 3: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Chat/FriendChatListView.swift
```

---

### Task 6: Extract shared search/request subviews from `SocialView`

**Files:**
- Create: `ios/Slippy/Views/Social/FriendSearchAndRequests.swift`
- Modify: `ios/Slippy/Views/Social/SocialView.swift` (lines 110-120 usage; delete the three private properties at lines 133-275; rewrite `initialsView` at lines 428-439)

**Interfaces:**
- Consumes: `SocialViewModel` (`searchQuery`, `searchResults`, `pendingRequests`, `friends`, `searchUsers`, `sendFriendRequest`, `acceptRequest`, `removeFriend`, `load`), `hapticLight`, `hapticSuccess`.
- Produces (all internal, in the new file):
  - `FriendSearchBar(vm: SocialViewModel)`
  - `FriendSearchResults(vm: SocialViewModel, userId: String)`
  - `FriendRequestList(vm: SocialViewModel, userId: String, showsCount: Bool = false)`
  - `InitialsCircle(name: String, size: CGFloat = 40)`

This is code sharing only. Bodies are the existing `SocialView` code, moved verbatim except where noted.

- [ ] **Step 1: Create the shared file**

```swift
import SwiftUI

// Search field, search results and incoming friend requests. Shared by
// `SocialView` (friends tab) and `SocialAddFriendSheet`; the bodies are the
// code that used to live in `SocialView`, unchanged in behavior.

struct InitialsCircle: View {
    let name: String
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(Color.brand500.opacity(0.15))
            .frame(width: size, height: size)
            .overlay(
                Text(name.prefix(1).uppercased())
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(Color.brand500)
            )
    }
}

struct FriendSearchBar: View {
    @ObservedObject var vm: SocialViewModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(Color.textSecondary)
                .font(.system(size: 16))
            TextField("ค้นหาเพื่อนด้วยชื่อ", text: $vm.searchQuery)
                .foregroundColor(Color.textPrimary)
                .font(.system(size: 15))
                .onSubmit {
                    Task { await vm.searchUsers(query: vm.searchQuery) }
                }
                .onChange(of: vm.searchQuery) { _, newVal in
                    if newVal.isEmpty {
                        vm.searchResults = []
                    } else {
                        Task { await vm.searchUsers(query: newVal) }
                    }
                }
            if !vm.searchQuery.isEmpty {
                Button {
                    vm.searchQuery = ""
                    vm.searchResults = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Color.textSecondary)
                }
            }
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
    }
}

struct FriendSearchResults: View {
    @ObservedObject var vm: SocialViewModel
    let userId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ผลการค้นหา")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.searchResults) { user in
                HStack(spacing: 12) {
                    InitialsCircle(name: user.displayName)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                        Text(user.email)
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                    }
                    Spacer()
                    // Don't show "add" button for self or existing friends
                    if user.id != userId && !vm.friends.contains(where: { $0.id == user.id }) {
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.sendFriendRequest(fromUserId: userId, toUserId: user.id)
                                hapticSuccess()
                                vm.searchQuery = ""
                                vm.searchResults = []
                            }
                        } label: {
                            Text("เพิ่มเพื่อน")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(Color.brand500)
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(12)
                .background(Color.surface)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
            }
        }
    }
}

struct FriendRequestList: View {
    @ObservedObject var vm: SocialViewModel
    let userId: String
    /// The add-friend sheet shows "คำขอเป็นเพื่อน (n)"; the Social tab keeps its plain header.
    var showsCount = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(showsCount ? "คำขอเป็นเพื่อน (\(vm.pendingRequests.count))" : "คำขอเป็นเพื่อน")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.pendingRequests) { request in
                let name = request.friend?.displayName ?? "ผู้ใช้"
                HStack(spacing: 12) {
                    InitialsCircle(name: name)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(name) ส่งคำขอเป็นเพื่อน")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        if let email = request.friend?.email {
                            Text(email)
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                        }
                    }
                    Spacer()
                    HStack(spacing: 8) {
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.acceptRequest(friendshipId: request.id)
                                hapticSuccess()
                                await vm.load(userId: userId)
                            }
                        } label: {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Color.brand500)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("ยอมรับคำขอจาก \(name)")
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.removeFriend(friendshipId: request.id)
                                await vm.load(userId: userId)
                            }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                                .frame(width: 32, height: 32)
                                .background(Color.surface)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color.border, lineWidth: 1))
                        }
                        .accessibilityLabel("ปฏิเสธคำขอจาก \(name)")
                    }
                }
                .padding(12)
                .background(Color.surface)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
                .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            }
        }
    }
}
```

- [ ] **Step 2: Confirm the line numbers in `SocialView.swift` before deleting**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios/Slippy/Views/Social
sed -n '133p;275p' SocialView.swift
git diff --quiet -- SocialView.swift && echo "SocialView.swift is clean"
```

Expected: line 133 is `    private var searchBar: some View {`, line 275 is `    }` (closing `pendingSection`), and `SocialView.swift is clean`. If either line differs, stop and re-read the file; do not delete blindly.

- [ ] **Step 3: Delete the three moved properties and rewrite the call sites**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios/Slippy/Views/Social
sed -i '' '133,275d' SocialView.swift
sed -n '104,140p' SocialView.swift
```

Then, with the Edit tool on `SocialView.swift`:

1. Replace

```swift
                // Search bar
                searchBar

                // Search results
                if !vm.searchResults.isEmpty {
                    searchResultsSection
                }

                // Pending requests
                if !vm.pendingRequests.isEmpty {
                    pendingSection
                }
```

with

```swift
                // Search bar
                FriendSearchBar(vm: vm)

                // Search results
                if !vm.searchResults.isEmpty {
                    FriendSearchResults(vm: vm, userId: userId)
                }

                // Pending requests
                if !vm.pendingRequests.isEmpty {
                    FriendRequestList(vm: vm, userId: userId)
                }
```

2. Replace the whole `initialsView` helper (the block starting `// MARK: – Initials avatar helper`):

```swift
    // MARK: – Initials avatar helper
    private func initialsView(name: String, size: CGFloat = 40) -> some View {
        let initials = name.prefix(1).uppercased()
        return Circle()
            .fill(Color.brand500.opacity(0.15))
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(Color.brand500)
            )
    }
```

with

```swift
    // MARK: – Initials avatar helper
    private func initialsView(name: String, size: CGFloat = 40) -> some View {
        InitialsCircle(name: name, size: size)
    }
```

- [ ] **Step 4: Build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
xcodegen generate
./scripts/build-simulator.sh > /private/tmp/slippy-chat-task6-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-chat-task6-build.log | head -20
tail -3 /private/tmp/slippy-chat-task6-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. If `friendsSection` still compiles (it uses `initialsView`), the extraction kept `SocialView` intact.

- [ ] **Step 5: Confirm the removal is pure movement**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Social/SocialView.swift
```

Expected: about 140 deletions and under 15 insertions in `SocialView.swift`. Skim `git diff` of that file to confirm only the three property bodies, the three call sites and `initialsView` changed.

---

### Task 7: Add-friend screen (`SocialAddFriendSheet`)

**Files:**
- Modify (full rewrite): `ios/Slippy/Views/Social/SocialAddFriendSheet.swift`

**Interfaces:**
- Consumes: `FriendSearchBar`, `FriendSearchResults`, `FriendRequestList` (Task 6); `FriendQRScannerView { String in }`; `SocialViewModel` (`inviteURL`, `inviteToken`, `loadOrCreateInviteLink`, `acceptInvite`, `load`, `searchResults`, `pendingRequests`).
- Produces: `SocialAddFriendSheet(vm: SocialViewModel)` — the same initializer `SocialView` uses at line 72.

- [ ] **Step 1: Replace the file**

```swift
import SwiftUI
import CoreImage.CIFilterBuiltins

/// "เพิ่มเพื่อน" — one scrolling screen: search by name, three ways to add
/// (scan a QR, show my QR, share my link) and incoming requests. Mirrors the
/// channels of web/src/app/social/friends/AddFriendModal.tsx.
struct SocialAddFriendSheet: View {
    @EnvironmentObject var authVM: AuthViewModel
    @ObservedObject var vm: SocialViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var route: Route?
    @State private var toast: String?

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    enum Route: String, Identifiable, Hashable {
        case scan, myQR, share
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    FriendSearchBar(vm: vm)

                    if !vm.searchResults.isEmpty {
                        FriendSearchResults(vm: vm, userId: userId)
                    }

                    HStack(spacing: 10) {
                        tile(.scan, icon: "qrcode.viewfinder", title: "สแกน QR")
                        tile(.myQR, icon: "qrcode", title: "QR ของฉัน")
                        tile(.share, icon: "link", title: "แชร์ลิงก์")
                    }

                    if !vm.pendingRequests.isEmpty {
                        FriendRequestList(vm: vm, userId: userId, showsCount: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle("เพิ่มเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
            .navigationDestination(item: $route) { route in
                switch route {
                case .scan:
                    ScrollView { scanPanel }
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("สแกน QR")
                        .navigationBarTitleDisplayMode(.inline)
                case .myQR:
                    ScrollView { myQrPanel }
                        .frame(maxWidth: .infinity)
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("QR ของฉัน")
                        .navigationBarTitleDisplayMode(.inline)
                case .share:
                    ScrollView { lineSharePanel }
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("แชร์ลิงก์")
                        .navigationBarTitleDisplayMode(.inline)
                }
            }
            .task {
                guard !userId.isEmpty, vm.inviteToken == nil else { return }
                await vm.loadOrCreateInviteLink(userId: userId)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.black.opacity(0.8))
                    .clipShape(Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func showToast(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            withAnimation { if toast == message { toast = nil } }
        }
    }

    private func tile(_ target: Route, icon: String, title: String) -> some View {
        Button {
            hapticLight()
            route = target
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(Color.brand500)
                    .frame(width: 44, height: 44)
                    .background(Color.brand50)
                    .clipShape(Circle())
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: – Show my QR
    private var myQrPanel: some View {
        VStack(spacing: 16) {
            if let url = vm.inviteURL, let image = qrImage(for: url.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 240, height: 240)
                    .background(Color.surface)
                    .cornerRadius(16)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
            } else {
                ProgressView()
                    .frame(width: 240, height: 240)
            }
            Text("ให้เพื่อนสแกน QR นี้เพื่อเพิ่มเป็นเพื่อนทันที")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
    }

    private func qrImage(for string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    // MARK: – Scan a friend's QR
    private var scanPanel: some View {
        VStack(spacing: 16) {
            ZStack {
                FriendQRScannerView { scanned in
                    handleScan(scanned)
                }
                .frame(height: 320)
                .cornerRadius(16)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.6), lineWidth: 2).padding(32))
            }
            .padding(.horizontal, 16)
            Text("เล็ง QR ของเพื่อนให้อยู่ในกรอบ")
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary)
        }
        .padding(.top, 16)
    }

    private func handleScan(_ raw: String) {
        // QR encodes the full invite URL (e.g. https://.../friends/join/<token>)
        // — pull the token off the end, same shape web's MyQrPanel encodes.
        guard let token = raw.split(separator: "/").last, !token.isEmpty else { return }
        Task {
            do {
                let name = try await vm.acceptInvite(token: String(token))
                hapticSuccess()
                showToast("เพิ่ม \(name) เป็นเพื่อนแล้ว 🎉")
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if !userId.isEmpty { await vm.load(userId: userId) }
                dismiss()
            } catch {
                showToast("QR ไม่ถูกต้องหรือหมดอายุแล้ว")
            }
        }
    }

    // MARK: – Share via LINE
    private var lineSharePanel: some View {
        VStack(spacing: 12) {
            Button {
                shareViaLine()
            } label: {
                Text("แชร์ลิงก์เชิญผ่าน LINE")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color(hex: "#06C755"))
                    .cornerRadius(14)
            }
            .disabled(vm.inviteURL == nil)

            Button {
                guard let url = vm.inviteURL else { return }
                UIPasteboard.general.string = url.absoluteString
                showToast("คัดลอกลิงก์แล้ว!")
            } label: {
                Text("คัดลอกลิงก์")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
            }
            .disabled(vm.inviteURL == nil)

            Text("เหมาะสำหรับส่งให้เพื่อนที่ยังไม่ได้ใช้ Slippy — เข้าถึงคนได้กว้างกว่าเพราะทุกคนมี LINE อยู่แล้ว")
                .font(.system(size: 12))
                .foregroundColor(Color.textSecondary.opacity(0.8))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
    }

    private func shareViaLine() {
        guard let url = vm.inviteURL else { return }
        let text = "มาเป็นเพื่อนกันใน Slippy กันเถอะ! \(url.absoluteString)"
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? text
        // `line://` opens the LINE app's own share sheet directly if installed;
        // the https:// universal link is the fallback for everyone else,
        // same two-tier approach as api/src/services/line-flex.ts uses server-side.
        if let appURL = URL(string: "line://msg/text/\(encoded)"), UIApplication.shared.canOpenURL(appURL) {
            UIApplication.shared.open(appURL)
        } else if let webURL = URL(string: "https://line.me/R/msg/text/?\(encoded)") {
            UIApplication.shared.open(webURL)
        }
    }
}

#if DEBUG
#Preview {
    SocialAddFriendSheet(vm: SocialViewModel())
        .environmentObject(AuthViewModel(_preview: true))
}
#endif
```

- [ ] **Step 2: Build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
./scripts/build-simulator.sh > /private/tmp/slippy-chat-task7-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-chat-task7-build.log | head -20
tail -3 /private/tmp/slippy-chat-task7-build.log
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`. If `navigationDestination(item:)` rejects `Route`, confirm it conforms to `Identifiable & Hashable` (it does) and that the closure parameter does not shadow an outer name in a way the compiler objects to; rename the closure parameter to `target` if needed.

- [ ] **Step 3: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat ios/Slippy/Views/Social/SocialAddFriendSheet.swift
```

---

### Task 8: Debug fixtures, light/dark screenshots, final verification

**Files:**
- Create: `ios/Slippy/Views/Chat/ChatFixtures.swift` (entire file `#if DEBUG`)
- Modify: `ios/Slippy/App/SlippyApp.swift` — **additive**: three `case` lines in `AppearancePreviewContent`'s `switch screen`, after the existing `case "friends-management-test"` line. This file already has uncommitted changes from other work; do not touch any other line.

**Interfaces:**
- Consumes: `MessagesViewModel.isFixture` (Task 2), `FriendChatListView(viewModel:socialViewModel:)` (Task 5), `FriendChatRoomView(...)` (Task 4), `SocialAddFriendSheet(vm:)` (Task 7), `ChatConversation`, `FriendMessage`, `UserProfile(id:email:fullName:avatarUrl:)`, `Friendship(id:requesterId:addresseeId:status:createdAt:friend:)`.
- Produces: preview screens `chat-list-test`, `chat-room-test`, `add-friend-test` selectable via `SLIPPY_APPEARANCE_PREVIEW`, with `SLIPPY_MAPS_TEST_STYLE=light|dark`.

- [ ] **Step 1: Create the fixture file**

```swift
#if DEBUG
import SwiftUI

// Synthetic data for simulator screenshots of the chat screens
// (SLIPPY_APPEARANCE_PREVIEW=chat-list-test | chat-room-test | add-friend-test).
// Nothing here talks to the network: MessagesViewModel.isFixture short-circuits
// its loads and sends, and the Social view model is only given preset values
// (an invite token is preset so the sheet never tries to mint one).

extension MessagesViewModel {
    static let fixtureMyId = "fx-me"
    static let fixtureFriendId = "fx-friend"
    static let fixtureConversationId = "fx-conv-1"

    private static func iso(daysAgo: Int, hour: Int, minute: Int) -> String {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
        let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func chatFixture() -> MessagesViewModel {
        let vm = MessagesViewModel()
        vm.isFixture = true
        vm.conversations = [
            ChatConversation(id: "fx-conv-1", type: "direct", displayName: "พลอย", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 0, hour: 9, minute: 5),
                             lastMessageBody: "20:00 เจอกัน 👍", lastMessageType: "text"),
            ChatConversation(id: "fx-conv-2", type: "direct", displayName: "กอล์ฟ", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 1, hour: 21, minute: 30),
                             lastMessageBody: nil, lastMessageType: "image"),
            ChatConversation(id: "fx-conv-3", type: "direct", displayName: "นุ่น", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 3, hour: 14, minute: 2),
                             lastMessageBody: "ขอบคุณนะ เดี๋ยวโอนให้", lastMessageType: "text"),
            ChatConversation(id: "fx-conv-4", type: "direct", displayName: "ต้น", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 20, hour: 10, minute: 0),
                             lastMessageBody: nil, lastMessageType: "file"),
            ChatConversation(id: "fx-conv-5", type: "direct", displayName: "เอ", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 400, hour: 18, minute: 45),
                             lastMessageBody: "โอเคเลย", lastMessageType: "text"),
        ]
        func message(_ id: String, _ sender: String, _ body: String, _ daysAgo: Int, _ hour: Int, _ minute: Int) -> FriendMessage {
            FriendMessage(id: id, conversationId: fixtureConversationId, senderId: sender, body: body,
                          msgType: "text", attachmentUrl: nil, createdAt: iso(daysAgo: daysAgo, hour: hour, minute: minute))
        }
        vm.messages = [
            message("m1", fixtureFriendId, "คืนนี้กินอะไรดี หิวมาก", 1, 19, 2),
            message("m2", fixtureFriendId, "อยากกินชาบู", 1, 19, 3),
            message("m3", fixtureMyId, "ชาบูไหม ร้านเดิมที่ทองหล่อ", 1, 19, 4),
            message("m4", fixtureFriendId, "เอา! ถึงกี่โมง 😆", 1, 19, 5),
            message("m5", fixtureMyId, "20:00 เจอกัน 👍", 0, 8, 30),
            message("m6", fixtureFriendId, "ได้เลย เดี๋ยวจองโต๊ะไว้ให้ ที่นั่งริมหน้าต่างนะ จะได้เห็นวิวสวยๆ ตอนกินข้าว", 0, 9, 5),
            message("m7", fixtureMyId, "ขอบคุณนะ", 0, 9, 6),
        ]
        return vm
    }
}

extension SocialViewModel {
    static func friendsFixture() -> SocialViewModel {
        let vm = SocialViewModel()
        vm.inviteToken = "fixture-token"
        vm.friends = [
            UserProfile(id: "fx-friend", email: "ploy@example.invalid", fullName: "พลอย", avatarUrl: nil),
            UserProfile(id: "fx-golf", email: "golf@example.invalid", fullName: "กอล์ฟ", avatarUrl: nil),
        ]
        vm.pendingRequests = [
            Friendship(id: "fx-req-1", requesterId: "fx-mint", addresseeId: MessagesViewModel.fixtureMyId,
                       status: "pending", createdAt: "2026-11-09T00:00:00Z",
                       friend: UserProfile(id: "fx-mint", email: "mint@example.invalid", fullName: "มิ้นท์", avatarUrl: nil)),
            Friendship(id: "fx-req-2", requesterId: "fx-ton", addresseeId: MessagesViewModel.fixtureMyId,
                       status: "pending", createdAt: "2026-11-09T00:00:00Z",
                       friend: UserProfile(id: "fx-ton", email: "ton@example.invalid", fullName: "ต้น", avatarUrl: nil)),
        ]
        return vm
    }
}

struct ChatListFixtureScreen: View {
    @StateObject private var messages = MessagesViewModel.chatFixture()
    @StateObject private var social = SocialViewModel.friendsFixture()
    var body: some View { FriendChatListView(viewModel: messages, socialViewModel: social) }
}

struct ChatRoomFixtureScreen: View {
    @StateObject private var messages = MessagesViewModel.chatFixture()
    var body: some View {
        NavigationStack {
            FriendChatRoomView(
                vm: messages,
                conversationId: MessagesViewModel.fixtureConversationId,
                currentUserId: MessagesViewModel.fixtureMyId,
                friendName: "พลอย", friendAvatarUrl: nil, showsAvatars: true)
        }
    }
}

struct AddFriendFixtureScreen: View {
    @StateObject private var social = SocialViewModel.friendsFixture()
    var body: some View { SocialAddFriendSheet(vm: social) }
}
#endif
```

- [ ] **Step 2: Add the three cases to `SlippyApp.swift`**

Use the Edit tool with this exact old string (it already exists once in the file) and keep every other line of the file unchanged:

old:
```swift
            case "friends-management-test": NavigationStack { FriendManagementView() }
```
new:
```swift
            case "friends-management-test": NavigationStack { FriendManagementView() }
            case "chat-list-test": ChatListFixtureScreen()
            case "chat-room-test": ChatRoomFixtureScreen()
            case "add-friend-test": AddFriendFixtureScreen()
```

Then prove the hunk is additive and nothing else in the file moved:

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff -U0 ios/Slippy/App/SlippyApp.swift | grep -c '^+.*\(chat-list-test\|chat-room-test\|add-friend-test\)'
```

Expected: `3`. Also compare the file's total diff line count with the pre-task value (31 insertions, 1 deletion from before this plan) plus exactly 3 insertions: `git diff --stat ios/Slippy/App/SlippyApp.swift` should read `34 insertions(+), 1 deletion(-)`.

- [ ] **Step 3: Regenerate, build, install**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
xcodegen generate
./scripts/build-simulator.sh > /private/tmp/slippy-chat-task8-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-chat-task8-build.log | head; tail -3 /private/tmp/slippy-chat-task8-build.log
grep -m2 "PRODUCT_BUNDLE_IDENTIFIER" project.yml
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068
xcrun simctl list devices | grep "$UDID"
xcrun simctl boot "$UDID" 2>&1 | head -1
APP=/private/tmp/slippy-simulator-derived/Build/Products/Debug-iphonesimulator/Slippy.app
test -d "$APP" && xcrun simctl install "$UDID" "$APP" && echo installed
```

Expected: build succeeded, the bundle id printed is `app.slippy.ios` (use whatever the first line prints in the next step), the device exists, and `installed`. If the old device id is stale (not listed), pick any available iPhone from `xcrun simctl list devices available` and use that UDID instead.

- [ ] **Step 4: Capture Light and Dark screenshots of the three screens**

```bash
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068
BUNDLE=app.slippy.ios
OUT=/private/tmp/slippy-chat-shots
mkdir -p "$OUT"
for screen in chat-list-test chat-room-test add-friend-test; do
  for style in light dark; do
    SIMCTL_CHILD_SLIPPY_APPEARANCE_PREVIEW=$screen SIMCTL_CHILD_SLIPPY_MAPS_TEST_STYLE=$style \
      xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE" >/dev/null
    sleep 3
    xcrun simctl io "$UDID" screenshot "$OUT/$screen-$style.png"
  done
done
ls -1 "$OUT"
```

Expected: six PNGs. Open each one (Read tool on the PNG path, or the iOS Simulator control `screenshot`) and check, against the spec:

- `chat-list-test`: title "แชท", search field, five flat rows with 44 pt avatars (note "เอ" shows **อ**), times `09:05`/hour-of-day, "เมื่อวาน", a Thai weekday abbreviation, a `d/M` date and a `d/M/yy` date; no badge/pin; legible in Dark.
- `chat-room-test`: nav title "พลอย"; day chips "เมื่อวาน" and "วันนี้"; avatar only at the start of each friend run (after the chip too); `HH:mm` beside bubbles; me = indigo with white text, friend = surface; the single sharp corner on the sender's side; composer is only a capsule field + send button; the long message wraps; Dark legible (chip text readable).
- `add-friend-test`: search field, three tiles (สแกน QR / QR ของฉัน / แชร์ลิงก์), "คำขอเป็นเพื่อน (2)" with ✓ and ✕ on each row.

If a screenshot is blank, wrong, or unreadable, fix the view (not the fixture) and repeat from Step 3. Do **not** describe a screen you did not actually look at.

- [ ] **Step 5: Exercise the failure path and the pushed panels on the simulator**

Use the iOS Simulator control tool (`mcp__Claude_Code_iOS_Simulator__control`) on the same device:

1. Launch `chat-room-test` in light mode (command from Step 4), tap the text field, type `ทดสอบส่ง`, tap the send button. Expected: the error line `ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่` appears above the composer, the text `ทดสอบส่ง` is still in the field, and no new bubble appears (fixture sends always fail — this is the retained-draft proof). Take a screenshot to `/private/tmp/slippy-chat-shots/chat-room-send-failed-light.png`.
2. Launch `add-friend-test`, tap "QR ของฉัน": a pushed panel shows a QR code with the back button; tap back. Tap "แชร์ลิงก์": the LINE-green button and "คัดลอกลิงก์" are enabled (token is preset); tap "คัดลอกลิงก์" and confirm the toast appears and disappears within about 2 seconds. Tap back. (Do not tap the LINE button; do not open the scanner — it needs camera permission and is exercised only by the existing flow.)

Record what you actually saw. If the simulator control is unavailable, say the on-device interaction check was not obtained.

- [ ] **Step 6: Run every host check, then confirm repository state**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-chat-presentation.mjs
PATH=/usr/local/bin:$PATH node scripts/verify-chat-send-contract.mjs
PATH=/usr/local/bin:$PATH node scripts/verify-trip-members.mjs
cd ..
git diff --check
git status --short | wc -l
git status --short | grep -E "Chat|Social|MessagesViewModel|ChatPresentation|SlippyApp|verify-chat"
```

Expected: both new checks print `PASS`, the pre-existing `verify-trip-members.mjs` still passes, `git diff --check` prints nothing, and the total entry count is the preflight count plus the new files (`ChatPresentation.swift`, `ChatAvatar.swift`, `ChatFixtures.swift`, `FriendSearchAndRequests.swift`, the two scripts). The `grep` should list only files this plan names; any other changed file means something unintended moved — investigate before reporting.

- [ ] **Step 7: Final state — no commit**

Do not commit. Report to the user: which checks passed (with the actual output lines), the six screenshot paths and what each showed, the failure-path observation, the list of changed/new files, and what was **not** verified (physical device — provisioning profile expired; hosted persistence; real multi-user delivery; the QR scanner; the LINE share hand-off). Ask whether to commit; that is a separate approval.

---

## Self-Review (done while writing)

**Spec coverage:** 3.1 room → Task 4 (bubbles, avatars, time, chips, composer, draft, VoiceOver); 3.2 `sendMessage` → Task 2; 3.3 list → Task 5 (flat rows, 44 pt, time rules, local search, empty states, picker restyle); 3.4 add friend → Tasks 6-7; 3.5 shared pieces → Tasks 1, 3; section 5 verification → Tasks 1, 2, 8; section 8 amendments → Tasks 2, 4, 5, 8 (fixtures, trip-chat compatibility, toast auto-dismiss, Gregorian). Non-goals are respected: no read/unread, no new decline, no web, no schema.

**Placeholders:** none; every code step has full code.

**Type consistency:** `ChatPresentation.MessageLayout(dayChip:showsAvatar:)` and `layouts(items:me:now:calendar:)` are identical in Tasks 1 and 4; `FriendChatRoomView(vm:conversationId:currentUserId:friendName:friendAvatarUrl:showsAvatars:)` matches Tasks 4, 5, 8; `FriendChatListView(viewModel:socialViewModel:)` matches Tasks 5, 8; `FriendRequestList(vm:userId:showsCount:)` matches Tasks 6, 7; `MessagesViewModel.isFixture` matches Tasks 2, 8.

**Known risks for the executor:** the Swift in Tasks 4-8 was written against the code as read on 2026-11-09 but has not been compiled yet; expect to fix small compiler errors in those files. If `Color.brand300` or `Color.errorText` turn out not to exist as written, use the nearest existing adaptive color from `SlippyColors.swift` and keep contrast ≥ 4.5 in Light and Dark.
