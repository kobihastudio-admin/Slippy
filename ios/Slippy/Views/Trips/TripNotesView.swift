import SwiftUI

/// Full CRUD for trip notes. trip_notes and its RLS already existed
/// (TripItineraryAPI.loadNotes) — this is the write UI that was missing.
struct TripNotesView: View {
    let trip: Trip

    @State private var notes: [TripNote] = []
    @State private var loading = true
    @State private var errorText: String?
    @State private var showAdd = false
    @State private var editing: TripNote?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if notes.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "note.text").font(.system(size: 30)).foregroundColor(Color.textSecondary)
                        Text("ยังไม่มีโน้ต").font(.system(size: 15, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(notes) { note in
                            noteRow(note)
                                .swipeActions {
                                    Button(role: .destructive) { Task { await delete(note) } } label: { Label("ลบ", systemImage: "trash") }
                                    Button { editing = note } label: { Label("แก้ไข", systemImage: "pencil") }.tint(.blue)
                                }
                        }
                    }
                }
            }
            .navigationTitle("โน้ตของทริป")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                }
            }
            .alert("ทำรายการไม่สำเร็จ", isPresented: .constant(errorText != nil)) {
                Button("ตกลง") { errorText = nil }
            } message: { Text(errorText ?? "") }
            .sheet(isPresented: $showAdd) {
                NoteEditSheet(title: "", body: "") { title, body in
                    await add(title: title, body: body)
                }
            }
            .sheet(item: $editing) { note in
                NoteEditSheet(title: note.title, body: note.body ?? "") { title, body in
                    await update(note, title: title, body: body)
                }
            }
            .task { await load() }
        }
    }

    private func noteRow(_ note: TripNote) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { Task { await togglePin(note) } } label: {
                Image(systemName: note.isPinned ? "pin.fill" : "pin")
                    .foregroundColor(note.isPinned ? .orange : Color.textSecondary)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 3) {
                Text(note.title).font(.system(size: 14, weight: .semibold))
                if let body = note.body, !body.isEmpty {
                    Text(body).font(.system(size: 12)).foregroundColor(Color.textSecondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do { notes = try await TripItineraryAPI.loadNotes(journeyId: trip.id) }
        catch { errorText = error.localizedDescription }
    }

    private func add(title: String, body: String) async {
        do {
            let note = try await TripItineraryAPI.addNote(journeyId: trip.id, title: title, body: body.isEmpty ? nil : body)
            notes.insert(note, at: 0)
            hapticSuccess()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func update(_ note: TripNote, title: String, body: String) async {
        do {
            let updated = try await TripItineraryAPI.updateNote(noteId: note.id, title: title, body: body.isEmpty ? nil : body)
            if let idx = notes.firstIndex(where: { $0.id == note.id }) { notes[idx] = updated }
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func togglePin(_ note: TripNote) async {
        let before = notes
        do {
            let updated = try await TripItineraryAPI.updateNote(noteId: note.id, isPinned: !note.isPinned)
            if let idx = notes.firstIndex(where: { $0.id == note.id }) { notes[idx] = updated }
        } catch {
            notes = before
            errorText = error.localizedDescription
        }
    }

    private func delete(_ note: TripNote) async {
        let before = notes
        notes.removeAll { $0.id == note.id }
        do { try await TripItineraryAPI.deleteNote(noteId: note.id) }
        catch { notes = before; errorText = error.localizedDescription }
    }
}

private struct NoteEditSheet: View {
    @State var title: String
    @State var noteBody: String
    let onSave: (String, String) async -> Void

    @State private var saving = false
    @Environment(\.dismiss) private var dismiss

    init(title: String, body: String, onSave: @escaping (String, String) async -> Void) {
        _title = State(initialValue: title)
        _noteBody = State(initialValue: body)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("หัวข้อโน้ต", text: $title)
                TextField("รายละเอียด (ไม่บังคับ)", text: $noteBody, axis: .vertical).lineLimit(3...8)
            }
            .navigationTitle(title.isEmpty ? "เพิ่มโน้ต" : "แก้ไขโน้ต")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังบันทึก…" : "บันทึก") {
                        saving = true
                        Task { await onSave(title.trimmingCharacters(in: .whitespaces), noteBody.trimmingCharacters(in: .whitespaces)); dismiss() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
        }
    }
}
