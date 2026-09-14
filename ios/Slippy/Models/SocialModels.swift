import Foundation

struct Friendship: Codable, Identifiable {
    let id: String
    let requesterId: String
    let addresseeId: String
    let status: String  // pending | accepted | blocked
    let createdAt: String
    var friend: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, status
        case requesterId = "requester_id"
        case addresseeId = "addressee_id"
        case createdAt   = "created_at"
    }
}
