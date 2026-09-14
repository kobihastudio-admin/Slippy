import Foundation

/// Direct/group conversations — same `conversations`/`conversation_members`/
/// `messages` tables the web app's /messages uses (web/src/app/api/conversations).

struct ConversationMemberRow: Codable {
    let conversationId: String
    let userId: String
    enum CodingKeys: String, CodingKey {
        case conversationId = "conversation_id"
        case userId = "user_id"
    }
}

struct ConversationMemberWithUser: Codable {
    let conversationId: String
    let user: UserProfile?
    enum CodingKeys: String, CodingKey {
        case conversationId = "conversation_id"
        case user = "users"
    }
}

struct ConversationRow: Codable, Identifiable {
    let id: String
    let type: String
    let name: String?
    let avatarUrl: String?
    let updatedAt: String
    enum CodingKeys: String, CodingKey {
        case id, type, name
        case avatarUrl = "avatar_url"
        case updatedAt = "updated_at"
    }
}

/// Display-ready conversation, assembled client-side the same way the web
/// route does (direct chats show the *other* member's name/avatar, not the
/// conversation row's own — which is usually null for 1:1 chats).
struct ChatConversation: Identifiable {
    let id: String
    let type: String
    let displayName: String
    let displayAvatarUrl: String?
    let updatedAt: String
    var lastMessageBody: String?
    var lastMessageType: String?
}

struct FriendMessage: Codable, Identifiable, Equatable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String?
    let msgType: String
    let attachmentUrl: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, body
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case msgType = "msg_type"
        case attachmentUrl = "attachment_url"
        case createdAt = "created_at"
    }
}
