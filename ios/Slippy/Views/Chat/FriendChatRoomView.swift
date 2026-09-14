import SwiftUI

/// 1:1 chat room for "แชทกับเพื่อน". No realtime yet — polls on a short
/// timer while the view is open, same tradeoff DashboardView/SplitView make
/// elsewhere in this app (pull-to-refresh + a light auto-refresh) rather
/// than wiring Supabase Realtime for a first version.
struct FriendChatRoomView: View {
    @ObservedObject var vm: MessagesViewModel
    let conversationId: String
    let currentUserId: String

    @State private var input = ""
    @FocusState private var inputFocused: Bool
    private let refreshTimer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(vm.messages) { msg in
                            FriendChatBubble(message: msg, isMe: msg.senderId == currentUserId)
                                .id(msg.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: vm.messages) { _, _ in
                    guard let last = vm.messages.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }

            HStack(spacing: 10) {
                TextField("พิมพ์ข้อความ...", text: $input, axis: .vertical)
                    .focused($inputFocused)
                    .font(.system(size: 14))
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color(hex: "#f3f4f6"))
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .lineLimit(1...4)

                Button {
                    let text = input
                    input = ""
                    Task { await vm.sendMessage(conversationId: conversationId, senderId: currentUserId, body: text) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(input.trimmingCharacters(in: .whitespaces).isEmpty ? Color(hex: "#d1d5db") : Color(hex: "#6366f1"))
                }
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || vm.isSending)
            }
            .padding(12)
            .background(Color.white)
        }
        .background(Color(hex: "#f4f3ff").ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadMessages(conversationId: conversationId) }
        .onReceive(refreshTimer) { _ in
            Task { await vm.loadMessages(conversationId: conversationId) }
        }
    }
}

private struct FriendChatBubble: View {
    let message: FriendMessage
    let isMe: Bool

    var body: some View {
        HStack {
            if isMe { Spacer(minLength: 40) }
            Text(message.body ?? "")
                .font(.system(size: 14))
                .foregroundColor(isMe ? .white : Color(hex: "#1e1b4b"))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(isMe ? Color(hex: "#6366f1") : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .shadow(color: .black.opacity(isMe ? 0 : 0.04), radius: 4, x: 0, y: 2)
            if !isMe { Spacer(minLength: 40) }
        }
    }
}
