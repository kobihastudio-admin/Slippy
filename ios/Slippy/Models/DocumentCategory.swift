import Foundation

/// Mirrors the `document_categories` table — org-managed list of bill
/// categories, used as a picker for `documents.doc_category` (which stays
/// free text, not a FK, so existing/AI-extracted values are unaffected).
struct DocumentCategory: Codable, Identifiable, Equatable {
    let id: String
    let organizationId: String
    var name: String
    var sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId = "organization_id"
        case name
        case sortOrder       = "sort_order"
    }
}
