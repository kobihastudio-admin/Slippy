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
                FriendSearchBar(vm: vm, isActive: !showAddFriend)

                // Search results
                if !vm.searchResults.isEmpty {
                    FriendSearchResults(vm: vm, userId: userId)
                }

                // Pending requests
                if !vm.pendingRequests.isEmpty {
                    FriendRequestList(vm: vm, userId: userId)
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
        InitialsCircle(name: name, size: size)
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
