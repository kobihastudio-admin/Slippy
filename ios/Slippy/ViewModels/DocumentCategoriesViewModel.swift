import SwiftUI
import Supabase

/// Reads/writes `document_categories` — the org-managed list backing the
/// category picker in DocumentDetailView's edit mode and the standalone
/// "จัดการหมวดหมู่" management screen.
@MainActor
final class DocumentCategoriesViewModel: ObservableObject {
    @Published var categories: [DocumentCategory] = []
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client
    private var orgId = ""

    func load(orgId: String) async {
        self.orgId = orgId
        isLoading = true
        defer { isLoading = false }
        do {
            categories = try await db
                .from("document_categories")
                .select()
                .eq("organization_id", value: orgId)
                .order("sort_order", ascending: true)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func add(name: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        struct NewCategory: Encodable {
            let organization_id: String
            let name: String
            let sort_order: Int
        }
        do {
            let nextOrder = (categories.map(\.sortOrder).max() ?? -1) + 1
            let inserted: [DocumentCategory] = try await db
                .from("document_categories")
                .insert(NewCategory(organization_id: orgId, name: trimmed, sort_order: nextOrder))
                .select()
                .execute()
                .value
            if let new = inserted.first {
                categories.append(new)
            }
            return true
        } catch {
            self.error = "เพิ่มหมวดหมู่ไม่สำเร็จ: \(error.localizedDescription)"
            return false
        }
    }

    func rename(_ category: DocumentCategory, to newName: String) async -> Bool {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        struct Patch: Encodable { let name: String }
        do {
            try await db
                .from("document_categories")
                .update(Patch(name: trimmed))
                .eq("id", value: category.id)
                .execute()
            if let idx = categories.firstIndex(where: { $0.id == category.id }) {
                categories[idx].name = trimmed
            }
            return true
        } catch {
            self.error = "แก้ไขหมวดหมู่ไม่สำเร็จ: \(error.localizedDescription)"
            return false
        }
    }

    func delete(_ category: DocumentCategory) async -> Bool {
        do {
            try await db
                .from("document_categories")
                .delete()
                .eq("id", value: category.id)
                .execute()
            categories.removeAll { $0.id == category.id }
            return true
        } catch {
            self.error = "ลบหมวดหมู่ไม่สำเร็จ: \(error.localizedDescription)"
            return false
        }
    }

    /// Persists the on-screen order after a drag-to-reorder.
    func reorder(_ newOrder: [DocumentCategory]) async {
        categories = newOrder
        struct Patch: Encodable { let id: String; let sort_order: Int }
        let patches = newOrder.enumerated().map { idx, c in Patch(id: c.id, sort_order: idx) }
        for patch in patches {
            _ = try? await db
                .from("document_categories")
                .update(["sort_order": patch.sort_order])
                .eq("id", value: patch.id)
                .execute()
        }
    }
}
