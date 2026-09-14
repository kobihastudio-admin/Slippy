import Foundation

enum WatchMessageType: String, Codable {
    case sessionStarted  = "session_started"
    case liveSummary     = "live_summary"
    case sessionEnded    = "session_ended"
    case sessionPaused   = "session_paused"
    case sessionResumed  = "session_resumed"
    /// Phone → Watch: "attach the next workout to this booked sport session"
    /// so shot/HR data can be analyzed alongside its roster/payment info.
    case linkSession     = "link_session"
}

struct WatchMessage: Codable {
    let type: WatchMessageType
    let sessionId: String
    var startedAt: String?
    var endedAt: String?
    var elapsedSeconds: Int?
    var totalShots: Int?
    var smashCount: Int?
    var currentHeartRate: Int?
    var avgHeartRate: Int?
    var maxHeartRate: Int?
    var activeCalories: Double?
    var shots: [ShotEvent]?
    /// `split_bills.id` of the booked sport session this workout is linked to
    /// (set via `.linkSession`, then echoed back on `.sessionStarted`/`.sessionEnded`).
    var linkedSplitBillId: String?
    var linkedTitle: String?
    /// Raw value of `SlippySport` chosen on the Watch before starting —
    /// echoed on `.sessionStarted`/`.sessionEnded` so the phone stores the
    /// sport actually tracked instead of assuming badminton.
    var sport: String?

    func toDictionary() -> [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return dict
    }

    static func from(dictionary: [String: Any]) -> WatchMessage? {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary),
              let msg = try? JSONDecoder().decode(WatchMessage.self, from: data)
        else { return nil }
        return msg
    }
}
