import SwiftUI

// "ยอดค้าง" UI: the friends-list row with its chip, the slim chat line, and
// the detail screen. All of it hides when the balance cannot be loaded.

struct FriendBalanceChip: View {
    let text: String
    let theyOweMe: Bool

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(theyOweMe ? Color.brand500 : Color.textSecondary)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(theyOweMe ? Color.brand50 : Color.surfaceMuted)
            .clipShape(Capsule())
    }
}

/// A friend in the friends list. `net` is `nil` when unknown or not loaded.
struct FriendRow: View {
    let friend: UserProfile
    let net: Double?

    var body: some View {
        HStack(spacing: 12) {
            InitialsCircle(name: friend.displayName)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Text(friend.email)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
            }
            Spacer()
            if let net, let text = BalancePresentation.chipText(net: net) {
                FriendBalanceChip(text: text, theyOweMe: net > 0)
            } else {
                Image(systemName: "person.fill.checkmark")
                    .foregroundColor(Color.brand500.opacity(0.7))
                    .font(.system(size: 16))
            }
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Slim tappable line under a 1:1 chat's title. Hidden when the net is zero,
/// unknown, or the load failed.
struct BalanceChatLine: View {
    @ObservedObject var vm: BalanceViewModel
    let friendId: String
    let friendName: String
    @State private var showDetail = false

    var body: some View {
        // The sheet is attached to the Group, not to the conditional line: if a
        // reload fails while the detail is open, the line disappears but the
        // sheet must stay and show its own error message.
        Group {
            if !vm.loadFailed,
               let summary = vm.summary(for: friendId),
               let text = BalancePresentation.chatLine(net: summary.net) {
                Button { hapticLight(); showDetail = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "bahtsign.circle")
                        Text(text)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.brand500)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.brand50)
                }
                .buttonStyle(.plain)
            }
        }
        .sheet(isPresented: $showDetail) {
            BalanceDetailView(friendId: friendId, friendName: friendName, vm: vm)
        }
    }
}

struct BalanceDetailView: View {
    let friendId: String
    let friendName: String
    @ObservedObject var vm: BalanceViewModel
    @Environment(\.dismiss) private var dismiss

    private let order: [BalancePresentation.SourceKind] = [.bill, .sport, .trip, .request]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if vm.loadFailed {
                        Text("โหลดยอดค้างไม่สำเร็จ ลองใหม่อีกครั้ง")
                            .font(.system(size: 14)).foregroundColor(Color.textSecondary)
                    } else if let summary = vm.summary(for: friendId),
                              !summary.entries.isEmpty || summary.unattributedCount > 0 {
                        content(summary)
                    } else {
                        Text(BalancePresentation.sentence(name: friendName, net: 0))
                            .font(.system(size: 16, weight: .medium)).foregroundColor(Color.textSecondary)
                    }
                    if !vm.tripsIncluded {
                        Text("ยังไม่รวมยอดจากทริป")
                            .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle("ยอดค้างกับ \(friendName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } } }
            .task { await vm.load() }
        }
    }

    @ViewBuilder private func content(_ summary: BalancePresentation.Summary) -> some View {
        Text(BalancePresentation.sentence(name: friendName, net: summary.net, hasBreakdown: !summary.entries.isEmpty))
            .font(.system(size: 22, weight: .bold)).foregroundColor(Color.textPrimary)

        ForEach(order, id: \.self) { kind in
            let rows = summary.entries.filter { $0.sourceKind == kind }
            if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(BalancePresentation.kindTitle(kind))
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                    ForEach(rows) { row in entryRow(row) }
                }
            }
        }

        if summary.unattributedCount > 0 {
            Text("มี \(summary.unattributedCount) รายการที่คำนวณยอดให้ไม่ได้")
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
        }
    }

    private func entryRow(_ row: BalancePresentation.Entry) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title ?? BalancePresentation.kindTitle(row.sourceKind))
                    .font(.system(size: 15, weight: .medium)).foregroundColor(Color.textPrimary).lineLimit(2)
                Text(subtitle(row))
                    .font(.system(size: 12)).foregroundColor(Color.textSecondary)
            }
            Spacer()
            Text(BalancePresentation.money(row.amount))
                .font(.system(size: 15, weight: .semibold)).foregroundColor(Color.textPrimary)
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func subtitle(_ row: BalancePresentation.Entry) -> String {
        let who = row.direction == .theyOweMe ? "ค้างคุณ" : "คุณค้าง"
        guard let raw = row.occurredAt, let date = ChatPresentation.parseISO(raw) else { return who }
        return "\(who) · \(ChatPresentation.dateLabel(date, now: Date()))"
    }
}
