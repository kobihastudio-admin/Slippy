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
    /// The other person's user id in a direct chat; `nil` for groups.
    var otherUserId: String? = nil
}

/// The part of `messages.meta` (jsonb) a file message needs: what the web chat writes as `{fileName, fileSize}`.
/// Lenient on purpose: other message types store other keys (payment requests, slips) and a number may arrive as an
/// integer or a decimal, so a key that is missing or of another type is just `nil`, never a decoding failure.
struct FriendMessageMeta: Codable, Equatable {
    var fileName: String?
    var fileSize: Int?

    private enum CodingKeys: String, CodingKey { case fileName, fileSize }

    init(fileName: String? = nil, fileSize: Int? = nil) {
        self.fileName = fileName
        self.fileSize = fileSize
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fileName = try? c.decodeIfPresent(String.self, forKey: .fileName)
        if let whole = try? c.decodeIfPresent(Int.self, forKey: .fileSize) {
            fileSize = whole
        } else if let decimal = try? c.decodeIfPresent(Double.self, forKey: .fileSize) {
            fileSize = Int(decimal)
        } else {
            fileSize = nil
        }
    }
}

struct FriendMessage: Codable, Identifiable, Equatable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String?
    let msgType: String
    let attachmentUrl: String?
    let createdAt: String
    var meta: FriendMessageMeta? = nil

    enum CodingKeys: String, CodingKey {
        case id, body, meta
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case msgType = "msg_type"
        case attachmentUrl = "attachment_url"
        case createdAt = "created_at"
    }
}

/// Lets ChatPaging (Foundation-only, host-tested) merge and order these without knowing the model.
extension FriendMessage: PagedMessage {}
