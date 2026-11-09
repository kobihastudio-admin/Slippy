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
    /// - Failure: the field is left exactly as it is.
    /// - Success, field unchanged: cleared.
    /// - Success, user kept typing after the sent text: only the new part stays,
    ///   so the text that was just sent is not sent a second time.
    /// - Success, user edited elsewhere: left as it is (never guess).
    static func draftAfterSend(current: String, sent: String, succeeded: Bool) -> String {
        guard succeeded else { return current }
        if current == sent { return "" }
        if current.hasPrefix(sent) {
            let rest = String(current.dropFirst(sent.count))
            return rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? ""
                : String(rest.drop(while: { $0.isWhitespace || $0.isNewline }))
        }
        return current
    }
}
