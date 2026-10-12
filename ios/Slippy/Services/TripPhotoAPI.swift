import Foundation
import Supabase

/// Check-in photos — the trip gallery. Public bucket, same posture as
/// payment-proofs (SportGroupsViewModel already uses this exact pattern):
/// casual images, not the sensitive paperwork TripDocumentStorageAPI holds.
@MainActor
enum TripPhotoAPI {

    private static var db: SupabaseClient { SupabaseManager.shared.client }
    private static let bucket = "trip-photos"

    private static let columns = "id, item_id, storage_path, caption, taken_at"

    static func list(journeyId: String, itemId: String? = nil) async throws -> [TripPhoto] {
        var query = db.from("trip_photos")
            .select(columns)
            .eq("journey_id", value: journeyId)
        if let itemId {
            query = query.eq("item_id", value: itemId)
        }
        return try await query.order("taken_at", ascending: false).execute().value
    }

    static func upload(journeyId: String, itemId: String?, data: Data, caption: String? = nil) async throws -> TripPhoto {
        let path = "\(journeyId)/\(UUID().uuidString).jpg"
        try await db.storage.from(bucket)
            .upload(path, data: data, options: .init(contentType: "image/jpeg"))

        let userId = try? await db.auth.session.user.id.uuidString
        struct NewPhoto: Encodable {
            let journey_id: String
            let item_id: String?
            let uploaded_by: String?
            let storage_path: String
            let caption: String?
        }
        do {
            return try await db.from("trip_photos")
                .insert(NewPhoto(journey_id: journeyId, item_id: itemId, uploaded_by: userId, storage_path: path, caption: caption))
                .select(columns)
                .single()
                .execute()
                .value
        } catch {
            _ = try? await db.storage.from(bucket).remove(paths: [path])
            throw error
        }
    }

    static func publicURL(_ photo: TripPhoto) -> URL? {
        publicURL(path: photo.storagePath)
    }

    static func publicURL(path: String) -> URL? {
        try? db.storage.from(bucket).getPublicURL(path: path)
    }

    static func remove(_ photo: TripPhoto) async throws {
        _ = try? await db.storage.from(bucket).remove(paths: [photo.storagePath])
        try await db.from("trip_photos").delete().eq("id", value: photo.id).execute()
    }
}

/// Small per-trip settings kept in `life_journeys.metadata` (JSON): the custom
/// cover photo path and edited identity-tag details. Trip participants may
/// update their trip row (RLS `life_journeys_life_graph_or_trip_participant`),
/// so no schema change is needed. Each write re-reads the row and replaces only
/// its own key, so the other keys (`theme`, `source`, …) are preserved.
@MainActor
enum TripMetadataAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }
    private struct Row: Decodable { let metadata: [String: AnyJSON]? }

    static func load(journeyId: String) async throws -> [String: AnyJSON] {
        let row: Row = try await db.from("life_journeys")
            .select("metadata").eq("id", value: journeyId).single().execute().value
        return row.metadata ?? [:]
    }

    /// Sets `key` to `value`, or removes it when `value` is nil.
    static func set(journeyId: String, key: String, value: AnyJSON?) async throws {
        var current = try await load(journeyId: journeyId)
        if let value { current[key] = value } else { current.removeValue(forKey: key) }
        try await db.from("life_journeys")
            .update(["metadata": AnyJSON.object(current)])
            .eq("id", value: journeyId)
            .execute()
    }
}

/// Re-reads a trip's participants after a profile edit, so the trip page shows
/// the new photo and role without leaving and re-entering the trip.
@MainActor
enum TripPeopleAPI {
    static func fetch(journeyId: String) async throws -> [TripParticipant] {
        try await SupabaseManager.shared.client.from("trip_participants")
            .select().eq("journey_id", value: journeyId)
            .order("created_at", ascending: true)
            .execute().value
    }
}

