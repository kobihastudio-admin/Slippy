import SwiftUI

/// Mobile counterpart of `web/src/app/(app)/notifications/page.tsx` — same
/// data source (`notifications` table), same icon/colour mapping per type,
/// same Thai relative-time labels, same unread-highlight + mark-as-read /
/// mark-all-read flows, so the experience feels identical across platforms.
struct NotificationsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = NotificationsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.items.isEmpty {
                    loadingSkeleton
                } else if vm.items.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .background(Color.background)
            .navigationTitle("การแจ้งเตือน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("ปิด") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 14) {
                        if vm.unreadCount > 0 {
                            Button {
                                Task { await vm.markAllRead(userId: userId, orgId: authVM.org?.id) }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "checkmark.circle")
                                    Text("อ่านทั้งหมด")
                                }
                                .font(.system(size: 12.5, weight: .semibold))
                            }
                            .disabled(vm.marking)
                        }
                        Button {
                            Task { await reload() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .rotationEffect(.degrees(vm.isLoading ? 360 : 0))
                                .animation(vm.isLoading ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default,
                                           value: vm.isLoading)
                        }
                        .disabled(vm.isLoading)
                    }
                    .foregroundColor(Color.brand500)
                }
            }
        }
        .task { await reload() }
    }

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    private func reload() async {
        guard !userId.isEmpty else { return }
        await vm.load(userId: userId, orgId: authVM.org?.id)
    }

    // MARK: – List
    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                statusHeader

                if let err = vm.error {
                    errorBanner(err)
                }

                VStack(spacing: 1) {
                    ForEach(vm.items) { n in
                        notificationRow(n)
                    }
                }
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
                .padding(.horizontal, 16)
            }
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .refreshable { await reload() }
    }

    private var statusHeader: some View {
        Text(vm.unreadCount > 0 ? "\(vm.unreadCount) รายการยังไม่ได้อ่าน" : "อ่านทั้งหมดแล้ว")
            .font(.system(size: 13))
            .foregroundColor(Color.textSecondary)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
    }

    @ViewBuilder
    private func errorBanner(_ msg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(Color.errorText)
            Text(msg).font(.system(size: 13)).foregroundColor(Color.errorText)
        }
        .padding(12)
        .background(Color(hex: "#7f1d1d").opacity(0.12))
        .cornerRadius(10)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private func notificationRow(_ n: AppNotification) -> some View {
        Button {
            guard n.isUnread else { return }
            hapticLight()
            Task { await vm.markOne(n.id) }
        } label: {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: n.iconName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Color(hex: n.iconTint))
                    .frame(width: 38, height: 38)
                    .background(Color(hex: n.iconTint).opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top) {
                        Text(n.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        if n.isUnread {
                            Circle().fill(Color.brand500).frame(width: 8, height: 8).padding(.top, 4)
                        }
                    }
                    if let body = n.body, !body.isEmpty {
                        Text(body)
                            .font(.system(size: 12.5))
                            .foregroundColor(Color.textSecondary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(3)
                    }
                    Text(n.relativeTimeString())
                        .font(.system(size: 10.5))
                        .foregroundColor(Color.textSecondary)
                        .padding(.top, 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(n.isUnread ? Color.brand500.opacity(0.06) : Color.clear)
        }
        .buttonStyle(.plain)
    }

    // MARK: – Empty state
    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 40, weight: .light))
                .foregroundColor(Color.textSecondary)
            Text("ยังไม่มีการแจ้งเตือน")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: – Loading skeleton
    private var loadingSkeleton: some View {
        VStack(spacing: 1) {
            ForEach(0..<4, id: \.self) { _ in
                HStack(alignment: .top, spacing: 14) {
                    RoundedRectangle(cornerRadius: 11).fill(Color.surfaceMuted).frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4).fill(Color.surfaceMuted).frame(width: 160, height: 13)
                        RoundedRectangle(cornerRadius: 4).fill(Color.surfaceMuted).frame(width: 220, height: 11)
                        RoundedRectangle(cornerRadius: 4).fill(Color.surfaceMuted).frame(width: 70, height: 9)
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .redacted(reason: .placeholder)
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return NotificationsView().environmentObject(vm)
}
#endif
