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
        try? db.storage.from(bucket).getPublicURL(path: photo.storagePath)
    }

    static func remove(_ photo: TripPhoto) async throws {
        _ = try? await db.storage.from(bucket).remove(paths: [photo.storagePath])
        try await db.from("trip_photos").delete().eq("id", value: photo.id).execute()
    }
}
