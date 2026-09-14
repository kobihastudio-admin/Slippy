import Foundation

enum DominantHand: String, Codable, CaseIterable {
    case right = "right"
    case left  = "left"

    var displayName: String {
        switch self {
        case .right: return "มือขวา"
        case .left:  return "มือซ้าย"
        }
    }
}

enum SkillLevel: String, Codable, CaseIterable {
    case beginner     = "beginner"
    case casual       = "casual"
    case intermediate = "intermediate"
    case advanced     = "advanced"
    case competitive  = "competitive"

    var displayName: String {
        switch self {
        case .beginner:     return "มือใหม่"
        case .casual:       return "เล่นสบายๆ"
        case .intermediate: return "ปานกลาง"
        case .advanced:     return "ขั้นสูง"
        case .competitive:  return "แข่งขัน"
        }
    }
}

struct PlayerSportProfile: Codable {
    var displayName: String
    var dominantHand: DominantHand
    var skillLevel: SkillLevel
    var primarySport: String
    var clubName: String?
    var isWatchConnected: Bool

    init(displayName: String = "",
         dominantHand: DominantHand = .right,
         skillLevel: SkillLevel = .casual) {
        self.displayName      = displayName
        self.dominantHand     = dominantHand
        self.skillLevel       = skillLevel
        self.primarySport     = "badminton"
        self.isWatchConnected = false
    }

    static var placeholder: PlayerSportProfile {
        PlayerSportProfile(displayName: "ผู้เล่น", dominantHand: .right, skillLevel: .casual)
    }
}
