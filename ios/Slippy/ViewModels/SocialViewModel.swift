import SwiftUI
import Supabase

@MainActor
final class SocialViewModel: ObservableObject {
    @Published var friends: [UserProfile] = []
    @Published var pendingRequests: [Friendship] = []
    @Published var isLoading = false
    @Published var searchResults: [UserProfile] = []
    @Published var searchQuery = ""
    @Published var errorMessage: String?
    @Published var inviteToken: String?

    private let db = SupabaseManager.shared.client

    /// QR-code and share-link payload — same token format/table the web app
    /// uses (see supabase/migrations/052_friendships.sql). Scanning this URL
    /// on any platform lands on `/friends/join/[token]`.
    var inviteURL: URL? {
        guard let token = inviteToken else { return nil }
        return Config.webAppURL.appendingPathComponent("friends/join/\(token)")
    }

    /// Fetch this user's existing invite link, or mint a new one if none
    /// exists yet / the old one expired — mirrors web/src/app/api/friends/invite/route.ts.
    func loadOrCreateInviteLink(userId: String) async {
        struct InviteLinkRow: Codable {
            let token: String
            let expiresAt: String
            enum CodingKeys: String, CodingKey { case token; case expiresAt = "expires_at" }
        }
        do {
            let existing: [InviteLinkRow] = try await db
                .from("friend_invite_links")
                .select("token, expires_at")
                .eq("user_id", value: userId)
                .order("created_at", ascending: false)
                .limit(1)
                .execute()
                .value

            let iso = ISO8601DateFormatter()
            if let row = existing.first, let expiry = iso.date(from: row.expiresAt), expiry > Date() {
                inviteToken = row.token
                return
            }

            struct InviteLinkInsert: Encodable {
                let userId: String
                enum CodingKeys: String, CodingKey { case userId = "user_id" }
            }
            let created: [InviteLinkRow] = try await db
                .from("friend_invite_links")
                .insert(InviteLinkInsert(userId: userId))
                .select("token, expires_at")
                .execute()
                .value
            inviteToken = created.first?.token
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Redeem someone else's QR/link token — routed through a SECURITY
    /// DEFINER RPC (see supabase/migrations/070_friend_invite_rpc.sql)
    /// since `friend_invite_links` RLS only lets the *owner* read their own
    /// row, and this app has no service-role key to bypass that the way the
    /// web app's server route does.
    func acceptInvite(token: String) async throws -> String {
        struct Result: Decodable {
            let ownerId: String
            let ownerName: String?
            enum CodingKeys: String, CodingKey { case ownerId = "owner_id"; case ownerName = "owner_name" }
        }
        struct Params: Encodable {
            let pToken: String
            enum CodingKeys: String, CodingKey { case pToken = "p_token" }
        }
        let rows: [Result] = try await db
            .rpc("accept_friend_invite", params: Params(pToken: token))
            .execute()
            .value
        return rows.first?.ownerName ?? "เพื่อนใหม่"
    }

    // MARK: – Load accepted friends + pending incoming requests
    func load(userId: String) async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil

        do {
            // Fetch all friendships where user is involved
            let rows: [Friendship] = try await db
                .from("friendships")
                .select("id, requester_id, addressee_id, status, created_at")
                .or("requester_id.eq.\(userId),addressee_id.eq.\(userId)")
                .execute()
                .value

            let accepted = rows.filter { $0.status == "accepted" }
            let incoming = rows.filter { $0.status == "pending" && $0.addresseeId == userId }

            // Collect friend IDs from accepted friendships
            let friendIds = accepted.map { row in
                row.requesterId == userId ? row.addresseeId : row.requesterId
            }

            if !friendIds.isEmpty {
                let profiles: [UserProfile] = try await db
                    .from("users")
                    .select("id, email, full_name, avatar_url")
                    .in("id", values: friendIds)
                    .execute()
                    .value
                friends = profiles
            } else {
                friends = []
            }

            // Attach requester profiles to pending requests
            let requesterIds = incoming.map { $0.requesterId }
            var pendingWithProfiles = incoming
            if !requesterIds.isEmpty {
                let requesterProfiles: [UserProfile] = try await db
                    .from("users")
                    .select("id, email, full_name, avatar_url")
                    .in("id", values: requesterIds)
                    .execute()
                    .value
                let profileMap = Dictionary(uniqueKeysWithValues: requesterProfiles.map { ($0.id, $0) })
                pendingWithProfiles = incoming.map { f in
                    var copy = f
                    copy.friend = profileMap[f.requesterId]
                    return copy
                }
            }
            pendingRequests = pendingWithProfiles

        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: – Search users by full_name or email
    func searchUsers(query: String) async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            searchResults = []
            return
        }
        do {
            let results: [UserProfile] = try await db
                .from("users")
                .select("id, email, full_name, avatar_url")
                .ilike("full_name", pattern: "%\(query)%")
                .limit(20)
                .execute()
                .value
            searchResults = results
        } catch {
            searchResults = []
            errorMessage = error.localizedDescription
        }
    }

    // MARK: – Send friend request
    func sendFriendRequest(fromUserId: String, toUserId: String) async throws {
        struct FriendshipInsert: Encodable {
            let requesterId: String
            let addresseeId: String

            enum CodingKeys: String, CodingKey {
                case requesterId = "requester_id"
                case addresseeId = "addressee_id"
            }
        }
        try await db
            .from("friendships")
            .insert(FriendshipInsert(requesterId: fromUserId, addresseeId: toUserId))
            .execute()
    }

    // MARK: – Accept a pending request
    func acceptRequest(friendshipId: String) async throws {
        try await db
            .from("friendships")
            .update(["status": "accepted"])
            .eq("id", value: friendshipId)
            .execute()
    }

    // MARK: – Remove / decline a friendship
    func removeFriend(friendshipId: String) async throws {
        try await db
            .from("friendships")
            .delete()
            .eq("id", value: friendshipId)
            .execute()
    }
}
