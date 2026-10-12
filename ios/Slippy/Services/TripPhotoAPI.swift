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


/// Identity tags (name, animal, picture per traveller) — `trip_identity_tags`
/// (migration 20261012070714). One row per (trip, member_key).
struct TripIdentityTagRow: Codable {
    let memberKey: String
    let name: String?
    let animal: String?
    let imagePath: String?

    enum CodingKeys: String, CodingKey {
        case name, animal
        case memberKey = "member_key"
        case imagePath = "image_path"
    }
}

@MainActor
enum TripIdentityTagAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }

    static func load(journeyId: String) async throws -> [TripIdentityTagRow] {
        try await db.from("trip_identity_tags")
            .select("member_key, name, animal, image_path")
            .eq("journey_id", value: journeyId)
            .execute().value
    }

    static func save(journeyId: String, memberKey: String, participantId: String?,
                     name: String, animal: String, imagePath: String?) async throws {
        struct Row: Encodable {
            let journey_id: String; let member_key: String; let participant_id: String?
            let name: String; let animal: String; let image_path: String?
        }
        try await db.from("trip_identity_tags")
            .upsert(Row(journey_id: journeyId, member_key: memberKey, participant_id: participantId,
                        name: name, animal: animal, image_path: imagePath),
                    onConflict: "journey_id,member_key")
            .execute()
    }

    static func remove(journeyId: String, memberKey: String) async throws {
        try await db.from("trip_identity_tags").delete()
            .eq("journey_id", value: journeyId).eq("member_key", value: memberKey).execute()
    }
}

/// A place, restaurant or souvenir the group is choosing between — `trip_place_candidates`
/// and `trip_place_votes`.
struct TripPlaceCandidate: Codable, Identifiable {
    let id: String
    let kind: String
    let dayNumber: Int?
    let title: String
    let note: String?
    let mapsUrl: String?
    let priceHint: String?
    let needsBooking: Bool
    var status: String
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id, kind, title, note, status
        case dayNumber = "day_number"
        case mapsUrl = "maps_url"
        case priceHint = "price_hint"
        case needsBooking = "needs_booking"
        case sortOrder = "sort_order"
    }
}

struct TripPlaceVote: Codable, Hashable {
    let candidateId: String
    let participantId: String

    enum CodingKeys: String, CodingKey {
        case candidateId = "candidate_id"
        case participantId = "participant_id"
    }
}

@MainActor
enum TripPlacesAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }

    static func load(journeyId: String) async throws -> (candidates: [TripPlaceCandidate], votes: [TripPlaceVote]) {
        async let candidates: [TripPlaceCandidate] = db.from("trip_place_candidates")
            .select("id, kind, day_number, title, note, maps_url, price_hint, needs_booking, status, sort_order")
            .eq("journey_id", value: journeyId)
            .order("sort_order", ascending: true)
            .execute().value
        async let votes: [TripPlaceVote] = db.from("trip_place_votes")
            .select("candidate_id, participant_id")
            .eq("journey_id", value: journeyId)
            .execute().value
        return try await (candidates, votes)
    }

    static func setVote(journeyId: String, candidateId: String, participantId: String, on: Bool) async throws {
        if on {
            struct Row: Encodable { let candidate_id: String; let participant_id: String; let journey_id: String }
            try await db.from("trip_place_votes")
                .upsert(Row(candidate_id: candidateId, participant_id: participantId, journey_id: journeyId),
                        onConflict: "candidate_id,participant_id")
                .execute()
        } else {
            try await db.from("trip_place_votes").delete()
                .eq("candidate_id", value: candidateId).eq("participant_id", value: participantId).execute()
        }
    }

    static func setStatus(candidateId: String, status: String) async throws {
        struct Patch: Encodable { let status: String }
        try await db.from("trip_place_candidates").update(Patch(status: status))
            .eq("id", value: candidateId).execute()
    }
}
