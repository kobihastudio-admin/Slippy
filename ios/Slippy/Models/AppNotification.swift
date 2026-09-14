import Foundation

/// Mirrors the `notifications` table consumed by the web app's
/// `/api/notifications` route (`web/src/app/api/notifications/route.ts`)
/// and rendered in `web/src/app/(app)/notifications/page.tsx`.
/// Keeping the field set identical keeps both clients reading/writing the
/// same shape so behaviour stays consistent across platforms.
struct AppNotification: Codable, Identifiable {
    let id:             String
    let type:           String
    let title:          String
    let body:           String?
    let readAt:         String?
    let createdAt:      String
    let organizationId: String?
    let userId:         String?

    enum CodingKeys: String, CodingKey {
        case id, type, title, body
        case readAt         = "read_at"
        case createdAt      = "created_at"
        case organizationId = "organization_id"
        case userId         = "user_id"
    }

    var isUnread: Bool { readAt == nil }

    /// Parsed `created_at` for relative-time / sorting use.
    /// Supabase timestamps may or may not include fractional seconds, so try both.
    var createdDate: Date? {
        ISO8601DateFormatter.withFractional.date(from: createdAt)
            ?? ISO8601DateFormatter.plain.date(from: createdAt)
    }

    /// SF Symbol + tint that mirrors the web's `typeIcon()` mapping
    /// (lucide icon → SF Symbol, same colour families).
    var iconName: String {
        switch type {
        case "document_approved":  return "checkmark.circle.fill"
        case "document_rejected":  return "xmark.circle.fill"
        case "document_failed":    return "exclamationmark.triangle.fill"
        case "document_duplicate": return "exclamationmark.triangle.fill"
        case "quota_warning":      return "exclamationmark.triangle.fill"
        case "quota_exceeded":     return "exclamationmark.triangle.fill"
        case "payment_due":        return "creditcard.fill"
        case "payment_failed":     return "creditcard.trianglebadge.exclamationmark"
        case "payment_success":    return "creditcard.fill"
        case "integration_sync":   return "bolt.fill"
        case "line_received", "email_received": return "doc.text.fill"
        case "upload_error":       return "exclamationmark.triangle.fill"
        default:                   return "bell.fill"
        }
    }

    var iconTint: String {
        switch type {
        case "document_approved", "payment_success":      return "#10b981" // emerald
        case "document_failed", "document_rejected", "upload_error",
             "quota_exceeded", "payment_failed":           return "#f43f5e" // rose
        case "document_duplicate", "quota_warning",
             "payment_due":                                return "#f59e0b" // amber
        case "integration_sync":                          return "#a855f7" // purple
        case "line_received", "email_received":           return "#6366f1" // brand
        default:                                          return "#9ca3af" // muted
        }
    }

    /// Thai relative-time label — same buckets as the web's `relativeTime()`.
    func relativeTimeString(now: Date = Date()) -> String {
        guard let date = createdDate else { return "" }
        let diff = now.timeIntervalSince(date)
        let minutes = Int(diff / 60)
        if minutes < 1  { return "เมื่อกี้" }
        if minutes < 60 { return "\(minutes) นาทีที่แล้ว" }
        let hours = minutes / 60
        if hours < 24   { return "\(hours) ชม.ที่แล้ว" }
        let days = hours / 24
        if days == 1    { return "เมื่อวาน" }
        if days < 7     { return "\(days) วันที่แล้ว" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "th_TH")
        fmt.dateFormat = "d MMM"
        return fmt.string(from: date)
    }
}

extension ISO8601DateFormatter {
    static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
