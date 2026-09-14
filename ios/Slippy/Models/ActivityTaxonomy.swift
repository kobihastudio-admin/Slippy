import SwiftUI

/// Native counterpart to `web/src/lib/activity-taxonomy.ts`.
///
/// It is deliberately presentation-only: trip, document, and medication rows
/// retain their existing database/API category values. Unknown legacy values
/// always resolve to `general` so no journey screen can fail to render.
struct ActivityCategoryStyle: Hashable {
    let key: String
    let label: String
    let symbol: String
    let color: Color

    static let transport = ActivityCategoryStyle(key: "transport", label: "การเดินทาง", symbol: "airplane", color: Color(hex: "#0EA5E9"))
    static let place = ActivityCategoryStyle(key: "place", label: "สถานที่และแผนที่", symbol: "mappin.and.ellipse", color: Color(hex: "#6366F1"))
    static let stay = ActivityCategoryStyle(key: "stay", label: "ที่พัก", symbol: "bed.double.fill", color: Color(hex: "#8B5CF6"))
    static let food = ActivityCategoryStyle(key: "food", label: "อาหาร", symbol: "fork.knife", color: Color(hex: "#F97316"))
    static let sightseeing = ActivityCategoryStyle(key: "sightseeing", label: "เที่ยวชม", symbol: "camera.fill", color: Color(hex: "#10B981"))
    static let nature = ActivityCategoryStyle(key: "nature", label: "ธรรมชาติ", symbol: "leaf.fill", color: Color(hex: "#10B981"))
    static let shopping = ActivityCategoryStyle(key: "shopping", label: "ช้อปปิ้ง", symbol: "bag.fill", color: Color(hex: "#D946EF"))
    static let reservation = ActivityCategoryStyle(key: "reservation", label: "ตั๋วและการจอง", symbol: "ticket.fill", color: Color(hex: "#8B5CF6"))
    static let document = ActivityCategoryStyle(key: "document", label: "เอกสาร", symbol: "doc.text.fill", color: Color(hex: "#64748B"))
    static let money = ActivityCategoryStyle(key: "money", label: "ค่าใช้จ่าย", symbol: "wallet.pass.fill", color: Color(hex: "#F59E0B"))
    static let people = ActivityCategoryStyle(key: "people", label: "ทีมและการแชร์", symbol: "person.2.fill", color: Color(hex: "#6366F1"))
    static let safety = ActivityCategoryStyle(key: "safety", label: "ความปลอดภัย", symbol: "shield.checkered", color: Color(hex: "#F43F5E"))
    static let memory = ActivityCategoryStyle(key: "memory", label: "บันทึกการเดินทาง", symbol: "photo.on.rectangle.angled", color: Color(hex: "#8B5CF6"))
    static let health = ActivityCategoryStyle(key: "health", label: "สุขภาพและยา", symbol: "cross.case.fill", color: Color(hex: "#E11D48"))
    static let general = ActivityCategoryStyle(key: "general", label: "อื่นๆ", symbol: "sparkles", color: Color(hex: "#64748B"))

    static let all: [ActivityCategoryStyle] = [
        transport, place, stay, food, sightseeing, nature, shopping,
        reservation, document, money, people, safety, memory, health, general,
    ]

    private static let byKey = Dictionary(uniqueKeysWithValues: all.map { ($0.key, $0) })

    static func forKey(_ raw: String?) -> ActivityCategoryStyle {
        byKey[raw ?? ""] ?? general
    }

    static let medication = health
}
