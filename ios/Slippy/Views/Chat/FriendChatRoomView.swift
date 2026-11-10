import SwiftUI

/// Chat room for "แชทกับเพื่อน" (and the trip chat, which reuses it). No
/// realtime yet — polls on a short timer while the view is open, same tradeoff
/// DashboardView/SplitView make elsewhere in this app.
struct FriendChatRoomView: View {
    @ObservedObject var vm: MessagesViewModel
    let conversationId: String
    let currentUserId: String
    /// Set by the chat list for 1:1 chats. `nil` for other callers (the trip
    /// chat), which keep their own navigation title.
    var friendName: String? = nil
    var friendAvatarUrl: String? = nil
    /// Show the sender's avatar next to a run of messages. Only meaningful for 1:1 chats.
    var showsAvatars = false
    /// Set only for 1:1 chats so the trip chat is unchanged.
    var friendUserId: String? = nil
    var balanceViewModel: BalanceViewModel? = nil

    @State private var input = ""
    @State private var sendFailed = false
    @State private var submitting = false
    @FocusState private var inputFocused: Bool
    private let refreshTimer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    private struct Row: Identifiable {
        let message: FriendMessage
        let layout: ChatPresentation.MessageLayout
        let time: String
        var id: String { message.id }
    }

    /// Only this conversation's messages. `vm.messages` is shared across rooms,
    /// and a poll that was started in the previous room can land after this
    /// one opened, so the filter (not just the clear on entry) keeps the
    /// previous conversation from showing up.
    private var visibleMessages: [FriendMessage] {
        vm.messages.filter { $0.conversationId == conversationId }
    }

    private var rows: [Row] {
        let messages = visibleMessages
        let dates = messages.map { ChatPresentation.parseISO($0.createdAt) }
        let layouts = ChatPresentation.layouts(
            items: zip(messages, dates).map { (senderId: $0.0.senderId, date: $0.1) },
            me: currentUserId)
        return zip(zip(messages, dates), layouts).map { pair, layout in
            Row(message: pair.0, layout: layout, time: pair.1.map { ChatPresentation.timeLabel($0) } ?? "")
        }
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !submitting && !vm.isSending
    }

