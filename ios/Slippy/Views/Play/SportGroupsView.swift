import SwiftUI

/// "นัดกีฬา" — native port of `web/src/app/liff/sport/page.tsx`'s list view:
/// recurring groups + standalone sessions, with a create-group sheet.
struct SportGroupsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = SportGroupsViewModel()
    @State private var showCreate = false

    var body: some View {
            ZStack {
                Color.background.ignoresSafeArea()

                if vm.isLoading {
                    ProgressView().tint(Color.brand500)
                } else if vm.groups.isEmpty && vm.standaloneSessions.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if !vm.groups.isEmpty {
                                Text("🔁 กลุ่มประจำของฉัน")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Color.textSecondary)
                                ForEach(vm.groups) { group in
                                    NavigationLink {
                                        SportGroupDetailView(group: group)
                                    } label: {
                                        SportGroupCard(group: group) {
                                            Task {
                                                hapticMedium()
                                                _ = await vm.deleteGroup(id: group.id)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }

                            if !vm.standaloneSessions.isEmpty {
                                Text("📌 เซสชันเดี่ยว")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Color.textSecondary)
                                    .padding(.top, vm.groups.isEmpty ? 0 : 8)
                                ForEach(vm.standaloneSessions) { session in
                                    NavigationLink {
                                        SportSessionDetailView(session: session)
                                    } label: {
                                        SportSessionCard(session: session) {
                                            Task {
                                                hapticMedium()
                                                _ = await vm.deleteSession(id: session.id)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(16)
                        .padding(.bottom, 32)
                    }
                }
            }
            .navigationTitle("นัดกีฬา")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        hapticLight()
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(Color.brand500)
                    }
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateSportGroupView(vm: vm)
                    .environmentObject(authVM)
            }
            .task { await load() }
            .refreshable { await load() }
            .alert("ผิดพลาด", isPresented: Binding(
                get: { vm.error != nil }, set: { if !$0 { vm.error = nil } }
            )) {
                Button("ตกลง", role: .cancel) { vm.error = nil }
            } message: { Text(vm.error ?? "") }
    }

    private func load() async {
        guard let orgId = authVM.org?.id else { return }
        await vm.load(orgId: orgId)
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle()
                    .fill(Color.brand500.opacity(0.12))
                    .frame(width: 76, height: 76)
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 32))
                    .foregroundColor(Color.brand500)
            }
            Text("ยังไม่มีกลุ่มกีฬา")
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color.textSecondary)
            Text("กด + เพื่อสร้างกลุ่มแรกของคุณ")
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary.opacity(0.7))
            Spacer()
        }
    }
}

// MARK: – Group card

struct SportGroupCard: View {
    let group: SportGroup
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.brand500.opacity(0.12))
                    .frame(width: 48, height: 48)
                Text(sportEmoji(for: group.sportType)).font(.system(size: 22))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(group.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .lineLimit(1)
                Text(recurringDaysLabel(group.recurringDays))
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
                if group.defaultStartTime != nil || group.defaultVenue != nil {
                    Text(timeRangeLabel(group.defaultStartTime, group.defaultEndTime) +
                         (group.defaultVenue != nil ? " · \(group.defaultVenue!)" : ""))
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Button(action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundColor(Color.textSecondary)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color.textSecondary.opacity(0.5))
        }
        .padding(14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }
}

// MARK: – Standalone session card

struct SportSessionCard: View {
    let session: SplitBill
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.brand500.opacity(0.12))
                    .frame(width: 48, height: 48)
                Text(sportEmoji(for: session.sportType)).font(.system(size: 22))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title).font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary).lineLimit(1)
                if let date = session.bookingDate {
                    Text(date + " · " + timeRangeLabel(session.startTime, session.endTime))
                        .font(.system(size: 11)).foregroundColor(Color.textSecondary)
                }
                HStack(spacing: 10) {
                    Text(fmtTHB(session.totalAmount))
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(Color.brand500)
                    Text("\(session.paidCount)/\(session.totalCount) จ่ายแล้ว")
                        .font(.system(size: 11)).foregroundColor(Color.textSecondary)
                }
            }
            Spacer()
            Button(action: onDelete) {
                Image(systemName: "trash").font(.system(size: 14)).foregroundColor(Color.textSecondary)
            }
        }
        .padding(14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return SportGroupsView().environmentObject(vm)
}
#endif
