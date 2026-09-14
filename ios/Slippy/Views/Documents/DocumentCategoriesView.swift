import SwiftUI

/// Org-level management of `document_categories` — add, rename, delete,
/// reorder. This is the list the category picker in DocumentDetailView's
/// edit mode reads from.
struct DocumentCategoriesView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = DocumentCategoriesViewModel()

    @State private var newName = ""
    @State private var renamingCategory: DocumentCategory?
    @State private var renameText = ""
    @State private var categoryToDelete: DocumentCategory?
    @FocusState private var addFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.categories.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    list
                }
            }
            .navigationTitle("จัดการหมวดหมู่บิล")
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.background)
            .task { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .refreshable { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .alert("เปลี่ยนชื่อหมวดหมู่", isPresented: Binding(
                get: { renamingCategory != nil },
                set: { if !$0 { renamingCategory = nil } }
            )) {
                TextField("ชื่อหมวดหมู่", text: $renameText)
                Button("ยกเลิก", role: .cancel) { renamingCategory = nil }
                Button("บันทึก") {
                    if let cat = renamingCategory {
                        Task { _ = await vm.rename(cat, to: renameText) }
                    }
                    renamingCategory = nil
                }
            }
            .alert("ลบหมวดหมู่นี้?", isPresented: Binding(
                get: { categoryToDelete != nil },
                set: { if !$0 { categoryToDelete = nil } }
            )) {
                Button("ยกเลิก", role: .cancel) { categoryToDelete = nil }
                Button("ลบ", role: .destructive) {
                    if let cat = categoryToDelete {
                        Task { _ = await vm.delete(cat) }
                    }
                    categoryToDelete = nil
                }
            } message: {
                Text("เอกสารที่ใช้หมวดหมู่นี้อยู่แล้วจะไม่ถูกแก้ไข — ลบแค่จากรายการให้เลือกในครั้งถัดไป")
            }
            .alert("เกิดข้อผิดพลาด", isPresented: Binding(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("ตกลง", role: .cancel) { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            // Kept outside the reorderable List below — forcing editMode on
            // the List for drag-to-reorder would otherwise also give this
            // row an unwanted delete circle/reorder handle.
            HStack(spacing: 10) {
                TextField("เพิ่มหมวดหมู่ใหม่", text: $newName)
                    .focused($addFieldFocused)
                    .onSubmit { addCategory() }
                Button {
                    addCategory()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(newName.trimmingCharacters(in: .whitespaces).isEmpty
                                         ? Color.textSecondary.opacity(0.4) : Color.brand500)
                }
                .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
            .background(Color.surface)

            categoryList
        }
    }

    private var categoryList: some View {
        List {
            Section {
                ForEach(vm.categories) { category in
                    HStack {
                        Image(systemName: "folder.fill")
                            .font(.system(size: 14))
                            .foregroundColor(Color.brand500)
                        Text(category.name)
                            .font(.system(size: 14))
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        hapticLight()
                        renameText = category.name
                        renamingCategory = category
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            hapticLight()
                            categoryToDelete = category
                        } label: {
                            Label("ลบ", systemImage: "trash")
                        }
                        Button {
                            hapticLight()
                            renameText = category.name
                            renamingCategory = category
                        } label: {
                            Label("แก้ไข", systemImage: "pencil")
                        }
                        .tint(Color.brand500)
                    }
                }
                .onMove { from, to in
                    var reordered = vm.categories
                    reordered.move(fromOffsets: from, toOffset: to)
                    Task { await vm.reorder(reordered) }
                }
            } header: {
                if !vm.categories.isEmpty {
                    Text("แตะเพื่อเปลี่ยนชื่อ ลากเพื่อจัดเรียง")
                }
            }
        }
        .listStyle(.insetGrouped)
        .environment(\.editMode, .constant(.active))
    }

    private func addCategory() {
        let trimmed = newName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        hapticLight()
        newName = ""
        addFieldFocused = false
        Task { _ = await vm.add(name: trimmed) }
    }
}
