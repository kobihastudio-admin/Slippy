import SwiftUI

struct FriendManagementView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var social = SocialViewModel()
    @State private var local: [LocalSplitFriend] = []
    @State private var filter = 0
    @State private var search = ""
    @State private var editor: LocalSplitFriend?
    @State private var adding = false
    @State private var removing: LocalSplitFriend?
    @State private var removingProfile: UserProfile?
    @State private var error: String?
    @State private var busy = false
    private let store = LocalSplitFriendStore()

    private var preview: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["SLIPPY_APPEARANCE_PREVIEW"] == "friends-management-test"
        #else
        false
        #endif
    }
    private var accountID: String { preview ? "friend-management-uitest" : authVM.session?.user.id.uuidString ?? "" }
    private func matches(_ values: String...) -> Bool {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty || values.contains { $0.localizedCaseInsensitiveContains(query) }
    }
    private var profiles: [UserProfile] { social.friends.filter { matches($0.displayName, $0.email) } }
    private var guests: [LocalSplitFriend] { local.filter { matches($0.name, $0.lineID) } }

    var body: some View {
        List {
            Section {
                Picker("ประเภทเพื่อน", selection: $filter) {
                    Text("ทั้งหมด").tag(0)
                    Text("ในระบบ").tag(1)
                    Text("นอกระบบ").tag(2)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("friends.filter")
            }
            if let message = error ?? social.errorMessage {
                Section {
                    Text(message).foregroundStyle(Color.statusFailed)
                    Button { Task { await reload() } } label: { Label("ลองอีกครั้ง", systemImage: "arrow.clockwise") }
                }
            }
            if accountID.isEmpty {
                Text("กรุณาเข้าสู่ระบบ").foregroundStyle(Color.textSecondary)
            } else {
                if filter != 2 {
                    Section("ในระบบ · \(profiles.count)") {
                        if social.isLoading { ProgressView() }
                        ForEach(profiles) { profile in
                            NavigationLink {
                                Form {
                                    Section("ข้อมูลเพื่อน") { Text(profile.displayName) }
                                    channels(email: profile.email, line: "")
                                    Section {
                                        Button(role: .destructive) { removingProfile = profile } label: {
                                            Label("นำออกจากเพื่อน", systemImage: "person.badge.minus")
                                        }
                                        .disabled(busy)
                                    }
                                }
                                .navigationTitle("เพื่อนในระบบ")
                                .navigationBarTitleDisplayMode(.inline)
                            } label: { friendRow(name: profile.displayName, subtitle: profile.email, icon: "person.crop.circle.badge.checkmark") }
                        }
                        if profiles.isEmpty && !social.isLoading { Text("ไม่มีรายชื่อ").foregroundStyle(Color.textSecondary) }
                        NavigationLink { SocialView() } label: { Label("เพิ่มเพื่อนในระบบและคำขอ", systemImage: "person.badge.plus") }
                    }
                }
                if filter != 1 {
                    Section("นอกระบบ · \(guests.count)") {
                        ForEach(guests) { friend in
                            Button { editor = friend } label: {
                                friendRow(name: friend.name, subtitle: friend.lineID, icon: "person.crop.circle")
                            }
                            .accessibilityIdentifier("friends.local.\(friend.id)")
                            .swipeActions {
                                Button(role: .destructive) { removing = friend } label: { Label("ลบ", systemImage: "trash") }
                            }
                        }
                        if guests.isEmpty { Text("ไม่มีรายชื่อ").foregroundStyle(Color.textSecondary) }
                        Button { adding = true } label: { Label("เพิ่มเพื่อนนอกระบบ", systemImage: "person.badge.plus") }
                            .accessibilityIdentifier("friends.addLocal")
                    }
                }
            }
        }
        .font(.system(size: 14))
        .scrollContentBackground(.hidden)
        .background(Color.background)
        .navigationTitle("จัดการเพื่อน")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "ค้นหาชื่อ อีเมล หรือ LINE ID")
        .refreshable { await reload() }
        .task(id: accountID) {
            social.friends = []
            social.acceptedFriendships = []
            local = []
            await reload()
        }
        .sheet(isPresented: $adding, onDismiss: loadLocal) {
            LocalFriendEditor(accountID: accountID, friend: nil)
        }
        .sheet(item: $editor, onDismiss: loadLocal) { friend in
            LocalFriendEditor(accountID: accountID, friend: friend)
        }
        .confirmationDialog("ลบเพื่อนนอกระบบ?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("ลบ", role: .destructive) {
                guard let friend = removing else { return }
                do { try store.remove(id: friend.id, accountID: accountID); loadLocal() }
                catch { self.error = error.localizedDescription }
                removing = nil
            }
        }
        .confirmationDialog("นำออกจากเพื่อนในระบบ?", isPresented: Binding(get: { removingProfile != nil }, set: { if !$0 { removingProfile = nil } })) {
            Button("นำออกจากเพื่อน", role: .destructive) {
                guard let profile = removingProfile,
                      let relationship = social.acceptedFriendships.first(where: {
                          ($0.requesterId == accountID && $0.addresseeId == profile.id) ||
                          ($0.addresseeId == accountID && $0.requesterId == profile.id)
                      }) else { return }
                removingProfile = nil
                busy = true
                Task {
                    defer { busy = false }
                    do { try await social.removeFriend(friendshipId: relationship.id); await reload() }
                    catch { self.error = error.localizedDescription }
                }
            }
        }
    }

    private func friendRow(name: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 24)).foregroundStyle(Color.brand500).frame(width: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).foregroundStyle(Color.textPrimary).fixedSize(horizontal: false, vertical: true)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Color.textSecondary).frame(minHeight: 16)
            }
        }.padding(.vertical, 4)
    }

    private func channels(email: String, line: String) -> some View {
        Section("ช่องทางติดต่อ / แจ้งเตือน") {
            LabeledContent("อีเมล") { Text(email).textSelection(.enabled).frame(minHeight: 20) }
            LabeledContent("LINE ID") { Text(line).textSelection(.enabled).frame(minHeight: 20) }
            LabeledContent("ส่งแจ้งเตือน") { Text("").frame(minHeight: 20) }
        }
    }

    private func loadLocal() {
        guard !accountID.isEmpty else { local = []; return }
        do { local = try store.load(accountID: accountID); error = nil }
        catch { self.error = error.localizedDescription }
    }

    @MainActor private func reload() async {
        guard !accountID.isEmpty else { return }
        loadLocal()
        if preview {
            social.friends = [UserProfile(id: "preview-friend", email: "", fullName: "เพื่อนในระบบทดสอบ", avatarUrl: nil)]
        } else {
            await social.load(userId: accountID)
        }
    }
}

