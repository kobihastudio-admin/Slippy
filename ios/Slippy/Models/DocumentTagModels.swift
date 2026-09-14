import Foundation

/// See supabase/migrations/078_document_tags_and_shares.sql

struct DocumentTag: Codable, Identifiable, Hashable {
    let id: String
    let organizationId: String
    let name: String
    enum CodingKeys: String, CodingKey {
        case id, name
        case organizationId = "organization_id"
    }
}

struct DocumentShare: Codable, Identifiable {
    let id: String
    let documentId: String
    let sharedWithUserId: String
    let permission: String
    enum CodingKeys: String, CodingKey {
        case id, permission
        case documentId = "document_id"
        case sharedWithUserId = "shared_with_user_id"
    }
}
