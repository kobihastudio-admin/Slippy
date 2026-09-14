import Foundation

enum SessionStatus: String, Codable {
    case active    = "active"
    case paused    = "paused"
    case completed = "completed"
    case failed    = "failed"
}

enum SyncStatus: String, Codable {
    case pending  = "pending"
    case syncing  = "syncing"
    case synced   = "synced"
    case failed   = "failed"
}

struct SportSession: Codable, Identifiable {
    let id: UUID
    var status: SessionStatus
    var syncStatus: SyncStatus
    let startedAt: Date
    var endedAt: Date?
    var durationSeconds: Int?

    var totalShots: Int
    var smashCount: Int
    var avgHeartRate: Int?
    var maxHeartRate: Int?
    var activeCalories: Double?
    var shots: [ShotEvent]

    /// Raw value of `SlippySport` — defaults to badminton for sessions
    /// recorded before this field existed (see custom `init(from:)` below).
    var sport: String

    /// `split_bills.id` of the booked sport session this workout was attached
    /// to on the Watch (nil when started without linking to a booking).
    var linkedSplitBillId: String?

    // On-device AI insight (`AIInsightGenerator`), cached locally alongside
    // the row that's also upserted to `sport_play_ai_insights` so the summary
    // screen can show it without a network round-trip.
    var insightText: String?
    var skillScore: Int?
    var powerScore: Int?
    var staminaScore: Int?
    var consistencyScore: Int?

    var smashRatio: Double {
        guard totalShots > 0 else { return 0 }
        return Double(smashCount) / Double(totalShots)
    }

    var durationFormatted: String {
        let secs = durationSeconds ?? 0
        let h = secs / 3600
        let m = (secs % 3600) / 60
        let s = secs % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }

    init() {
        self.id           = UUID()
        self.status       = .active
        self.syncStatus   = .pending
        self.startedAt    = .now
        self.totalShots   = 0
        self.smashCount   = 0
        self.shots        = []
        self.sport        = SlippySport.badminton.rawValue
    }

    // Custom decode so sessions cached locally before `sport`/insight fields
    // existed (UserDefaults via PlaySessionStore) still load instead of
    // failing JSONDecoder entirely and silently wiping local history.
    enum CodingKeys: String, CodingKey {
        case id, status, syncStatus, startedAt, endedAt, durationSeconds
        case totalShots, smashCount, avgHeartRate, maxHeartRate, activeCalories, shots
        case sport, linkedSplitBillId
        case insightText, skillScore, powerScore, staminaScore, consistencyScore
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id              = try c.decode(UUID.self, forKey: .id)
        status          = try c.decode(SessionStatus.self, forKey: .status)
        syncStatus      = try c.decode(SyncStatus.self, forKey: .syncStatus)
        startedAt       = try c.decode(Date.self, forKey: .startedAt)
        endedAt         = try c.decodeIfPresent(Date.self, forKey: .endedAt)
        durationSeconds = try c.decodeIfPresent(Int.self, forKey: .durationSeconds)
        totalShots      = try c.decode(Int.self, forKey: .totalShots)
        smashCount      = try c.decode(Int.self, forKey: .smashCount)
        avgHeartRate    = try c.decodeIfPresent(Int.self, forKey: .avgHeartRate)
        maxHeartRate    = try c.decodeIfPresent(Int.self, forKey: .maxHeartRate)
        activeCalories  = try c.decodeIfPresent(Double.self, forKey: .activeCalories)
        shots           = try c.decodeIfPresent([ShotEvent].self, forKey: .shots) ?? []
        sport           = try c.decodeIfPresent(String.self, forKey: .sport) ?? SlippySport.badminton.rawValue
        linkedSplitBillId = try c.decodeIfPresent(String.self, forKey: .linkedSplitBillId)
        insightText       = try c.decodeIfPresent(String.self, forKey: .insightText)
        skillScore        = try c.decodeIfPresent(Int.self, forKey: .skillScore)
        powerScore        = try c.decodeIfPresent(Int.self, forKey: .powerScore)
        staminaScore      = try c.decodeIfPresent(Int.self, forKey: .staminaScore)
        consistencyScore  = try c.decodeIfPresent(Int.self, forKey: .consistencyScore)
    }
}
