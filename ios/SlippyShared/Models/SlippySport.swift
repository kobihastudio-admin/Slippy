import Foundation

/// Sports trackable via Slippy Play on Apple Watch. Kept sport-agnostic at
/// the model layer (no HealthKit import here) — `WatchWorkoutManager` maps
/// each case to the matching `HKWorkoutActivityType`.
enum SlippySport: String, Codable, CaseIterable, Identifiable {
    case badminton
    case tennis
    case tableTennis = "table_tennis"
    case squash
    case general

    var id: String { rawValue }

    var label: String {
        switch self {
        case .badminton:   return "แบดมินตัน"
        case .tennis:      return "เทนนิส"
        case .tableTennis: return "ปิงปอง"
        case .squash:      return "สควอช"
        case .general:     return "ทั่วไป"
        }
    }

    var emoji: String {
        switch self {
        case .badminton:   return "🏸"
        case .tennis:      return "🎾"
        case .tableTennis: return "🏓"
        case .squash:      return "🎯"
        case .general:     return "🏃"
        }
    }
}
