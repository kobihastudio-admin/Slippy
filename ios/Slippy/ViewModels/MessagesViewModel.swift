import SwiftUI
import Supabase

/// Friend-to-friend chat — mirrors the web app's /messages feature
/// (web/src/app/(app)/messages, web/src/app/api/conversations) using the
/// same `conversations` / `conversation_members` / `messages` tables,
/// queried directly via the Supabase client (no Next.js API layer on
/// native). No realtime subscription yet — refresh on open + pull-to-refresh,
/// same pattern as DashboardViewModel/SplitViewModel elsewhere in this app.
@MainActor
final class MessagesViewModel: ObservableObject {
    @Published var conversations: [ChatConversation] = []
    @Published var messages: [FriendMessage] = []
    @Published var isLoading = false
    @Published var isSending = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    // MARK: – Conversation list

    func loadConversations(myId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let myMemberships: [ConversationMemberRow] = try await db
                .from("conversation_members")
                .select("conversation_id, user_id")
                .eq("user_id", value: myId)
                .execute()
                .value

            let convIds = myMemberships.map(\.conversationId)
            guard !convIds.isEmpty else { conversations = []; return }

            async let convsTask: [ConversationRow] = db
                .from("conversations")
                .select("id, type, name, avatar_url, updated_at")
                .in("id", values: convIds)
                .order("updated_at", ascending: false)
                .execute()
                .value

            async let othersTask: [ConversationMemberWithUser] = db
                .from("conversation_members")
                .select("conversation_id, users(id, email, full_name, avatar_url)")
                .in("conversation_id", values: convIds)
                .neq("user_id", value: myId)
                .execute()
                .value

            struct LastMsgRow: Codable {
                let conversationId: String
                let body: String?
                let msgType: String
                let createdAt: String
                enum CodingKeys: String, CodingKey {
                    case conversationId = "conversation_id"
                    case body
                    case msgType = "msg_type"
                    case createdAt = "created_at"
                }
            }
            async let lastMsgsTask: [LastMsgRow] = db
                .from("messages")
                .select("conversation_id, body, msg_type, created_at")
                .in("conversation_id", values: convIds)
                .order("created_at", ascending: false)
                .execute()
                .value

            let (convs, others, lastMsgs) = try await (convsTask, othersTask, lastMsgsTask)

            var otherByConv: [String: UserProfile] = [:]
            for row in others {
                if let user = row.user { otherByConv[row.conversationId] = user }
            }
            var lastMsgByConv: [String: LastMsgRow] = [:]
            for row in lastMsgs where lastMsgByConv[row.conversationId] == nil {
                lastMsgByConv[row.conversationId] = row
            }

            conversations = convs.map { conv in
                let other = otherByConv[conv.id]
                let last  = lastMsgByConv[conv.id]
                let displayName = conv.type == "direct"
                    ? (other?.displayName ?? "ไม่ทราบชื่อ")
                    : (conv.name ?? "กลุ่ม")
                let displayAvatar = conv.type == "direct" ? other?.avatarUrl : conv.avatarUrl
                return ChatConversation(
                    id: conv.id, type: conv.type,
                    displayName: displayName, displayAvatarUrl: displayAvatar,
                    updatedAt: conv.updatedAt,
                    lastMessageBody: last?.body, lastMessageType: last?.msgType
                )
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Finds an existing direct conversation with `friendId`, or creates one.
    /// Mirrors web/src/app/api/conversations/route.ts POST.
    func getOrCreateDirectConversation(myId: String, friendId: String) async -> String? {
        do {
            let mine: [ConversationMemberRow] = try await db
                .from("conversation_members")
                .select("conversation_id, user_id")
                .eq("user_id", value: myId)
                .execute()
                .value
            let myConvIds = mine.map(\.conversationId)

            if !myConvIds.isEmpty {
                let shared: [ConversationMemberRow] = try await db
                    .from("conversation_members")
                    .select("conversation_id, user_id")
                    .eq("user_id", value: friendId)
                    .in("conversation_id", values: myConvIds)
                    .limit(1)
                    .execute()
                    .value
                if let existing = shared.first { return existing.conversationId }
            }

            struct ConvInsert: Encodable {
                let type: String
                let created_by: String
            }
            struct ConvIdRow: Decodable { let id: String }
            let created: [ConvIdRow] = try await db
                .from("conversations")
                .insert(ConvInsert(type: "direct", created_by: myId))
                .select("id")
                .execute()
                .value
            guard let convId = created.first?.id else { return nil }

            struct MemberInsert: Encodable {
                let conversation_id: String
                let user_id: String
                let role: String
            }
            try await db
                .from("conversation_members")
                .insert([
                    MemberInsert(conversation_id: convId, user_id: myId, role: "admin"),
                    MemberInsert(conversation_id: convId, user_id: friendId, role: "member"),
                ])
                .execute()

            return convId
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    // MARK: – Messages within a conversation

    func loadMessages(conversationId: String) async {
        do {
            messages = try await db
                .from("messages")
                .select("id, conversation_id, sender_id, body, msg_type, attachment_url, created_at")
                .eq("conversation_id", value: conversationId)
                .order("created_at", ascending: true)
                .limit(100)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func sendMessage(conversationId: String, senderId: String, body: String) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        isSending = true
        defer { isSending = false }

        struct MsgInsert: Encodable {
            let conversation_id: String
            let sender_id: String
            let body: String
            let msg_type: String
        }
        do {
            let inserted: [FriendMessage] = try await db
                .from("messages")
                .insert(MsgInsert(conversation_id: conversationId, sender_id: senderId, body: trimmed, msg_type: "text"))
                .select("id, conversation_id, sender_id, body, msg_type, attachment_url, created_at")
                .execute()
                .value
            if let msg = inserted.first { messages.append(msg) }

            struct TouchPatch: Encodable { let updated_at: String }
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try await db.from("conversations")
                .update(TouchPatch(updated_at: iso.string(from: Date())))
                .eq("id", value: conversationId)
                .execute()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
