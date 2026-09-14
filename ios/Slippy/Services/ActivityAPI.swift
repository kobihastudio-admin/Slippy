import Foundation
import Supabase

/// Activity reads use the signed-in user's Supabase session. RLS remains the
/// authority for private, group, and public visibility; the app never filters
/// a broader result locally and never holds a server credential.
@MainActor
enum ActivityAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }
    private static let columns = "id, title, summary, category, visibility, status, location_name, starts_at, source_type"

    static func list(scope: ActivityScope) async throws -> [ActivitySummary] {
        switch scope {
        case .mine:
            let userId = try await db.auth.session.user.id.uuidString
            return try await db.from("activities")
                .select(columns)
                .eq("owner_id", value: userId)
                .order("starts_at", ascending: true)
                .execute().value
        case .group:
            return try await db.from("activities")
                .select(columns)
                .eq("visibility", value: ActivityVisibility.group.rawValue)
                .order("starts_at", ascending: true)
                .execute().value
        case .explore:
            return try await db.from("activities")
                .select(columns)
                .eq("visibility", value: ActivityVisibility.public.rawValue)
                .eq("status", value: ActivityStatus.published.rawValue)
                .order("starts_at", ascending: true)
                .execute().value
        }
    }
}