private struct LocalFriendEditor: View {
    let accountID: String
    let friend: LocalSplitFriend?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var line: String
    @State private var error: String?
    @State private var contacts = false

    init(accountID: String, friend: LocalSplitFriend?) {
        self.accountID = accountID
        self.friend = friend
        _name = State(initialValue: friend?.name ?? "")
        _line = State(initialValue: friend?.lineID ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(Color.statusFailed) }
                Section("ข้อมูลเพื่อนนอกระบบ") {
                    TextField("ชื่อเพื่อน", text: $name).accessibilityIdentifier("friends.editor.name")
                    Button { contacts = true } label: { Label("เลือกจาก Contacts", systemImage: "person.crop.rectangle") }
                }
                Section("ช่องทางติดต่อ / แจ้งเตือน") {
                    LabeledContent("LINE ID") {
                        TextField("", text: $line).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityLabel("LINE ID").accessibilityIdentifier("friends.editor.line")
                    }
                    LabeledContent("อีเมล") { Text("").frame(minHeight: 20) }
                    LabeledContent("ส่งแจ้งเตือน") { Text("").frame(minHeight: 20) }
                }
            }
            .font(.system(size: 14))
            .navigationTitle(friend == nil ? "เพิ่มเพื่อนนอกระบบ" : "แก้ไขเพื่อนนอกระบบ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("บันทึก") { save() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || accountID.isEmpty)
                        .accessibilityIdentifier("friends.editor.save")
                }
            }
            .sheet(isPresented: $contacts) {
                SplitContactPicker(onCancel: { contacts = false }) { selectedName in
                    name = selectedName
                    line = ""
                    contacts = false
                }
            }
        }
    }

    private func save() {
        do {
            let store = LocalSplitFriendStore()
            if let friend { try store.update(id: friend.id, name: name, lineID: line, accountID: accountID) }
            else { try store.save(name: name, lineID: line, accountID: accountID) }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
