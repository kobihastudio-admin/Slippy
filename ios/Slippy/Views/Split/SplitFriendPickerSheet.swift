import SwiftUI
import Contacts
import ContactsUI

struct SplitFriendPickerSheet: View {
    let accountID: String
    let onAdd: (String, Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var friends: [LocalSplitFriend] = []
    @State private var name = ""
    @State private var lineID = ""
    @State private var amount = ""
    @State private var search = ""
    @State private var error: String?
    @State private var showContacts = false
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case name, line, amount, search }
    private let store = LocalSplitFriendStore()

    private var filteredFriends: [LocalSplitFriend] {
        guard !search.isEmpty else { return friends }
        return friends.filter {
            $0.name.localizedCaseInsensitiveContains(search) || $0.lineID.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(Color.statusFailed) }
                Section("เพิ่มเพื่อน") {
                    TextField("ชื่อ", text: $name)
                        .focused($focusedField, equals: .name)
                        .accessibilityIdentifier("split.friend.name")
                    TextField("LINE ID (ไม่บังคับ)", text: $lineID)
                        .focused($focusedField, equals: .line)
                        .accessibilityIdentifier("split.friend.line")
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("จำนวนเงิน (เว้นว่างเพื่อหารเท่ากัน)", text: $amount)
                        .focused($focusedField, equals: .amount)
                        .keyboardType(.decimalPad)
                    Button { showContacts = true } label: {
                        Label("เลือกจาก Contacts", systemImage: "person.crop.rectangle")
                    }
                    .accessibilityIdentifier("split.friend.contacts")
                    Button {
                        do {
                            let value = try parsedAmount()
                            let friend = try store.save(name: name, lineID: lineID, accountID: accountID)
                            onAdd(friend.name, value)
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                    } label: {
                        Label("บันทึกเพื่อนและเพิ่มในบิล", systemImage: "person.badge.plus")
                    }
                    .disabled(accountID.isEmpty)
                    .accessibilityIdentifier("split.friend.save")
                }
                Section("เพื่อนที่บันทึกไว้บนเครื่อง") {
                    TextField("ค้นหาชื่อหรือ LINE ID", text: $search)
                        .focused($focusedField, equals: .search)
                        .accessibilityIdentifier("split.friend.search")
                    ForEach(filteredFriends) { friend in
                        Button {
                            do {
                                onAdd(friend.name, try parsedAmount())
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(friend.name).foregroundStyle(Color.textPrimary)
                                if !friend.lineID.isEmpty {
                                    Text(friend.lineID).font(.caption).foregroundStyle(Color.textSecondary)
                                }
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                do {
                                    try store.remove(id: friend.id, accountID: accountID)
                                    friends = try store.load(accountID: accountID)
                                } catch { self.error = error.localizedDescription }
                            } label: { Label("ลบ", systemImage: "trash") }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.immediately)
            .background(Color.background)
            .navigationTitle("เลือกเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button { focusedField = nil } label: {
                        Image(systemName: "keyboard.chevron.compact.down")
                    }
                    .accessibilityLabel("ซ่อนแป้นพิมพ์")
                    .accessibilityIdentifier("split.friend.dismissKeyboard")
                }
            }
            .onAppear {
                do { friends = try store.load(accountID: accountID) }
                catch { self.error = error.localizedDescription }
            }
            .sheet(isPresented: $showContacts) {
                SplitContactPicker(onCancel: { showContacts = false }) { selectedName in
                    name = selectedName
                    lineID = ""
                    showContacts = false
                }
            }
        }
    }

    private func parsedAmount() throws -> Double {
        let text = amount.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: "")
        if text.isEmpty { return 0 }
        guard let value = Double(text), value.isFinite, value >= 0 else {
            throw AmountError.invalid
        }
        return value
    }

    private enum AmountError: LocalizedError {
        case invalid
        var errorDescription: String? { "กรุณากรอกจำนวนเงินตั้งแต่ 0 ขึ้นไป" }
    }
}

private struct SplitContactPicker: UIViewControllerRepresentable {
    let onCancel: () -> Void
    let onSelect: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCancel: onCancel, onSelect: onSelect) }
    func makeUIViewController(context: Context) -> HostController {
        let picker = CNContactPickerViewController()
        picker.delegate = context.coordinator
        picker.modalPresentationStyle = .fullScreen
        picker.view.accessibilityIdentifier = "split.contacts.picker"
        let host = HostController()
        host.picker = picker
        return host
    }
    func updateUIViewController(_ controller: HostController, context: Context) {}

    // Contacts dismisses its own presenting controller. Keep that separate
    // from SwiftUI's sheet so cancelling cannot dismiss the friend editor.
    final class HostController: UIViewController {
        var picker: CNContactPickerViewController?
        private var hasPresented = false

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard !hasPresented, let picker else { return }
            hasPresented = true
            present(picker, animated: false)
        }
    }

    final class Coordinator: NSObject, CNContactPickerDelegate {
        let onCancel: () -> Void
        let onSelect: (String) -> Void
        init(onCancel: @escaping () -> Void, onSelect: @escaping (String) -> Void) {
            self.onCancel = onCancel
            self.onSelect = onSelect
        }
        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { onCancel() }
        func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
            onSelect(CNContactFormatter.string(from: contact, style: .fullName) ?? contact.organizationName)
        }
    }
}