    var body: some View {
        VStack(spacing: 0) {
            if let balanceViewModel, let friendUserId {
                BalanceChatLine(vm: balanceViewModel, friendId: friendUserId, friendName: friendName ?? "")
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if vm.hasOlder(conversationId) {
                            olderButton(proxy: proxy)
                        }
                        ForEach(rows) { row in
                            ChatMessageRow(
                                message: row.message,
                                layout: row.layout,
                                time: row.time,
                                isMe: row.message.senderId == currentUserId,
                                friendName: friendName ?? "",
                                friendAvatarUrl: friendAvatarUrl,
                                showsAvatars: showsAvatars)
                            .id(row.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                // Follow the NEWEST message only. Keying on the whole list scrolled to the bottom whenever older
                // messages were prepended, which threw the reader away from the page they had just asked for.
                .onChange(of: visibleMessages.last?.id) { _, newest in
                    guard let newest else { return }
                    withAnimation { proxy.scrollTo(newest, anchor: .bottom) }
                }
            }

            composer
        }
        .background(Color.surfaceMuted.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .modifier(OptionalNavigationTitle(title: friendName))
        .task {
            // Never flash the previously opened conversation's messages.
            if let first = vm.messages.first, first.conversationId != conversationId { vm.messages = [] }
            // Opening a room is always a first page (see resetRoom), even if it was loaded before.
            vm.resetRoom(conversationId)
            await vm.loadMessages(conversationId: conversationId)
            await balanceViewModel?.load()
        }
        .onReceive(refreshTimer) { _ in
            Task { await vm.loadMessages(conversationId: conversationId) }
        }
        .onChange(of: input) { _, _ in
            if sendFailed { sendFailed = false }
        }
        .onChange(of: sendFailed) { _, failed in
            if failed { AccessibilityNotification.Announcement("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่").post() }
        }
    }

    /// "Load older messages" at the top of the list. After the page is prepended the view scrolls back to the
    /// message that used to be first, so the reader stays where they were.
    private func olderButton(proxy: ScrollViewProxy) -> some View {
        Button {
            let anchor = visibleMessages.first?.id
            Task {
                await vm.loadOlder(conversationId: conversationId)
                guard let anchor else { return }
                // Scrolling in the same pass as the insert lands on the lazy stack's ESTIMATED row heights and misses
                // the anchor (seen in the simulator: the old first message ended up near the bottom of the screen).
                // Let SwiftUI lay the new rows out first, then scroll, and once more after they have settled.
                await Task.yield()
                proxy.scrollTo(anchor, anchor: .top)
                try? await Task.sleep(nanoseconds: 120_000_000)
                proxy.scrollTo(anchor, anchor: .top)
            }
        } label: {
            HStack(spacing: 6) {
                if vm.isLoadingOlder { ProgressView().controlSize(.small) }
                Text(vm.isLoadingOlder ? "กำลังโหลด…" : "โหลดข้อความก่อนหน้า")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(Color.textSecondary)
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(Color.surface)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(vm.isLoadingOlder)
        .padding(.bottom, 4)
        .accessibilityLabel("โหลดข้อความก่อนหน้า")
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if sendFailed {
                Text("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.errorText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("พิมพ์ข้อความ...", text: $input, axis: .vertical)
                    .focused($inputFocused)
                    .font(.system(size: 15))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Color.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .lineLimit(1...4)

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(canSend ? Color.brand500 : Color.border)
                }
                .disabled(!canSend)
                .accessibilityLabel("ส่งข้อความ")
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
        .background(Color.surface)
    }

    private func send() {
        guard canSend else { return }
        let sent = input
        submitting = true
        sendFailed = false
        Task {
            let succeeded = await vm.sendMessage(conversationId: conversationId, senderId: currentUserId, body: sent)
            input = ChatPresentation.draftAfterSend(current: input, sent: sent, succeeded: succeeded)
            sendFailed = !succeeded
            submitting = false
        }
    }
}

/// Applies a navigation title only when one is provided, so a caller's own
/// `.navigationTitle` (the trip chat) is never overridden by an empty one.
private struct OptionalNavigationTitle: ViewModifier {
    let title: String?
    func body(content: Content) -> some View {
        if let title { content.navigationTitle(title) } else { content }
    }
}

private struct ChatMessageRow: View {
    let message: FriendMessage
    let layout: ChatPresentation.MessageLayout
    let time: String
    let isMe: Bool
    let friendName: String
    let friendAvatarUrl: String?
    let showsAvatars: Bool

    private var text: String { ChatPresentation.previewText(type: message.msgType, body: message.body) }

    var body: some View {
        VStack(spacing: 8) {
            if let chip = layout.dayChip { DayChip(text: chip).padding(.top, 6) }
            if isMe {
                HStack(alignment: .bottom, spacing: 5) {
                    Spacer(minLength: 48)
                    timeText
                    bubble
                }
            } else {
                HStack(alignment: .top, spacing: 6) {
                    avatarSlot
                    HStack(alignment: .bottom, spacing: 5) {
                        bubble
                        timeText
                    }
                    Spacer(minLength: 24)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [layout.dayChip, isMe ? "ฉัน" : friendName, text, time]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: ", "))
    }

    @ViewBuilder private var avatarSlot: some View {
        if showsAvatars {
            if layout.showsAvatar {
                ChatAvatar(name: friendName, url: friendAvatarUrl, size: 32)
            } else {
                Color.clear.frame(width: 32, height: 32)
            }
        }
    }

    private var timeText: some View {
        Text(time)
            .font(.system(size: 10))
            .foregroundColor(Color.textSecondary)
    }

    private var bubble: some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundColor(isMe ? .white : Color.textPrimary)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(isMe ? Color.brand500 : Color.surface)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: isMe ? 16 : 4,
                bottomLeadingRadius: 16,
                bottomTrailingRadius: 16,
                topTrailingRadius: isMe ? 4 : 16))
    }
}

private struct DayChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 10).padding(.vertical, 3)
            .background(Color.black.opacity(0.55))
            .clipShape(Capsule())
    }
}
