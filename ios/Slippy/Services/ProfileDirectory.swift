import Foundation
import Supabase

/// Profiles of people related to the signed-in user, through the `get_related_profiles` RPC
/// (supabase/migrations/20261113100000_related_profiles_rpc.sql). A plain `select` on `public.users` returns only the
/// user's own row under RLS, so every screen that shows another person's name or avatar goes through here.
enum ProfileDirectory {
    private struct Params: Encodable {
        let pIds: [String]
        enum CodingKeys: String, CodingKey { case pIds = "p_ids" }
    }

    /// Profiles keyed by LOWER-CASE id. Ids that are not related to the caller are simply absent from the result.
    static func fetch(ids: [String]) async throws -> [String: UserProfile] {
        let wanted = ProfileIds.normalized(ids)
        guard !wanted.isEmpty else { return [:] }
        var out: [String: UserProfile] = [:]
        for chunk in ProfileIds.chunks(wanted, size: ProfileIds.maxPerCall) {
            let rows: [UserProfile] = try await SupabaseManager.shared.client
                .rpc("get_related_profiles", params: Params(pIds: chunk))
                .execute()
                .value
            for row in rows { out[row.id.lowercased()] = row }
        }
        return out
    }
}
