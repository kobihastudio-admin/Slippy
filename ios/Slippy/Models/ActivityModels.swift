import Foundation

enum ActivityVisibility: String, Codable, CaseIterable, Hashable {
    case `private`, group, `public`

    var label: String {
        switch self {
        case .private: return "ส่วนตัว"
        case .group: return "เฉพาะกลุ่ม"
        case .public: return "สาธารณะ"
        }
    }
}

enum ActivityStatus: String, Codable, Hashable {
    case draft, published, cancelled, completed
}

struct ActivitySummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    let category: String
    let visibility: ActivityVisibility
    let status: ActivityStatus
    let locationName: String?
    let startsAt: String?
    let sourceType: String

    enum CodingKeys: String, CodingKey {
        case id, title, summary, category, visibility, status
        case locationName = "location_name"
        case startsAt = "starts_at"
        case sourceType = "source_type"
    }

    var startDate: Date? {
        guard let startsAt else { return nil }
        return ISO8601DateFormatter().date(from: startsAt)
    }
}

enum ActivityScope: String, CaseIterable, Identifiable {
    case mine, group, explore
    var id: String { rawValue }

    var label: String {
        switch self {
        case .mine: return "ของฉัน"
        case .group: return "กลุ่ม"
        case .explore: return "ค้นหา"
        }
    }
}
