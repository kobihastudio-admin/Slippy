import SwiftUI

/// "แชทกับเพื่อน" — list of 1:1 conversations, matching the visual language
/// of the rest of this redesigned app (Dashboard/Split screens). Tapping a
/// friend who has no conversation yet creates one on the spot.
struct FriendChatListView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = MessagesViewModel()
    @StateObject private var socialVM = SocialViewModel()
    @State private var showFriendPicker = false
    @State private var openConv: ConvId?

    private struct ConvId: Identifiable, Hashable { let id: String }

    private var myId: String { authVM.session?.user.id.uuidString ?? "" }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#f4f3ff").ignoresSafeArea()

                if vm.isLoading {
                    ProgressView().tint(Color.brand500)
                } else if vm.conversations.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(vm.conversations) { conv in
                                Button {
                                    hapticLight()
                                    openConv = ConvId(id: conv.id)
                                } label: {
                                    ConversationRowView(conv: conv)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("แชทกับเพื่อน")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { hapticLight(); showFriendPicker = true } label: {
                        Image(systemName: "square.and.pencil")
                            .foregroundColor(Color.brand500)
                    }
                }
            }
            .navigationDestination(item: $openConv) { conv in
                FriendChatRoomView(vm: vm, conversationId: conv.id, currentUserId: myId)
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
                await vm.loadConversations(myId: myId)
                await socialVM.load(userId: myId)
            }
            .refreshable { await vm.loadConversations(myId: myId) }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "message")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color(hex: "#c4b5fd"))
            Text("ยังไม่มีการสนทนา")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Color(hex: "#6b7280"))
            Button { hapticLight(); showFriendPicker = true } label: {
                Text("เริ่มแชทกับเพื่อน")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color(hex: "#6366f1"))
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ConversationRowView: View {
    let conv: ChatConversation

    private func lastMessagePreview() -> String {
        switch conv.lastMessageType {
        case "image": return "📷 รูปภาพ"
        case "video": return "🎬 วิดีโอ"
        case "file":  return "📎 ไฟล์แนบ"
        default:      return conv.lastMessageBody ?? "เริ่มสนทนา..."
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color(hex: "#ede9fe")).frame(width: 48, height: 48)
                if let urlStr = conv.displayAvatarUrl, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { phase in
                        if case .success(let img) = phase {
                            img.resizable().scaledToFill().frame(width: 48, height: 48).clipShape(Circle())
                        } else {
                            Text(conv.displayName.prefix(1).uppercased())
                                .font(.system(size: 17, weight: .bold)).foregroundColor(Color(hex: "#6366f1"))
                        }
                    }
                } else {
                    Text(conv.displayName.prefix(1).uppercased())
                        .font(.system(size: 17, weight: .bold)).foregroundColor(Color(hex: "#6366f1"))
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(conv.displayName)
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .lineLimit(1)
                Text(lastMessagePreview())
                    .font(.system(size: 12.5))
                    .foregroundColor(Color(hex: "#9ca3af"))
                    .lineLimit(1)
            }
            Spacer()
            Text(relTime(conv.updatedAt))
                .font(.system(size: 10.5))
                .foregroundColor(Color(hex: "#9ca3af"))
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
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
                        Circle().fill(Color(hex: "#ede9fe")).frame(width: 40, height: 40)
                            .overlay(Text(friend.displayName.prefix(1).uppercased())
                                .font(.system(size: 15, weight: .bold)).foregroundColor(Color(hex: "#6366f1")))
                        Text(friend.displayName)
                            .font(.system(size: 14.5))
                            .foregroundColor(Color(hex: "#1e1b4b"))
                    }
                }
            }
            .overlay {
                if friends.isEmpty {
                    Text("ยังไม่มีเพื่อน — เพิ่มเพื่อนก่อนเริ่มแชทได้ที่แท็บโซเชียล")
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#9ca3af"))
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
