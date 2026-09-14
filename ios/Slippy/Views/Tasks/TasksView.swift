import SwiftUI

private let tasksBlue = Color(hex: "#2563eb")

/// "ภารกิจ" — a personal checklist. No NavigationStack of its own: always
/// reached via a NavigationLink push from Dashboard or the "เพิ่มเติม" hub,
/// both of which already own one (see TripsView/HealthView's own notes on
/// the nested-NavigationStack bug this avoids).
struct TasksView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = TasksViewModel()
    @State private var showAdd = false

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    var body: some View {
        ZStack {
            Color.background.ignoresSafeArea()

            if vm.isLoading && vm.tasks.isEmpty {
                ProgressView().tint(tasksBlue)
            } else if vm.tasks.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .navigationTitle("ภารกิจ")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    hapticLight()
                    showAdd = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(tasksBlue)
                }
            }
        }
        .task {
            guard !userId.isEmpty else { return }
            await vm.load(userId: userId)
        }
        .refreshable {
            guard !userId.isEmpty else { return }
            await vm.load(userId: userId)
        }
        .sheet(isPresented: $showAdd) {
            AddTaskSheet { title, dueDate in
                await vm.add(title: title, dueDate: dueDate)
            }
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(vm.sorted) { task in
                    TaskRow(task: task) {
                        Task { await vm.toggle(task) }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            Task { await vm.delete(task) }
                        } label: {
                            Label("ลบ", systemImage: "trash")
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Text("✅")
                .font(.system(size: 56))
            Text("ยังไม่มีภารกิจ")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(Color.textPrimary)
            Text("เพิ่มสิ่งที่ต้องทำได้เลย")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
            Button {
                hapticLight()
                showAdd = true
            } label: {
                Label("เพิ่มภารกิจ", systemImage: "plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(tasksBlue)
                    .clipShape(Capsule())
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: – Row

private struct TaskRow: View {
    let task: PersonalTask
    let onToggle: () -> Void

    private var dueLabel: String? {
        guard let due = task.dueDate else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: due) else { return due }
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "th_TH")
        let overdue = !task.isDone && date < Calendar.current.startOfDay(for: Date())
        return (overdue ? "เลยกำหนด " : "") + f.string(from: date)
    }

    private var isOverdue: Bool {
        guard let due = task.dueDate, !task.isDone else { return false }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: due) else { return false }
        return date < Calendar.current.startOfDay(for: Date())
    }

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundColor(task.isDone ? .green : Color.border)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundColor(task.isDone ? Color.textSecondary : Color.textPrimary)
                    .strikethrough(task.isDone)
                if let dueLabel {
                    Text(dueLabel)
                        .font(.system(size: 11.5))
                        .foregroundColor(isOverdue ? .red : Color.textSecondary)
                }
            }
            Spacer()
        }
        .padding(14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
    }
}

// MARK: – Add sheet

private struct AddTaskSheet: View {
    let onSave: (String, String?) async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var hasDueDate = false
    @State private var dueDate = Date()
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("ภารกิจ") {
                    TextField("เช่น จ่ายบิลค่าน้ำ", text: $title)
                }
                Section {
                    Toggle("กำหนดวันครบกำหนด", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("วันครบกำหนด", selection: $dueDate, displayedComponents: .date)
                    }
                }
            }
            .navigationTitle("เพิ่มภารกิจ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saving = true
                        Task {
                            await onSave(title, hasDueDate ? Self.isoDateString(from: dueDate) : nil)
                            saving = false
                            dismiss()
                        }
                    } label: {
                        if saving { ProgressView() } else { Text("บันทึก").bold() }
                    }
                    .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private static func isoDateString(from date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }
}
