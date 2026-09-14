import Foundation

/// A personal to-do item — deliberately per-user, not organization-scoped
/// (unlike Vendor/TaxView's data). Matches `personal_tasks`
/// (supabase/migrations/20260830090000_personal_tasks.sql). No category,
/// priority, or subtasks — title + done + optional due date is the whole
/// feature, YAGNI'd per the bounded design this was built from.
struct PersonalTask: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let title: String
    let isDone: Bool
    let dueDate: String?
    let createdAt: String
    let completedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case userId      = "user_id"
        case isDone      = "is_done"
        case dueDate     = "due_date"
        case createdAt   = "created_at"
        case completedAt = "completed_at"
    }
}
