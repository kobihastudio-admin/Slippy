#if DEBUG
import SwiftUI

// Synthetic data for simulator screenshots of the chat screens
// (SLIPPY_APPEARANCE_PREVIEW=chat-list-test | chat-room-test | add-friend-test).
// Nothing here talks to the network: MessagesViewModel.isFixture short-circuits
// its loads and sends, and the Social view model is only given preset values
// (an invite token is preset so the sheet never tries to mint one).

extension MessagesViewModel {
    static let fixtureMyId = "fx-me"
    static let fixtureFriendId = "fx-friend"
    static let fixtureConversationId = "fx-conv-1"

    private static func iso(daysAgo: Int, hour: Int, minute: Int) -> String {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
        let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func chatFixture() -> MessagesViewModel {
        let vm = MessagesViewModel()
        vm.isFixture = true
        vm.conversations = [
            ChatConversation(id: "fx-conv-1", type: "direct", displayName: "พลอย", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 0, hour: 9, minute: 5),
                             lastMessageBody: "20:00 เจอกัน 👍", lastMessageType: "text"),
            ChatConversation(id: "fx-conv-2", type: "direct", displayName: "กอล์ฟ", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 1, hour: 21, minute: 30),
                             lastMessageBody: nil, lastMessageType: "image"),
            ChatConversation(id: "fx-conv-3", type: "direct", displayName: "นุ่น", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 3, hour: 14, minute: 2),
                             lastMessageBody: "ขอบคุณนะ เดี๋ยวโอนให้", lastMessageType: "text"),
            ChatConversation(id: "fx-conv-4", type: "direct", displayName: "ต้น", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 20, hour: 10, minute: 0),
                             lastMessageBody: nil, lastMessageType: "file"),
            ChatConversation(id: "fx-conv-5", type: "direct", displayName: "เอ", displayAvatarUrl: nil,
                             updatedAt: iso(daysAgo: 400, hour: 18, minute: 45),
                             lastMessageBody: "โอเคเลย", lastMessageType: "text"),
        ]
        func message(_ id: String, _ sender: String, _ body: String, _ daysAgo: Int, _ hour: Int, _ minute: Int) -> FriendMessage {
            FriendMessage(id: id, conversationId: fixtureConversationId, senderId: sender, body: body,
                          msgType: "text", attachmentUrl: nil, createdAt: iso(daysAgo: daysAgo, hour: hour, minute: minute))
        }
        vm.messages = [
            message("m1", fixtureFriendId, "คืนนี้กินอะไรดี หิวมาก", 1, 19, 2),
            message("m2", fixtureFriendId, "อยากกินชาบู", 1, 19, 3),
            message("m3", fixtureMyId, "ชาบูไหม ร้านเดิมที่ทองหล่อ", 1, 19, 4),
            message("m4", fixtureFriendId, "เอา! ถึงกี่โมง 😆", 1, 19, 5),
            message("m5", fixtureMyId, "20:00 เจอกัน 👍", 0, 8, 30),
            message("m6", fixtureFriendId, "ได้เลย เดี๋ยวจองโต๊ะไว้ให้ ที่นั่งริมหน้าต่างนะ จะได้เห็นวิวสวยๆ ตอนกินข้าว", 0, 9, 5),
            message("m7", fixtureMyId, "ขอบคุณนะ", 0, 9, 6),
        ]
        return vm
    }
}

extension SocialViewModel {
    static func friendsFixture() -> SocialViewModel {
        let vm = SocialViewModel()
        vm.inviteToken = "fixture-token"
        vm.friends = [
            UserProfile(id: "fx-friend", email: "ploy@example.invalid", fullName: "พลอย", avatarUrl: nil),
            UserProfile(id: "fx-golf", email: "golf@example.invalid", fullName: "กอล์ฟ", avatarUrl: nil),
        ]
        vm.pendingRequests = [
            Friendship(id: "fx-req-1", requesterId: "fx-mint", addresseeId: MessagesViewModel.fixtureMyId,
                       status: "pending", createdAt: "2026-11-09T00:00:00Z",
                       friend: UserProfile(id: "fx-mint", email: "mint@example.invalid", fullName: "มิ้นท์", avatarUrl: nil)),
            Friendship(id: "fx-req-2", requesterId: "fx-ton", addresseeId: MessagesViewModel.fixtureMyId,
                       status: "pending", createdAt: "2026-11-09T00:00:00Z",
                       friend: UserProfile(id: "fx-ton", email: "ton@example.invalid", fullName: "ต้น", avatarUrl: nil)),
        ]
        return vm
    }
}

struct ChatListFixtureScreen: View {
    @StateObject private var messages = MessagesViewModel.chatFixture()
    @StateObject private var social = SocialViewModel.friendsFixture()
    var body: some View { FriendChatListView(viewModel: messages, socialViewModel: social) }
}

struct ChatRoomFixtureScreen: View {
    @StateObject private var messages = MessagesViewModel.chatFixture()
    @StateObject private var balances = BalanceViewModel.fixture()
    var body: some View {
        NavigationStack {
            FriendChatRoomView(
                vm: messages,
                conversationId: MessagesViewModel.fixtureConversationId,
                currentUserId: MessagesViewModel.fixtureMyId,
                friendName: "พลอย", friendAvatarUrl: nil, showsAvatars: true,
                friendUserId: MessagesViewModel.fixtureFriendId,
                balanceViewModel: balances)
        }
    }
}

struct AddFriendFixtureScreen: View {
    @StateObject private var social = SocialViewModel.friendsFixture()
    var body: some View { SocialAddFriendSheet(vm: social) }
}
#endif
