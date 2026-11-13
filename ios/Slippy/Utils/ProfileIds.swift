import Foundation

/// How user ids are prepared for the `get_related_profiles` RPC (host-tested by
/// `node ios/scripts/verify-profile-directory.mjs`).
///
/// `public.users` is readable only by its owner, so the app cannot select other people's profiles; the RPC returns the
/// profiles of people related to the caller (friends, people who asked to be friends, people in a shared chat).
enum ProfileIds {
    /// The function reads at most this many ids per call (`p_ids[1:200]` in the migration).
    static let maxPerCall = 200

    /// Lower-case, de-duplicated (first occurrence wins), blanks dropped. `UUID.uuidString` is upper-case while Postgres
    /// returns lower-case ids, so every lookup key is lower-cased.
    static func normalized(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in ids {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !id.isEmpty, seen.insert(id).inserted { out.append(id) }
        }
        return out
    }

    /// Consecutive chunks of at most `size` ids; a non-positive size means one chunk.
    static func chunks(_ ids: [String], size: Int) -> [[String]] {
        guard !ids.isEmpty else { return [] }
        guard size > 0 else { return [ids] }
        return stride(from: 0, to: ids.count, by: size).map { Array(ids[$0..<min($0 + size, ids.count)]) }
    }
}
