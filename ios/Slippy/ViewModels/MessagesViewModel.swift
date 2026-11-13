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
    /// True while an older page is being fetched (disables the "load older" button).
    @Published private(set) var isLoadingOlder = false
    /// Conversations that may still have messages older than the ones loaded. Read it through `hasOlder(_:)`.
    @Published private(set) var conversationsWithOlder: Set<String> = []
    @Published var error: String?

    #if DEBUG
    /// Synthetic-data mode for simulator screenshots: no network reads or writes.
    var isFixture = false
    /// The "older page" a fixture room hands out when `loadOlder` is called.
    var fixtureOlder: [FriendMessage] = []
    /// Lets a fixture show the "load older messages" row without a network read.
    func fixtureMarkHasOlder(_ conversationId: String) { conversationsWithOlder.insert(conversationId) }
    #endif

    private let db = SupabaseManager.shared.client

    // MARK: – Conversation list

    func loadConversations(myId: String) async {
        #if DEBUG
        if isFixture { return }
        #endif
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

            // Who else is in each room. Their profiles come from the RPC below: embedding `users(...)` here returned
            // nothing, because RLS lets a user read only their own row of that table.
            async let othersTask: [ConversationMemberRow] = db
                .from("conversation_members")
                .select("conversation_id, user_id")
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

            let profiles = try await ProfileDirectory.fetch(ids: others.map(\.userId))
            var otherByConv: [String: UserProfile] = [:]
            for row in others {
                if let user = profiles[row.userId.lowercased()] { otherByConv[row.conversationId] = user }
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
                    lastMessageBody: last?.body, lastMessageType: last?.msgType,
                    otherUserId: conv.type == "direct" ? other?.id : nil
                )
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Why the last attempt to open a chat with a friend failed (Thai, for the screen to show), or `nil`.
    @Published var openChatError: String?

    /// The direct room with the friend `friendId`, opened on the server. A signed-in user cannot create a conversation or its
    /// members from the app (row-level security refuses both), so `open_direct_conversation` does it in one step: it checks that
    /// the two are accepted friends, reuses the direct room of exactly these two people if there is one, and otherwise creates it
    /// with both members (see supabase/migrations/20261113130000_open_direct_conversation.sql).
    /// `myId` is kept for the call sites; the server uses the signed-in user.
    func getOrCreateDirectConversation(myId: String, friendId: String) async -> String? {
        #if DEBUG
        if isFixture { return nil }
        #endif
        openChatError = nil
        struct Params: Encodable {
            let pFriendId: String
            enum CodingKeys: String, CodingKey { case pFriendId = "p_friend_id" }
        }
        do {
            let roomId: String = try await db
                .rpc("open_direct_conversation", params: Params(pFriendId: friendId.lowercased()))
                .execute()
                .value
            return roomId
        } catch {
            openChatError = ChatPresentation.openChatFailureMessage("\(error) \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: – Messages within a conversation

    private static let messageColumns = "id, conversation_id, sender_id, body, msg_type, attachment_url, created_at, meta"

    /// Call when a room is OPENED. Forgets what was loaded for it earlier, so the next `loadMessages` counts as a
    /// first page. Without this, coming back to a room merged only the newest page into the old rows, and any
    /// messages beyond that page that arrived while the reader was away were never loaded: "load older" pages
    /// backwards from the oldest loaded row, which lies before the gap.
    func resetRoom(_ conversationId: String) {
        #if DEBUG
        if isFixture { return }
        #endif
        messages.removeAll { $0.conversationId == conversationId }
        setHasOlder(false, for: conversationId)
    }

    /// True while older messages than the ones on screen may still be loaded for this conversation.
    func hasOlder(_ conversationId: String) -> Bool { conversationsWithOlder.contains(conversationId) }

    private func setHasOlder(_ value: Bool, for conversationId: String) {
        if value { conversationsWithOlder.insert(conversationId) } else { conversationsWithOlder.remove(conversationId) }
    }

    /// Opens a conversation on its NEWEST messages and keeps it fresh. Messages are read newest-first, one page,
    /// and MERGED into what is already shown, so the 4-second refresh adds new messages without throwing away
    /// the older pages the reader has loaded. (It used to read the oldest 100, so a long chat opened on its
    /// first messages.)
    func loadMessages(conversationId: String) async {
        #if DEBUG
        if isFixture { return }
        #endif
        do {
            let page: [FriendMessage] = try await db
                .from("messages")
                .select(Self.messageColumns)
                .eq("conversation_id", value: conversationId)
                .order("created_at", ascending: false)
                .limit(ChatPaging.pageSize)
                .execute()
                .value
            let isFirstPage = !messages.contains { $0.conversationId == conversationId }
            messages = ChatPaging.merge(existing: messages, incoming: page)
            if isFirstPage {
                setHasOlder(ChatPaging.hasMoreOlder(fetched: page.count, pageSize: ChatPaging.pageSize, newlyAdded: nil),
                            for: conversationId)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Loads the page of messages before the oldest one on screen. The cursor is "at or before the oldest loaded
    /// timestamp" (messages sharing that exact instant are not skipped; the merge removes the ones already shown).
    func loadOlder(conversationId: String) async {
        #if DEBUG
        if isFixture {
            messages = ChatPaging.merge(existing: messages, incoming: fixtureOlder)
            setHasOlder(false, for: conversationId)
            return
        }
        #endif
        guard hasOlder(conversationId), !isLoadingOlder else { return }
        let inRoom = ChatPaging.merge(existing: messages.filter { $0.conversationId == conversationId }, incoming: [])
        guard let oldest = inRoom.first, let cursor = ChatPaging.cursorValue(oldest.createdAt) else {
            setHasOlder(false, for: conversationId)
            return
        }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let page: [FriendMessage] = try await db
                .from("messages")
                .select(Self.messageColumns)
                .eq("conversation_id", value: conversationId)
                .lte("created_at", value: cursor)
                .order("created_at", ascending: false)
                .limit(ChatPaging.pageSize)
                .execute()
                .value
            let merged = ChatPaging.merge(existing: messages, incoming: page)
            let added = merged.filter { $0.conversationId == conversationId }.count - inRoom.count
            messages = merged
            setHasOlder(ChatPaging.hasMoreOlder(fetched: page.count, pageSize: ChatPaging.pageSize, newlyAdded: added),
                        for: conversationId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Returns `true` once the message is stored, `false` if it was not sent
    /// (blank text, a send already in flight, or the insert failed). The
    /// caller keeps the typed text on `false`.
    @discardableResult
    func sendMessage(conversationId: String, senderId: String, body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return false }
        isSending = true
        defer { isSending = false }

        #if DEBUG
        if isFixture {
            error = "fixture: sending is disabled"
            return false
        }
        #endif

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
                .select(Self.messageColumns)
                .execute()
                .value
            if let msg = inserted.first { messages.append(msg) }
        } catch {
            self.error = error.localizedDescription
            return false
        }

        // MESSAGE STORED: everything below is best-effort. A failure here must
        // not make the caller restore the draft, or the message is sent twice.
        do {
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
        return true
    }
    // MARK: – Attachments and forwarding

    private struct AttachmentInsert: Encodable {
        let conversation_id: String
        let sender_id: String
        let body: String?
        let msg_type: String
        let attachment_url: String?
        let meta: FriendMessageMeta?
    }

    /// Stores one message row and shows it. Throws what Supabase throws.
    private func insertMessage(_ row: AttachmentInsert) async throws {
        let inserted: [FriendMessage] = try await db
            .from("messages")
            .insert(row)
            .select(Self.messageColumns)
            .execute()
            .value
        if let message = inserted.first { messages.append(message) }
    }

    /// Bumps the room's `updated_at` so it moves to the top of the list. Best effort: the message is already stored.
    private func touchConversation(_ conversationId: String) async {
        do {
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

    /// Uploads `data` to the public `chat-attachments` bucket and sends it as an image / video / file message, the way
    /// the web chat does. Returns `nil` on success, else the Thai text to show.
    func sendAttachment(conversationId: String, senderId: String, data: Data, fileName: String, mime: String) async -> String? {
        if let problem = ChatAttachmentRules.sizeProblem(bytes: data.count) { return problem }
        guard !isSending else { return "กำลังส่งอยู่ รอสักครู่" }
        isSending = true
        defer { isSending = false }

        #if DEBUG
        if isFixture { return "fixture: sending is disabled" }
        #endif

        let path = ChatAttachmentRules.storagePath(conversationId: conversationId, date: Date(), fileName: fileName)
        let publicUrl: String
        do {
            try await db.storage.from(ChatAttachmentRules.bucket)
                .upload(path, data: data, options: .init(contentType: mime))
            publicUrl = try db.storage.from(ChatAttachmentRules.bucket).getPublicURL(path: path).absoluteString
        } catch {
            return ChatAttachmentRules.friendlyError(error.localizedDescription)
        }

        do {
            try await insertMessage(AttachmentInsert(
                conversation_id: conversationId, sender_id: senderId, body: fileName,
                msg_type: ChatAttachmentRules.messageType(mime: mime), attachment_url: publicUrl,
                meta: FriendMessageMeta(fileName: fileName, fileSize: data.count)))
        } catch {
            // The row was refused: do not leave an orphan file behind (best effort).
            _ = try? await db.storage.from(ChatAttachmentRules.bucket).remove(paths: [path])
            return ChatAttachmentRules.friendlyError(error.localizedDescription)
        }
        await touchConversation(conversationId)
        return nil
    }

    /// Sends a copy of `message` to another room (same text / same file URL; nothing is uploaded again).
    /// Returns `nil` on success, else the Thai text to show.
    func forward(_ message: FriendMessage, to targetConversationId: String, senderId: String) async -> String? {
        guard ChatAttachmentRules.isForwardable(msgType: message.msgType) else { return "ข้อความนี้ส่งต่อไม่ได้" }
        guard !isSending else { return "กำลังส่งอยู่ รอสักครู่" }
        isSending = true
        defer { isSending = false }

        #if DEBUG
        if isFixture { return "fixture: sending is disabled" }
        #endif

        do {
            try await insertMessage(AttachmentInsert(
                conversation_id: targetConversationId, sender_id: senderId, body: message.body,
                msg_type: message.msgType, attachment_url: message.attachmentUrl, meta: message.meta))
        } catch {
            return "ส่งต่อไม่สำเร็จ: " + ChatAttachmentRules.friendlyError(error.localizedDescription)
        }
        await touchConversation(targetConversationId)
        return nil
    }
}
