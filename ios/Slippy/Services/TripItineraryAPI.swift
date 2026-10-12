import Foundation
import Supabase

/// Editing the itinerary from the phone.
///
/// WHY SUPABASE DIRECTLY AND NOT THE WEB API
/// Migration 094 moved the trip tables to participant-scoped RLS, so the
/// database itself now enforces "a trip belongs to whoever is on it". That means
/// the app can insert, update and delete itinerary rows with the user's own
/// session and get exactly the authorization the web routes apply — without a
/// round trip through Next, and without the app needing any server secret.
///
/// Document import and PDF export are different: they need the vision model and
/// headless Chrome, which live server-side. Those go through the web endpoints
/// with the user's Supabase access token as a Bearer (see TripDocumentAPI).
@MainActor
enum TripItineraryAPI {

    private static var db: SupabaseClient { SupabaseManager.shared.client }

    /// Columns every read asks for. One list, so a field added to the model
    /// cannot be silently missing from half the queries.
    static let itemColumns = """
        id, day_id, sort_order, type, title, subtitle, location, notes,
        time_from, time_to, status, provider, confirmation_code,
        lat, lng, end_location, end_lat, end_lng,
        amount, currency, exchange_rate, amount_base_currency, expense_id,
        checked_in_at, checked_in_by, details
        """

    // MARK: – Move a pin

    /// Latitude and longitude travel together, always.
    ///
    /// Writing one without the other leaves a row whose latitude is the new
    /// place and whose longitude is the old one — a coordinate that points at
    /// open sea and looks perfectly well-formed.
    static func move(itemId: String, lat: Double, lng: Double) async throws -> TripItineraryItem {
        struct Patch: Encodable { let lat: Double; let lng: Double }
        return try await db.from("trip_itinerary_items")
            .update(Patch(lat: lat, lng: lng))
            .eq("id", value: itemId)
            .select(itemColumns)
            .single()
            .execute()
            .value
    }

    // MARK: – Add a stop

    static func addStop(
        dayId: String,
        title: String,
        type: String,
        lat: Double?,
        lng: Double?,
        location: String?,
        timeFrom: String?,
        baseCurrency: String,
        details: [String: AnyJSON] = [:]
    ) async throws -> TripItineraryItem {
        // Append after whatever is already there.
        struct OrderRow: Decodable { let sort_order: Int }
        let last: [OrderRow] = try await db.from("trip_itinerary_items")
            .select("sort_order").eq("day_id", value: dayId)
            .order("sort_order", ascending: false).limit(1)
            .execute().value

        struct NewItem: Encodable {
            let day_id: String
            let sort_order: Int
            let type: String
            let title: String
            let location: String?
            let lat: Double?
            let lng: Double?
            let time_from: String?
            let status: String
            // Money is written in BOTH currencies or not at all — see the
            // alignment migration. A stop added here has no price yet, so both
            // are zero rather than one being left null.
            let amount: Double
            let currency: String
            let exchange_rate: Double
            let amount_base_currency: Double
            // flight_number, seat, phone, website… — same free-form column the
            // travel-doc importer writes. Omitted entirely (not even `{}`) when
            // empty so a plain map-tap stop looks exactly as it always has.
            let details: [String: AnyJSON]?
        }

        return try await db.from("trip_itinerary_items")
            .insert(NewItem(
                day_id: dayId,
                sort_order: (last.first?.sort_order ?? -1) + 1,
                type: type,
                title: title,
                location: location,
                lat: lat, lng: lng,
                time_from: timeFrom,
                status: "planned",
                amount: 0, currency: baseCurrency,
                exchange_rate: 1, amount_base_currency: 0,
                details: details.isEmpty ? nil : details
            ))
            .select(itemColumns)
            .single()
            .execute()
            .value
    }

    // MARK: – Remove

    static func remove(itemId: String) async throws {
        try await db.from("trip_itinerary_items")
            .delete().eq("id", value: itemId).execute()
    }

    // MARK: – Reorder

