import SwiftUI

// Search field, search results and incoming friend requests. Shared by
// `SocialView` (friends tab) and `SocialAddFriendSheet`; the bodies are the
// code that used to live in `SocialView`, unchanged in behavior.

struct InitialsCircle: View {
    let name: String
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(Color.brand500.opacity(0.15))
            .frame(width: size, height: size)
            .overlay(
                Text(ChatPresentation.initial(for: name))
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(Color.brand500)
            )
    }
}

struct FriendSearchBar: View {
    @ObservedObject var vm: SocialViewModel
    /// The Social tab and the add-friend sheet share one view model. The bar
    /// that is covered by the sheet passes `false` so each keystroke starts a
    /// single search, not two racing ones.
    var isActive = true

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(Color.textSecondary)
                .font(.system(size: 16))
            TextField("ค้นหาเพื่อนด้วยชื่อ", text: $vm.searchQuery)
                .foregroundColor(Color.textPrimary)
                .font(.system(size: 15))
                .onSubmit {
                    Task { await vm.searchUsers(query: vm.searchQuery) }
                }
                .onChange(of: vm.searchQuery) { _, newVal in
                    guard isActive else { return }
                    if newVal.isEmpty {
                        vm.searchResults = []
                    } else {
                        Task { await vm.searchUsers(query: newVal) }
                    }
                }
            if !vm.searchQuery.isEmpty {
                Button {
                    vm.searchQuery = ""
                    vm.searchResults = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Color.textSecondary)
                }
            }
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
    }
}

struct FriendSearchResults: View {
    @ObservedObject var vm: SocialViewModel
    let userId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ผลการค้นหา")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.searchResults) { user in
                HStack(spacing: 12) {
                    InitialsCircle(name: user.displayName)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                        Text(user.email)
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                    }
                    Spacer()
                    // Don't show "add" button for self or existing friends
                    if user.id != userId && !vm.friends.contains(where: { $0.id == user.id }) {
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.sendFriendRequest(fromUserId: userId, toUserId: user.id)
                                hapticSuccess()
                                vm.searchQuery = ""
                                vm.searchResults = []
                            }
                        } label: {
                            Text("เพิ่มเพื่อน")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(Color.brand500)
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(12)
                .background(Color.surface)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
            }
        }
    }
}

struct FriendRequestList: View {
    @ObservedObject var vm: SocialViewModel
    let userId: String
    /// The add-friend sheet shows "คำขอเป็นเพื่อน (n)"; the Social tab keeps its plain header.
    var showsCount = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(showsCount ? "คำขอเป็นเพื่อน (\(vm.pendingRequests.count))" : "คำขอเป็นเพื่อน")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.pendingRequests) { request in
                let name = request.friend?.displayName ?? "ผู้ใช้"
                HStack(spacing: 12) {
                    InitialsCircle(name: name)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(name) ส่งคำขอเป็นเพื่อน")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        if let email = request.friend?.email {
                            Text(email)
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                        }
                    }
                    Spacer()
                    HStack(spacing: 8) {
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.acceptRequest(friendshipId: request.id)
                                hapticSuccess()
                                await vm.load(userId: userId)
                            }
                        } label: {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Color.brand500)
                                .clipShape(Circle())
                        }
                        .accessibilityLabel("ยอมรับคำขอจาก \(name)")
                        Button {
                            hapticLight()
                            Task {
                                try? await vm.removeFriend(friendshipId: request.id)
                                await vm.load(userId: userId)
                            }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                                .frame(width: 32, height: 32)
                                .background(Color.surface)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color.border, lineWidth: 1))
                        }
                        .accessibilityLabel("ปฏิเสธคำขอจาก \(name)")
                    }
                }
                .padding(12)
                .background(Color.surface)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
                .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            }
        }
    }
}
