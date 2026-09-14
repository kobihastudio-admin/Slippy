import Foundation
import Supabase

/// Reading a medication label from a photo, from the phone.
///
/// Same reasoning as TripDocumentAPI: this needs the vision model that reads
/// the label, which only exists server-side, so it goes through the web app
/// rather than Supabase directly. Everything else Health does (load/add/log
/// medications) talks to Supabase directly via HealthViewModel — RLS already
/// scopes that — so this is the one call in the Health feature that leaves
/// the device.
enum MedicationScanAPI {

    /// The web app. Overridable so a build can point at a staging deployment —
    /// same mechanism as TripDocumentAPI. Falls back to Config.webAppURL, the
    /// actually-live NAS staging domain — NOT a hardcoded literal, after
    /// discovering TripDocumentAPI's own hardcoded "app.slippy.app" default
    /// is dead (NXDOMAIN, never actually provisioned), which was silently
    /// failing every call that didn't set WEB_BASE_URL.
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

    private static func accessToken() async throws -> String {
        guard let token = try? await SupabaseManager.shared.client.auth.session.accessToken else {
            throw APIError.notSignedIn
        }
        return token
    }

    struct ReadResult: Codable {
        let items: [ScannedMedication]
        let issues: [String]
    }

    /// Uploads a label photo and gets back PROPOSED medications. Writes
    /// nothing — the caller feeds the result into AddMedicationView's
    /// existing review form, same read-only contract as web's
    /// POST /api/medications/scan.
    static func read(imageData: Data, fileName: String, mimeType: String) async throws -> ReadResult {
        guard let url = URL(string: "\(base)/api/medications/scan") else {
            throw APIError.badResponse
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        req.httpBody = body
        // Vision OCR on a label is not fast; the default 60s would report a
        // network failure for a service that is working (same margin
        // TripDocumentAPI.scanReceipt gives the equivalent receipt read).
        req.timeoutInterval = 180

        let (data, response) = try await URLSession.shared.data(for: req)
        try throwIfError(data: data, response: response)
        return try JSONDecoder().decode(ReadResult.self, from: data)
    }

    /// Surfaces the server's own Thai message rather than a status code —
    /// same reasoning as TripDocumentAPI.throwIfError.
    private static func throwIfError(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "อ่านฉลากยาไม่สำเร็จ (\(http.statusCode))")
        }
    }
}
