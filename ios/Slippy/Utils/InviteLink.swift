import Foundation

/// Friend-invite deep links: `slippy://friends/join/<token>`.
///
/// Foundation only, so `ios/scripts/verify-invite-link.mjs` can compile this
/// file on its own. A custom URL scheme can be opened by any web page or app,
/// so the parser is deliberately strict: only a well-formed token ever leaves
/// this file, and opening a link never creates a friendship by itself.
enum InviteLink {

    /// `friend_invite_links.token` is `substr(replace(gen_random_uuid()::text,'-',''),1,12)`.
    private static func isToken(_ value: String) -> Bool {
        value.utf8.count == 12 && value.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    }

    /// The token of a `slippy://friends/join/<token>` URL, else `nil`.
    /// Scheme and host are case-insensitive; the token is not (lowercase hex only).
    /// Query and fragment are ignored; any extra path segment rejects the URL.
    static func token(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "slippy", url.host?.lowercased() == "friends" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "join", isToken(parts[1]) else { return nil }
        return parts[1]
    }

    /// Adds (or replaces) `src=line` on an invite URL so the web page shows the
    /// "open in Slippy" landing. Path and other query items are kept.
    static func lineShareURL(_ invite: URL) -> URL {
        guard var components = URLComponents(url: invite, resolvingAgainstBaseURL: false) else { return invite }
        var items = (components.queryItems ?? []).filter { $0.name != "src" }
        items.append(URLQueryItem(name: "src", value: "line"))
        components.queryItems = items
        return components.url ?? invite
    }

    /// Percent-encodes a LINE share message like JavaScript's `encodeURIComponent`
    /// (unreserved characters only). `.urlQueryAllowed` is NOT enough: it leaves
    /// `? & = # / :` raw, so the `?src=line` of an invite link would become the query
    /// of the `line://msg/text/...` URL instead of staying inside the message.
    static func percentEncodedForLine(_ text: String) -> String {
        var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        allowed.insert(charactersIn: "-._~")
        return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    /// `line://` opens LINE's own share sheet if the app is installed; the `https://line.me`
    /// universal link is the fallback (same two-tier approach as api/src/services/line-flex.ts).
    static func lineMessageURLs(text: String) -> (app: URL?, web: URL?) {
        let encoded = percentEncodedForLine(text)
        return (URL(string: "line://msg/text/\(encoded)"), URL(string: "https://line.me/R/msg/text/?\(encoded)"))
    }

    private static let finalFailures = ["invite_not_found", "invite_expired", "cannot_add_self"]

    /// Thai message for the text of an error thrown while redeeming an invite.
    static func failureMessage(_ raw: String) -> String {
        if raw.contains("invite_not_found") || raw.contains("invite_expired") { return "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" }
        if raw.contains("cannot_add_self") { return "นี่คือลิงก์ของคุณเอง" }
        return "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง"
    }

    /// Whether the user can usefully tap "รับคำเชิญ" again after this failure.
    static func isRetryable(_ raw: String) -> Bool {
        !finalFailures.contains { raw.contains($0) }
    }
}
