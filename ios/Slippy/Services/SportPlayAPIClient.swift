import Foundation

final class SportPlayAPIClient {
    static let shared = SportPlayAPIClient()

    private let base: String = {
        ProcessInfo.processInfo.environment["API_BASE_URL"]
            ?? "https://slippy-api.vercel.app"
    }()

    // MARK: – Create session

    func createSession(startedAt: Date) async throws -> String {
        let body: [String: Any] = [
            "sport":     "badminton",
            "source":    "apple_watch",
            "startedAt": ISO8601DateFormatter().string(from: startedAt)
        ]
        let resp = try await post(path: "/v1/sport-play/sessions", body: body)
        guard let id = resp["id"] as? String else { throw APIError.invalidResponse }
        return id
    }

    // MARK: – Upload shots

    func uploadShots(sessionId: String, shots: [ShotEvent]) async throws {
        let formatter = ISO8601DateFormatter()
        let rows = shots.map { s -> [String: Any] in
            [
                "timestamp":        formatter.string(from: s.timestamp),
                "shotType":         s.shotType.rawValue,
                "confidence":       s.confidence,
                "peakAcceleration": s.peakAcceleration,
                "peakGyro":         s.peakGyro,
                "energy":           s.energy
            ]
        }
        _ = try await post(path: "/v1/sport-play/sessions/\(sessionId)/shots/batch",
                           body: ["shots": rows])
    }

    // MARK: – Complete session

    func completeSession(sessionId: String, session: SportSession) async throws {
        let formatter = ISO8601DateFormatter()
        var body: [String: Any] = [
            "endedAt":         formatter.string(from: session.endedAt ?? .now),
            "durationSeconds": session.durationSeconds ?? 0,
            "totalShots":      session.totalShots,
            "smashCount":      session.smashCount,
        ]
        if let avgHR = session.avgHeartRate  { body["avgHeartRate"]   = avgHR }
        if let maxHR = session.maxHeartRate  { body["maxHeartRate"]   = maxHR }
        if let cal   = session.activeCalories { body["activeCalories"] = cal }

        _ = try await patch(path: "/v1/sport-play/sessions/\(sessionId)/complete", body: body)
    }

    // MARK: – Fetch dashboard

    func fetchDashboard(range: String = "30d") async throws -> [String: Any] {
        try await get(path: "/v1/sport-play/dashboard?range=\(range)")
    }

    // MARK: – Generate AI insight

    func generateInsight(sessionId: String) async throws -> [String: Any] {
        try await post(path: "/v1/sport-play/sessions/\(sessionId)/ai-insight", body: [:])
    }

    // MARK: – HTTP helpers

    private func authHeader() async -> String? {
        let session = SupabaseManager.shared.client.auth.currentSession
        return session.map { "Bearer \($0.accessToken)" }
    }

    private func get(path: String) async throws -> [String: Any] {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        if let auth = await authHeader() { req.setValue(auth, forHTTPHeaderField: "Authorization") }
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func post(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let auth = await authHeader() { req.setValue(auth, forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func patch(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let auth = await authHeader() { req.setValue(auth, forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    enum APIError: Error {
        case badURL, invalidResponse
    }
}
