import SwiftUI

/// "แชท" — flat LINE-style list of 1:1 conversations. Tapping a friend who has
/// no conversation yet creates one on the spot.
struct FriendChatListView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm: MessagesViewModel
    @StateObject private var socialVM: SocialViewModel
    @StateObject private var balanceVM: BalanceViewModel
    @State private var showFriendPicker = false
    @State private var openConv: ConvId?
    @State private var query = ""

    private struct ConvId: Identifiable, Hashable { let id: String }

    /// The optional view models exist so Debug fixtures can inject synthetic
    /// data; production callers use `FriendChatListView()`.
    init(viewModel: MessagesViewModel? = nil, socialViewModel: SocialViewModel? = nil, balanceViewModel: BalanceViewModel? = nil) {
        _vm = StateObject(wrappedValue: viewModel ?? MessagesViewModel())
        _socialVM = StateObject(wrappedValue: socialViewModel ?? SocialViewModel())
        _balanceVM = StateObject(wrappedValue: balanceViewModel ?? BalanceViewModel())
    }

    private var myId: String { authVM.session?.user.id.uuidString ?? "" }

    private var visibleConversations: [ChatConversation] {
        vm.conversations.filter {
            ChatPresentation.matches(
                query: query,
                name: $0.displayName,
                lastMessage: ChatPresentation.previewText(type: $0.lastMessageType, body: $0.lastMessageBody))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.surface.ignoresSafeArea()

                if vm.isLoading && vm.conversations.isEmpty {
                    ProgressView().tint(Color.brand500)
                } else if vm.conversations.isEmpty {
                    emptyState
                } else if visibleConversations.isEmpty {
                    noResults
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(visibleConversations) { conv in
                                Button {
                                    hapticLight()
                                    openConv = ConvId(id: conv.id)
                                } label: {
                                    ConversationRowView(conv: conv)
                                }
                                .buttonStyle(.plain)
                                Divider().padding(.leading, 72)
                            }
                        }
                    }
                }
            }
            .navigationTitle("แชท")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "ค้นหา")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { hapticLight(); showFriendPicker = true } label: {
                        Image(systemName: "square.and.pencil")
                            .foregroundColor(Color.brand500)
                    }
                    .accessibilityLabel("เริ่มแชทใหม่")
                }
            }
            .navigationDestination(item: $openConv) { conv in
                let info = vm.conversations.first { $0.id == conv.id }
                FriendChatRoomView(
                    vm: vm, conversationId: conv.id, currentUserId: myId,
                    friendName: info?.displayName,
                    friendAvatarUrl: info?.displayAvatarUrl,
                    showsAvatars: info?.type == "direct",
                    friendUserId: info?.otherUserId,
                    balanceViewModel: info?.otherUserId == nil ? nil : balanceVM)
            }
            .sheet(isPresented: $showFriendPicker) {
                FriendPickerSheet(friends: socialVM.friends) { friend in
                    showFriendPicker = false
                    Task {
                        if let convId = await vm.getOrCreateDirectConversation(myId: myId, friendId: friend.id) {
                            await vm.loadConversations(myId: myId)
                            openConv = ConvId(id: convId)
                        }
                    }
                }
            }
            .task {
                guard !myId.isEmpty else { return }
                await vm.loadConversations(myId: myId)
                await socialVM.load(userId: myId)
            }
            .refreshable {
                guard !myId.isEmpty else { return }
                await vm.loadConversations(myId: myId)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "message")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color.brand300)
            Text("ยังไม่มีการสนทนา")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Color.textSecondary)
            Button { hapticLight(); showFriendPicker = true } label: {
                Text("เริ่มแชทกับเพื่อน")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.brand500)
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResults: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 34, weight: .light))
                .foregroundColor(Color.textSecondary.opacity(0.6))
            Text("ไม่พบ “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ConversationRowView: View {
    let conv: ChatConversation

    var body: some View {
        HStack(spacing: 12) {
            ChatAvatar(name: conv.displayName, url: conv.displayAvatarUrl, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(conv.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(ChatPresentation.listTimeLabel(conv.updatedAt))
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                }
                Text(ChatPresentation.previewText(type: conv.lastMessageType, body: conv.lastMessageBody))
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct FriendPickerSheet: View {
    let friends: [UserProfile]
    let onPick: (UserProfile) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(friends) { friend in
                Button { onPick(friend) } label: {
                    HStack(spacing: 12) {
                        ChatAvatar(name: friend.displayName, url: friend.avatarUrl, size: 44)
                        Text(friend.displayName)
                            .font(.system(size: 15))
                            .foregroundColor(Color.textPrimary)
                    }
                }
            }
            .listStyle(.plain)
            .overlay {
                if friends.isEmpty {
                    Text("ยังไม่มีเพื่อน — เพิ่มเพื่อนก่อนเริ่มแชทได้ที่แท็บโซเชียล")
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(32)
                }
            }
            .navigationTitle("เลือกเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                }
            }
        }
    }
}
