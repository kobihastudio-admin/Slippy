import SwiftUI

/// The "รายงานปัญหา" form: what is wrong (one category) plus an optional note. Sending writes a real row through
/// `DocumentReportService`; the sheet only closes after the database accepted it, and a failure stays on screen with
/// the text the user typed.
struct DocumentReportSheet: View {
    let documentTitle: String
    /// Builds the row to insert from the user's choice, or `nil` when the session/organization is not available.
    let makeInsert: (DocumentReportCategory, String) -> DocumentReport.Insert?
    let onFinished: (DocumentReportService.Outcome) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var category: DocumentReportCategory = .wrongAmount
    @State private var note = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    private var validation: DocumentReport.ValidationError? { DocumentReport.validate(category: category, note: note) }
    private var noteLength: Int { note.unicodeScalars.count }
    private var canSend: Bool { validation == nil && !isSending }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(documentTitle).font(.system(size: 14, weight: .semibold))
                } header: { Text("เอกสาร") }

                Section {
                    ForEach(DocumentReportCategory.allCases) { option in
                        Button {
                            category = option
                            errorMessage = nil
                        } label: {
                            HStack {
                                Text(option.label).foregroundColor(Color.textPrimary)
                                Spacer()
                                if option == category {
                                    Image(systemName: "checkmark").foregroundColor(Color.brand500)
                                }
                            }
                        }
                        .accessibilityAddTraits(option == category ? .isSelected : [])
                    }
                } header: { Text("เกิดปัญหาอะไร") }

                Section {
                    TextEditor(text: $note)
                        .frame(minHeight: 100)
                        .accessibilityLabel("รายละเอียดเพิ่มเติม")
                    if validation == .noteTooLong {
                        Text("ยาวเกินไป (\(noteLength)/\(DocumentReport.maxNoteLength))")
                            .font(.system(size: 12)).foregroundColor(Color.errorText)
                    }
                } header: {
                    Text(category.requiresNote ? "รายละเอียด (จำเป็น)" : "รายละเอียดเพิ่มเติม (ไม่บังคับ)")
                } footer: {
                    Text("ทีมงานจะเห็นรายงานนี้พร้อมรหัสเอกสาร ชื่อร้าน ยอดรวม และสถานะของเอกสาร")
                }

                if let errorMessage {
                    Section { Text(errorMessage).font(.system(size: 13)).foregroundColor(Color.errorText) }
                }
            }
            .navigationTitle("รายงานปัญหา")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }.disabled(isSending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button("ส่งรายงาน") { send() }.disabled(!canSend)
                    }
                }
            }
            .interactiveDismissDisabled(isSending)
        }
    }

    private func send() {
        guard canSend else { return }
        guard let insert = makeInsert(category, note) else {
            errorMessage = "ส่งรายงานไม่ได้ในขณะนี้ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง"
            return
        }
        isSending = true
        errorMessage = nil
        Task {
            defer { isSending = false }
            do {
                let outcome = try await DocumentReportService.submit(insert)
                dismiss()
                onFinished(outcome)
            } catch {
                errorMessage = "ส่งรายงานไม่สำเร็จ: \(error.localizedDescription)"
            }
        }
    }
}
