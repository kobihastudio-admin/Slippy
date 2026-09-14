import Foundation

enum ShotType: String, Codable, CaseIterable {
    case unknown      = "unknown"
    case smash        = "smash"
    case clear        = "clear"
    case drive        = "drive"
    case drop         = "drop"
    case netShot      = "net_shot"
    case serve        = "serve"
}

struct ShotEvent: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let shotType: ShotType
    let confidence: Double
    let peakAcceleration: Double
    let peakGyro: Double
    let energy: Double

    init(timestamp: Date = .now,
         shotType: ShotType,
         confidence: Double,
         peakAcceleration: Double,
         peakGyro: Double,
         energy: Double) {
        self.id               = UUID()
        self.timestamp        = timestamp
        self.shotType         = shotType
        self.confidence       = confidence
        self.peakAcceleration = peakAcceleration
        self.peakGyro         = peakGyro
        self.energy           = energy
    }
}
