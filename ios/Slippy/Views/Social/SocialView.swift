import SwiftUI

struct SocialView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = SocialViewModel()
    @ObservedObject private var sessionStore = PlaySessionStore.shared
    @State private var selectedTab = 0
    @State private var showPlayDashboard = false
    @State private var showAddFriend = false

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    // No NavigationView here — always reached via a NavigationLink push from
    // Dashboard or the "เพิ่มเติม" hub, both of which already own a
    // NavigationStack. This used to hide the outer back button entirely
    // (both by nesting a second navigation context AND explicitly hiding
    // its own bar with .navigationBarHidden — see below), leaving no way
    // back at all once someone pushed into Social from the More hub.
    var body: some View {
            ZStack {
                Color.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("โซเชียล")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(Color.textPrimary)
                        Spacer()
                        if selectedTab == 0 {
                            Button {
                                hapticLight()
                                showAddFriend = true
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "person.badge.plus")
                                    Text("เพิ่มเพื่อน")
                                }
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Color.brand500)
                                .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 12)

                    // Segment chips
                    segmentChips

                    // Content
                    if selectedTab == 0 {
                        friendsTab
                    } else {
                        activitiesTab
                    }
                }
            }
        .task {
            guard !userId.isEmpty else { return }
            await vm.load(userId: userId)
        }
        .sheet(isPresented: $showPlayDashboard) {
            PlayDashboardView()
                .environmentObject(authVM)
        }
        .sheet(isPresented: $showAddFriend) {
            SocialAddFriendSheet(vm: vm)
                .environmentObject(authVM)
        }
    }

    // MARK: – Segment chips
    private var segmentChips: some View {
        HStack(spacing: 8) {
            chipButton(label: "เพื่อน", tag: 0)
            chipButton(label: "กิจกรรม", tag: 1)
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    private func chipButton(label: String, tag: Int) -> some View {
        Button {
            hapticLight()
            withAnimation(.spring(response: 0.25)) {
                selectedTab = tag
            }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(selectedTab == tag ? .white : Color.textSecondary)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(selectedTab == tag ? Color.brand500 : Color.surface)
                .clipShape(Capsule())
        }
    }

    // MARK: – Friends Tab
    private var friendsTab: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                // Search bar
                searchBar

                // Search results
                if !vm.searchResults.isEmpty {
                    searchResultsSection
                }

                // Pending requests
                if !vm.pendingRequests.isEmpty {
                    pendingSection
                }

                // Friends list
                friendsSection
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .refreshable {
            await vm.load(userId: userId)
        }
    }

    private var searchBar: some View {
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

    private var searchResultsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ผลการค้นหา")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.searchResults) { user in
                HStack(spacing: 12) {
                    initialsView(name: user.displayName)
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

    private var pendingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("คำขอเป็นเพื่อน")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)

            ForEach(vm.pendingRequests) { request in
                let name = request.friend?.displayName ?? "ผู้ใช้"
                HStack(spacing: 12) {
                    initialsView(name: name)
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

    private var friendsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !vm.friends.isEmpty {
                Text("เพื่อนของฉัน (\(vm.friends.count))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.textSecondary)

                ForEach(vm.friends) { friend in
                    HStack(spacing: 12) {
                        initialsView(name: friend.displayName)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(friend.displayName)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(Color.textPrimary)
                            Text(friend.email)
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "person.fill.checkmark")
                            .foregroundColor(Color.brand500.opacity(0.7))
                            .font(.system(size: 16))
                    }
                    .padding(12)
                    .background(Color.surface)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
                }
            } else if vm.searchQuery.isEmpty && !vm.isLoading {
                emptyFriendsState
            }
        }
    }

    private var emptyFriendsState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2.slash")
                .font(.system(size: 40))
                .foregroundColor(Color.textSecondary.opacity(0.5))
            Text("ยังไม่มีเพื่อน")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color.textSecondary)
            Text("เริ่มค้นหาเพื่อนด้านบน")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: – Activities Tab
    private var activitiesTab: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                // New activity button
                Button {
                    hapticLight()
                    showPlayDashboard = true
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 20))
                        Text("เริ่มกิจกรรมใหม่")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.brand500)
                    .cornerRadius(14)
                }

                if sessionStore.sessions.isEmpty {
                    emptyActivitiesState
                } else {
                    // Section header
                    HStack {
                        Text("กิจกรรมล่าสุด")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color.textSecondary)
                        Spacer()
                    }

                    ForEach(sessionStore.sessions) { session in
                        activityRow(session)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
    }

    private func activityRow(_ session: SportSession) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.brand500.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: "figure.badminton")
                    .font(.system(size: 20))
                    .foregroundColor(Color.brand500)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(session.startedAt, style: .date)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                HStack(spacing: 6) {
                    Label("\(session.totalShots) ลูก", systemImage: "sportscourt")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                    Text("·")
                        .foregroundColor(Color.textSecondary)
                    Text("\(session.smashCount) Smash")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                    Text("·")
                        .foregroundColor(Color.textSecondary)
                    Text(session.durationFormatted)
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color.textSecondary.opacity(0.5))
        }
        .padding(14)
        .background(Color.surface)
        .cornerRadius(14)
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
    }

    private var emptyActivitiesState: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.badminton")
                .font(.system(size: 40))
                .foregroundColor(Color.textSecondary.opacity(0.5))
            Text("ยังไม่มีกิจกรรม")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color.textSecondary)
            Text("กดเริ่มกิจกรรมใหม่เพื่อบันทึกการเล่น")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: – Initials avatar helper
    private func initialsView(name: String, size: CGFloat = 40) -> some View {
        let initials = name.prefix(1).uppercased()
        return Circle()
            .fill(Color.brand500.opacity(0.15))
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(Color.brand500)
            )
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return SocialView().environmentObject(vm)
}
#endif
