import SwiftUI

/// How each kind of itinerary item is drawn — the iOS twin of
/// web/src/lib/trips/journey.ts.
///
/// The two have to agree. A shinkansen leg is a red line on the web map and has
/// to be a red line here too, or the same trip looks like two different trips on
/// two devices. Kept as one table for the same reason it is one table there: the
/// timeline, the map and the budget are three readings of the same rows, and if
/// each screen invents its own colours they drift the first time a type is added.
///
/// Mirrors the CHECK constraint in
/// supabase/migrations/20260822120000_trip_journey_structure.sql.
enum JourneyStyle {

    enum Kind { case place, transport, stay, food, admin }

    struct Spec {
        let label: String
        /// SF Symbol name.
        let symbol: String
        let color: Color
        let kind: Kind
    }

    /// Hex values copied from the web's TYPE_SPEC so the two stay identical.
    private static let table: [String: Spec] = [
        "flight":     Spec(label: "เที่ยวบิน",  symbol: "airplane",                    color: Color(hex: "#0EA5E9"), kind: .transport),
        "shinkansen": Spec(label: "ชินคันเซ็น", symbol: "tram.fill",                   color: Color(hex: "#F43F5E"), kind: .transport),
        "train":      Spec(label: "รถไฟ",       symbol: "tram",                        color: Color(hex: "#6366F1"), kind: .transport),
        "subway":     Spec(label: "รถไฟใต้ดิน", symbol: "tram.tunnel.fill",            color: Color(hex: "#818CF8"), kind: .transport),
        "ferry":      Spec(label: "เรือเฟอร์รี", symbol: "ferry.fill",                  color: Color(hex: "#06B6D4"), kind: .transport),
        "bus":        Spec(label: "รถบัส",      symbol: "bus.fill",                    color: Color(hex: "#14B8A6"), kind: .transport),
        "car_rental": Spec(label: "รถเช่า",     symbol: "car.fill",                    color: Color(hex: "#64748B"), kind: .transport),
        "taxi":       Spec(label: "แท็กซี่",    symbol: "car.side.fill",               color: Color(hex: "#F59E0B"), kind: .transport),
        "walk":       Spec(label: "เดิน",       symbol: "figure.walk",                 color: Color(hex: "#94A3B8"), kind: .transport),
        "transport":  Spec(label: "การเดินทาง", symbol: "bus.fill",                    color: Color(hex: "#14B8A6"), kind: .transport),

        "hotel":      Spec(label: "ที่พัก",     symbol: "bed.double.fill",             color: Color(hex: "#8B5CF6"), kind: .stay),

        "restaurant": Spec(label: "ร้านอาหาร",  symbol: "fork.knife",                  color: Color(hex: "#F97316"), kind: .food),
        "meal":       Spec(label: "มื้ออาหาร",  symbol: "cup.and.saucer.fill",         color: Color(hex: "#FB923C"), kind: .food),

        "activity":   Spec(label: "กิจกรรม",    symbol: "star.fill",                   color: Color(hex: "#10B981"), kind: .place),
        "onsen":      Spec(label: "ออนเซ็น",    symbol: "drop.fill",                   color: Color(hex: "#22D3EE"), kind: .place),
        "shopping":   Spec(label: "ช้อปปิ้ง",   symbol: "bag.fill",                    color: Color(hex: "#D946EF"), kind: .place),

        "booking":    Spec(label: "การจอง",     symbol: "doc.text.fill",               color: Color(hex: "#94A3B8"), kind: .admin),
        "note":       Spec(label: "โน้ต",       symbol: "note.text",                   color: Color(hex: "#94A3B8"), kind: .admin),
        "free_time":  Spec(label: "เวลาว่าง",   symbol: "clock",                       color: Color(hex: "#94A3B8"), kind: .admin),
        "other":      Spec(label: "อื่นๆ",      symbol: "mappin",                      color: Color(hex: "#94A3B8"), kind: .admin),
    ]

    private static let fallback = Spec(label: "อื่นๆ", symbol: "mappin",
                                       color: Color(hex: "#94A3B8"), kind: .admin)

    /// Never throws on an unknown type — a value added in SQL before it is added
    /// here degrades to a neutral pin rather than crashing the map.
    static func spec(_ type: String) -> Spec { table[type] ?? fallback }

    /// The types that can be created from the app's own "add stop" flow.
    /// Deliberately shorter than the full list: a flight or a hotel comes from a
    /// document import or a booking, not from tapping a map.
    static let creatable: [String] = [
        "activity", "restaurant", "meal", "shopping", "onsen",
        "hotel", "train", "subway", "bus", "taxi", "walk", "other",
    ]

    static let statusLabel: [String: String] = [
        "planned": "ยังไม่จอง", "confirmed": "จองแล้ว",
        "optional": "ถ้ามีเวลา", "cancelled": "ยกเลิก",
    ]

    static func categoryLabel(_ kind: Kind) -> String {
        switch kind {
        case .stay:      return ActivityCategoryStyle.stay.label
        case .transport: return ActivityCategoryStyle.transport.label
        case .food:      return ActivityCategoryStyle.food.label
        case .place:     return ActivityCategoryStyle.sightseeing.label
        case .admin:     return ActivityCategoryStyle.general.label
        }
    }

    /// Keeps legacy itinerary types intact while sharing the same high-level
    /// category keys used on the Web. Callers that need the exact train/hotel
    /// icon should continue to use `spec(_:)`.
    static func activityCategory(_ type: String) -> ActivityCategoryStyle {
        switch spec(type).kind {
        case .transport: return .transport
        case .stay:      return .stay
        case .food:      return .food
        case .place:     return type == "shopping" ? .shopping : .sightseeing
        case .admin:     return type == "booking" ? .reservation : .general
        }
    }
}
