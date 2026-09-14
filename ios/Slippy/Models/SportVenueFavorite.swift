import Foundation

/// Org-shared saved venue (`sport_venue_favorites` table) — lets teammates
/// re-pick a court/field they've used before instead of re-searching MapKit
/// every time they create a sport group.
struct SportVenueFavorite: Codable, Identifiable {
    let id: String
    let organizationId: String
    let createdBy: String
    let name: String
    let address: String?
    let mapUrl: String?
    let latitude: Double?
    let longitude: Double?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, address
        case organizationId = "organization_id"
        case createdBy      = "created_by"
        case mapUrl         = "map_url"
        case latitude, longitude
        case createdAt      = "created_at"
    }
}