    /// Persists a whole day's order.
    ///
    /// Sequential rather than concurrent: every call writes `sort_order` on a
    /// sibling row, and the last write should be the last position rather than
    /// whichever request happened to win.
    static func reorder(items: [TripItineraryItem]) async throws {
        struct Patch: Encodable { let sort_order: Int }
        for (index, item) in items.enumerated() where item.sortOrder != index {
            try await db.from("trip_itinerary_items")
                .update(Patch(sort_order: index))
                .eq("id", value: item.id)
                .execute()
        }
    }

    // MARK: – Rename / retime

    static func update(
        itemId: String,
        title: String?,
        timeFrom: String?,
        notes: String?,
        location: String? = nil,
        details: [String: AnyJSON]? = nil
    ) async throws -> TripItineraryItem {
        struct Patch: Encodable {
            let title: String?
            let time_from: String?
            let notes: String?
            let location: String?
            let details: [String: AnyJSON]?
        }
        return try await db.from("trip_itinerary_items")
            .update(Patch(title: title, time_from: timeFrom, notes: notes, location: location, details: details))
            .eq("id", value: itemId)
            .select(itemColumns)
            .single()
            .execute()
            .value
    }

    // MARK: – Checklist and notes

    static func loadChecklist(journeyId: String) async throws -> [TripChecklistItem] {
        try await db.from("trip_checklist_items")
            .select("id, journey_id, title, category, is_done, sort_order")
            .eq("journey_id", value: journeyId)
            .order("sort_order", ascending: true)
            .execute().value
    }

    static func setChecked(itemId: String, done: Bool) async throws {
        struct Patch: Encodable { let is_done: Bool; let done_at: String? }
        try await db.from("trip_checklist_items")
            .update(Patch(is_done: done,
                          done_at: done ? ISO8601DateFormatter().string(from: .now) : nil))
            .eq("id", value: itemId)
            .execute()
    }

    static func loadNotes(journeyId: String) async throws -> [TripNote] {
        try await db.from("trip_notes")
            .select("id, journey_id, title, body, tag, is_pinned")
            .eq("journey_id", value: journeyId)
            .or("tag.is.null,tag.neq.backup")
            .order("is_pinned", ascending: false)
            .order("created_at", ascending: true)
            .execute().value
    }

    static func addNote(journeyId: String, title: String, body: String?) async throws -> TripNote {
        struct NewNote: Encodable {
            let journey_id: String
            let title: String
            let body: String?
        }
        return try await db.from("trip_notes")
            .insert(NewNote(journey_id: journeyId, title: title, body: body))
            .select("id, journey_id, title, body, tag, is_pinned")
            .single()
            .execute()
            .value
    }

    static func updateNote(noteId: String, title: String? = nil, body: String? = nil, isPinned: Bool? = nil) async throws -> TripNote {
        struct Patch: Encodable {
            let title: String?
            let body: String?
            let is_pinned: Bool?
        }
        return try await db.from("trip_notes")
            .update(Patch(title: title, body: body, is_pinned: isPinned))
            .eq("id", value: noteId)
            .select("id, journey_id, title, body, tag, is_pinned")
            .single()
            .execute()
            .value
    }

    static func deleteNote(noteId: String) async throws {
        try await db.from("trip_notes").delete().eq("id", value: noteId).execute()
    }

    // MARK: – Check-in

    /// The timestamp and who is server-side (the current session's user),
    /// never client-supplied — the same rule the web PATCH route follows.
    static func checkIn(itemId: String) async throws -> TripItineraryItem {
        let userId = try await db.auth.session.user.id.uuidString
        struct Patch: Encodable {
            let checked_in_at: String
            let checked_in_by: String
        }
        return try await db.from("trip_itinerary_items")
            .update(Patch(checked_in_at: ISO8601DateFormatter().string(from: .now), checked_in_by: userId))
            .eq("id", value: itemId)
            .select(itemColumns)
            .single()
            .execute()
            .value
    }
}
