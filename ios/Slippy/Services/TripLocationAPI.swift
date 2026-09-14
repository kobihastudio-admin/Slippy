// ios/Slippy/Services/TripLocationAPI.swift
import Foundation
import Supabase
import CoreLocation

/// Temporary, opt-in, trip-scoped live location — writes go straight to
/// Supabase, the same as TripItineraryAPI, because 094_trip_participant_scoped_rls.sql
/// already enforces "a trip belongs to whoever is on it" at the database
/// level. See docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md §6.
///
/// `TRIP_FEATURE_LIVE_LOCATION` kill switch: since writes bypass the web
/// app entirely, iOS has no server-side gate on them the way web's API
/// routes do. isFeatureEnabled(tripId:) probes the existing
/// GET /api/trips/{id}/location-sessions route — which already checks this
/// flag before anything else — purely to read that same flag before this
/// enum writes anything. Fails CLOSED (treats any non-200 response, or a
/// network error, as "disabled") so a flag flip or a flaky network both err
/// toward not transmitting location, never toward transmitting anyway.
@MainActor
enum TripLocationAPI {
    private static var db: SupabaseClient { SupabaseManager.shared.client }

    private static let webBase: String = {
        ProcessInfo.processInfo.environment["WEB_BASE_URL"] ?? Config.webAppURL.absoluteString
    }()

    static func isFeatureEnabled(tripId: String) async -> Bool {
        guard let url = URL(string: "\(webBase)/api/trips/\(tripId)/location-sessions"),
              let token = try? await db.auth.session.accessToken else { return false }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 10
        guard let (_, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }

    enum Duration: String { case m15 = "15m", h1 = "1h", h4 = "4h", eod = "eod" }

    struct Session: Codable {
        let id: String
        let expiresAt: String
        enum CodingKeys: String, CodingKey { case id; case expiresAt = "expires_at" }
    }

    static func start(journeyId: String, duration: Duration) async throws -> Session {
        let userId = try await db.auth.session.user.id.uuidString
        struct NewSession: Encodable { let journey_id: String; let user_id: String; let expires_at: String }
        return try await db.from("trip_location_sessions")
            .insert(NewSession(journey_id: journeyId, user_id: userId, expires_at: expiresAt(duration)))
            .select("id, expires_at")
            .single()
            .execute()
            .value
    }

    static func stop(sessionId: String) async throws {
        let userId = try await db.auth.session.user.id.uuidString
        struct Patch: Encodable { let stopped_at: String }
        _ = try await db.from("trip_location_sessions")
            .update(Patch(stopped_at: ISO8601DateFormatter().string(from: Date())))
            .eq("id", value: sessionId)
            .eq("user_id", value: userId)
            .execute()
    }

    static func ping(
        sessionId: String, journeyId: String, coordinate: CLLocationCoordinate2D,
        accuracy: Double?, heading: Double?, speed: Double?
    ) async throws {
        let userId = try await db.auth.session.user.id.uuidString
        struct Point: Encodable {
            let session_id: String, journey_id: String, user_id: String
            let latitude: Double, longitude: Double
            let accuracy_m: Double?, heading: Double?, speed_mps: Double?
            let recorded_at: String
        }
        _ = try await db.from("trip_member_locations")
            .upsert(Point(session_id: sessionId, journey_id: journeyId, user_id: userId,
                          latitude: coordinate.latitude, longitude: coordinate.longitude,
                          accuracy_m: accuracy, heading: heading, speed_mps: speed,
                          recorded_at: ISO8601DateFormatter().string(from: Date())),
                    onConflict: "session_id")
            .execute()
    }

    struct MemberLocation: Identifiable {
        var id: String { sessionId }
        let sessionId: String
        let userId: String
        let latitude: Double
        let longitude: Double
        let recordedAt: String
    }

    private struct SessionRow: Decodable { let id: String; let stoppedAt: String?
        enum CodingKeys: String, CodingKey { case id; case stoppedAt = "stopped_at" }
    }
    private struct LocationRow: Decodable {
        let sessionId: String, userId: String, latitude: Double, longitude: Double, recordedAt: String
        enum CodingKeys: String, CodingKey {
            case sessionId = "session_id", userId = "user_id", latitude, longitude
            case recordedAt = "recorded_at"
        }
    }

    /// Two queries, not one embedded-resource query — same reasoning as the
    /// web equivalent in location-sharing.ts.
    static func activeLocations(journeyId: String) async throws -> [MemberLocation] {
        let nowIso = ISO8601DateFormatter().string(from: Date())
        let sessions: [SessionRow] = try await db.from("trip_location_sessions")
            .select("id, stopped_at")
            .eq("journey_id", value: journeyId)
            .gt("expires_at", value: nowIso)
            .execute()
            .value
        let activeIds = sessions.filter { $0.stoppedAt == nil }.map(\.id)
        guard !activeIds.isEmpty else { return [] }

        let rows: [LocationRow] = try await db.from("trip_member_locations")
            .select("session_id, user_id, latitude, longitude, recorded_at")
            .in("session_id", values: activeIds)
            .execute()
            .value
        return rows.map { MemberLocation(sessionId: $0.sessionId, userId: $0.userId, latitude: $0.latitude, longitude: $0.longitude, recordedAt: $0.recordedAt) }
    }

    private static func expiresAt(_ duration: Duration) -> String {
        let now = Date()
        switch duration {
        case .m15: return ISO8601DateFormatter().string(from: now.addingTimeInterval(15 * 60))
        case .h1:  return ISO8601DateFormatter().string(from: now.addingTimeInterval(60 * 60))
        case .h4:  return ISO8601DateFormatter().string(from: now.addingTimeInterval(4 * 60 * 60))
        case .eod:
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "Asia/Bangkok")!
            let endOfDay = cal.date(bySettingHour: 23, minute: 59, second: 59, of: now) ?? now
            return ISO8601DateFormatter().string(from: endOfDay)
        }
    }
}
