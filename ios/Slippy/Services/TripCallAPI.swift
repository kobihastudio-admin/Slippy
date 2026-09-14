// ios/Slippy/Services/TripCallAPI.swift
import Foundation

/// Mints a LiveKit join token via the web app — the same reason
/// TripDocumentAPI goes through Next.js instead of Supabase directly:
/// this needs a server secret (LIVEKIT_API_SECRET) the app must never hold.
enum TripCallAPI {
    private static let base: String = {
        ProcessInfo.processInfo.environment["WEB_BASE_URL"] ?? Config.webAppURL.absoluteString
    }()

    enum APIError: LocalizedError {
        case notSignedIn
        case server(String)
        case badResponse
        var errorDescription: String? {
            switch self {
            case .notSignedIn:   return "กรุณาเข้าสู่ระบบใหม่"
            case .server(let m): return m
            case .badResponse:   return "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"
            }
        }
    }

    struct CallToken: Codable {
        let token: String
        let url: String
        let roomName: String
        let callSessionId: String
        enum CodingKeys: String, CodingKey {
            case token, url
            case roomName = "roomName"
            case callSessionId = "callSessionId"
        }
    }

    private static func accessToken() async throws -> String {
        guard let token = try? await SupabaseManager.shared.client.auth.session.accessToken else {
            throw APIError.notSignedIn
        }
        return token
    }

    static func requestToken(tripId: String) async throws -> CallToken {
        guard let url = URL(string: "\(base)/api/trips/\(tripId)/calls/token") else {
            throw APIError.badResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "เข้าร่วมสายไม่สำเร็จ (\(http.statusCode))")
        }
        return try JSONDecoder().decode(CallToken.self, from: data)
    }
}
