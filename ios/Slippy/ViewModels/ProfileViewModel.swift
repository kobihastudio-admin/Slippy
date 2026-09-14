import SwiftUI
import Supabase

/// Mirrors `web/src/app/(app)/profile/page.tsx` field-for-field:
/// real activity from `user_activity_logs` (not documents-derived), and the
/// actual LINE connection status from `line_connections` instead of a
/// hardcoded "connected" badge.
@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var docCount      = 0
    @Published var splitCount    = 0
    @Published var tripCount     = 0
    @Published var activityLogs: [UserActivityLog] = []
    @Published var lineConnection: LineConnection?
    @Published var isLoading     = false

    private let db = SupabaseManager.shared.client

    func load(orgId: String, userId: String) async {
        isLoading = true
        defer { isLoading = false }

        // Each fetch settles on its own.
        //
        // These five used to share one `try await (…)` and one `catch` that
        // swallowed the error with the comment "stats/activity are decorative".
        // They are not decorative — they are the only numbers on the screen. And
        // one of them named a table that does not exist (`trips`; the real one is
        // `life_journeys`), so the tuple threw every single time and ALL THREE
        // counters rendered 0 while documents and split bills had both returned
        // fine. The screen showed "0 เอกสาร" to an account holding 53.
        //
        // A failure in one number now costs that number only, and leaves a trace:
        // a silent zero is indistinguishable from a true zero, which is how this
        // survived.
        async let docsTask  = countOrZero(table: "documents",     orgId: orgId)
        async let splitTask = countOrZero(table: "split_bills",   orgId: orgId)
        async let tripTask  = countOrZero(table: "life_journeys", orgId: orgId)
        async let actTask   = activityOrEmpty(userId: userId)
        async let lineTask  = lineOrNil(orgId: orgId, userId: userId)

        let (docs, splits, trips, acts, line) =
            await (docsTask, splitTask, tripTask, actTask, lineTask)
        docCount       = docs
        splitCount     = splits
        tripCount      = trips
        activityLogs   = acts
        lineConnection = line
    }

    private func countOrZero(table: String, orgId: String) async -> Int {
        do { return try await fetchCount(table: table, orgId: orgId) }
        catch { print("[profile] count(\(table)) failed: \(error.localizedDescription)"); return 0 }
    }

    private func activityOrEmpty(userId: String) async -> [UserActivityLog] {
        do { return try await fetchActivityLogs(userId: userId) }
        catch { print("[profile] activity logs failed: \(error.localizedDescription)"); return [] }
    }

    private func lineOrNil(orgId: String, userId: String) async -> LineConnection? {
        do { return try await fetchLineConnection(orgId: orgId, userId: userId) }
        catch { print("[profile] line connection failed: \(error.localizedDescription)"); return nil }
    }

    private func fetchCount(table: String, orgId: String) async throws -> Int {
        struct Row: Decodable { let id: String }
        let rows: [Row] = try await db
            .from(table)
            .select("id")
            .eq("organization_id", value: orgId)
            .execute()
            .value
        return rows.count
    }

    private func fetchActivityLogs(userId: String) async throws -> [UserActivityLog] {
        try await db
            .from("user_activity_logs")
            .select("id, action, detail, created_at")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(6)
            .execute()
            .value
    }

    private func fetchLineConnection(orgId: String, userId: String) async throws -> LineConnection? {
        let rows: [LineConnection] = try await db
            .from("line_connections")
            .select("id, display_name, created_at")
            .eq("organization_id", value: orgId)
            .eq("user_id", value: userId)
            .limit(1)
            .execute()
            .value
        return rows.first
    }
}

// MARK: – Models mirroring web's exact table shapes

struct UserActivityLog: Codable, Identifiable {
    let id: String
    let action: String
    let detail: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, action, detail
        case createdAt = "created_at"
    }

    var icon: String {
        switch action {
        case "login":                  return "arrow.right.circle.fill"
        case "logout":                 return "arrow.left.circle.fill"
        case "consent_update":        return "checkmark.shield.fill"
        case "security_update":       return "lock.fill"
        case "export_request":        return "square.and.arrow.up.fill"
        case "session_revoke":        return "xmark.shield.fill"
        case "account_delete_request": return "trash.fill"
        default:                       return "circle.fill"
        }
    }

    var label: String {
        switch action {
        case "login":                  return "เข้าสู่ระบบ"
        case "logout":                 return "ออกจากระบบ"
        case "consent_update":        return "อัปเดตการยินยอม"
        case "security_update":       return "อัปเดตความปลอดภัย"
        case "export_request":        return "ขอออกข้อมูล"
        case "session_revoke":        return "เพิกถอนเซสชัน"
        case "account_delete_request": return "ขอลบบัญชี"
        default:                       return action
        }
    }
}

struct LineConnection: Codable, Identifiable {
    let id: String
    let displayName: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case createdAt   = "created_at"
    }
}
