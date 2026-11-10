import Foundation

/// A chat message as far as paging is concerned: an id and the `created_at` string Supabase returned.
protocol PagedMessage {
    var id: String { get }
    var createdAt: String { get }
}

/// Pure rules for loading chat history and for choosing a direct room. Foundation only, so
/// `ios/scripts/verify-chat-paging.mjs` can compile this file on its own.
///
/// Why not just `.order("created_at").limit(100)`: ascending + limit returns the OLDEST 100 messages, so a long
/// chat opened on its first messages. History is read newest-first in pages and merged here.
enum ChatPaging {
    static let pageSize = 50

    // MARK: – Timestamps

    private static let isoSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let timestampPattern = try! NSRegularExpression(
        pattern: #"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$"#)

    /// Whole seconds since the epoch plus the fraction as 9 digits. Postgres sends 0–6 fraction digits and trims
    /// trailing zeros, so the fraction is compared as digits, never as a rounded Date.
    private struct Instant {
        let seconds: Int
        let fraction: String   // 9 digits
        let rawFraction: String?
    }

    private static func instant(_ raw: String) -> Instant? {
        let range = NSRange(raw.startIndex..., in: raw)
        guard let m = timestampPattern.firstMatch(in: raw, range: range),
              let base = Range(m.range(at: 1), in: raw),
              let zone = Range(m.range(at: 3), in: raw),
              let date = isoSeconds.date(from: String(raw[base]) + String(raw[zone]))
        else { return nil }
        var rawFraction: String? = nil
        if m.range(at: 2).location != NSNotFound, let r = Range(m.range(at: 2), in: raw) { rawFraction = String(raw[r]) }
        let padded = (rawFraction ?? "").padding(toLength: 9, withPad: "0", startingAt: 0)
        return Instant(seconds: Int(date.timeIntervalSince1970.rounded(.down)), fraction: padded, rawFraction: rawFraction)
    }

    /// The `created_at` value to use in an "older than this" filter. A raw `+00:00` must not go into a query
    /// string (a `+` there means a space), so the instant is rewritten in UTC with `Z`. The fraction is kept
    /// digit for digit (no rounding to milliseconds). `nil` when the timestamp cannot be read.
    static func cursorValue(_ createdAt: String) -> String? {
        guard let parsed = instant(createdAt) else { return nil }
        let wholeSeconds = isoSeconds.string(from: Date(timeIntervalSince1970: TimeInterval(parsed.seconds)))   // "…SSZ"
        guard wholeSeconds.hasSuffix("Z") else { return nil }
        let head = wholeSeconds.dropLast()
        return parsed.rawFraction.map { "\(head).\($0)Z" } ?? "\(head)Z"
    }

    // MARK: – Merging pages

    private static func isOrderedBefore(_ a: (id: String, raw: String, at: Instant?), _ b: (id: String, raw: String, at: Instant?)) -> Bool {
        switch (a.at, b.at) {
        case let (x?, y?):
            if x.seconds != y.seconds { return x.seconds < y.seconds }
            if x.fraction != y.fraction { return x.fraction < y.fraction }
            return a.id < b.id
        case (nil, _?): return true       // an unreadable timestamp sorts first and is never dropped
        case (_?, nil): return false
        case (nil, nil):
            return a.raw == b.raw ? a.id < b.id : a.raw < b.raw
        }
    }

    /// Merges a freshly loaded page into what is already shown: one entry per id (the incoming copy wins), oldest
    /// first. Used by the 4-second refresh so it adds new messages without dropping older pages already loaded.
    static func merge<T: PagedMessage>(existing: [T], incoming: [T]) -> [T] {
        var byId: [String: T] = [:]
        for message in existing { byId[message.id] = message }
        for message in incoming { byId[message.id] = message }
        return byId.values
            .map { (message: $0, key: (id: $0.id, raw: $0.createdAt, at: instant($0.createdAt))) }
            .sorted { isOrderedBefore($0.key, $1.key) }
            .map(\.message)
    }

    /// Whether older messages may exist after loading a page of `fetched` rows.
    /// `newlyAdded` is how many rows of an OLDER page were not already on screen (`nil` for the first page):
    /// a full page that added nothing cannot make progress, so paging stops instead of looping.
    static func hasMoreOlder(fetched: Int, pageSize: Int, newlyAdded: Int?) -> Bool {
        guard fetched >= pageSize else { return false }
        return (newlyAdded ?? 1) > 0
    }

    // MARK: – Direct rooms

    struct DirectCandidate {
        let id: String
        let type: String
        let memberIds: [String]
    }

    /// The room that is the direct chat of exactly `me` and `other`: type `direct` and no other member.
    /// A shared group, or a direct-typed room with a third member, is never returned. First suitable room in the
    /// given order wins (pass candidates oldest first). Same rules as web/src/lib/chat-access.ts.
    static func pickDirectConversation(_ candidates: [DirectCandidate], me: String, other: String) -> String? {
        let a = me.lowercased(), b = other.lowercased()
        guard a != b else { return nil }
        for room in candidates where room.type == "direct" {
            let members = Set(room.memberIds.map { $0.lowercased() })
            if members.count == 2 && members.contains(a) && members.contains(b) { return room.id }
        }
        return nil
    }
}
