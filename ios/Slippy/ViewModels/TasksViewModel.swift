import SwiftUI
import Supabase

/// Reads/writes `personal_tasks` — a per-user checklist, not organization
/// data, so unlike VendorsViewModel/TaxViewModel this scopes to `userId`,
/// not `orgId`.
@MainActor
final class TasksViewModel: ObservableObject {
    @Published var tasks: [PersonalTask] = []
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client
    private var userId = ""

    /// Not-done first (soonest due date first, undated last), then done —
    /// so finishing something doesn't make it vanish, just sink below what's
    /// still open.
    var sorted: [PersonalTask] {
        tasks.sorted { a, b in
            if a.isDone != b.isDone { return !a.isDone }
            switch (a.dueDate, b.dueDate) {
            case let (da?, db?): return da < db
            case (nil, nil):     return a.createdAt < b.createdAt
            case (nil, _):       return false
            case (_, nil):       return true
            }
        }
    }

    func load(userId: String) async {
        self.userId = userId
        isLoading = true
        defer { isLoading = false }
        do {
            tasks = try await db
                .from("personal_tasks")
                .select()
                .eq("user_id", value: userId)
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func add(title: String, dueDate: String?) async {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        struct Insert: Encodable {
            let user_id: String
            let title: String
            let due_date: String?
        }
        do {
            let created: PersonalTask = try await db
                .from("personal_tasks")
                .insert(Insert(user_id: userId, title: trimmed, due_date: dueDate))
                .select()
                .single()
                .execute()
                .value
            tasks.insert(created, at: 0)
            hapticSuccess()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggle(_ task: PersonalTask) async {
        let newDone = !task.isDone
        struct Patch: Encodable { let is_done: Bool; let completed_at: String? }
        do {
            let updated: PersonalTask = try await db
                .from("personal_tasks")
                .update(Patch(is_done: newDone, completed_at: newDone ? isoNow() : nil))
                .eq("id", value: task.id)
                .select()
                .single()
                .execute()
                .value
            if let idx = tasks.firstIndex(where: { $0.id == task.id }) {
                tasks[idx] = updated
            }
            hapticLight()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func delete(_ task: PersonalTask) async {
        do {
            try await db.from("personal_tasks").delete().eq("id", value: task.id).execute()
            tasks.removeAll { $0.id == task.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
