import SwiftUI

struct Settlement: Identifiable {
    let id = UUID()
    let from: String
    let to: String
    let amount: Double
}

private enum ExpenseSummaryScope: String, CaseIterable {
    case trip = "ทั้งทริป"
    case day = "รายวัน"
    case meal = "รายมื้อ"
}

func simplifyDebts(_ participants: [SplitParticipant]) -> [Settlement] {
    var balances: [String: Double] = [:]
    for p in participants {
        if balances[p.name] == nil { balances[p.name] = 0 }
        if p.isPaid { balances[p.name]! += p.amount }
        else        { balances[p.name]! -= p.amount }
    }
    var creditors = balances.filter { $0.value > 0 }.map { (name: $0.key, net: $0.value) }.sorted { $0.net > $1.net }
    var debtors   = balances.filter { $0.value < 0 }.map { (name: $0.key, net: $0.value) }.sorted { $0.net < $1.net }
    var result: [Settlement] = []
    var ci = 0, di = 0
    while ci < creditors.count && di < debtors.count {
        let amount = min(creditors[ci].net, -debtors[di].net)
        result.append(Settlement(from: debtors[di].name, to: creditors[ci].name, amount: amount))
        creditors[ci].net -= amount
        debtors[di].net   += amount
        if creditors[ci].net < 1 { ci += 1 }
        if abs(debtors[di].net) < 1 { di += 1 }
    }
    return result
}

struct SplitDetailView: View {
    let bill: SplitBill
    @ObservedObject var vm: SplitViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var localBill: SplitBill
    @State private var showDeleteConfirm = false
    @State private var markingPaidId: String?
    @State private var showSettleUp = false
    @State private var showShareSheet = false
    @State private var summaryScope: ExpenseSummaryScope = .trip

    init(bill: SplitBill, vm: SplitViewModel) {
        self.bill = bill
        self.vm = vm
        self._localBill = State(initialValue: bill)
    }

    var settlements: [Settlement] {
        simplifyDebts(localBill.participants ?? [])
    }

    var body: some View {
        ZStack {
            Color.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    amountCard
                    journeyExpenseSummary
                    progressCard
                    participantsList
                    if !(localBill.participants ?? []).isEmpty {
                        balanceSection
                    }
                    if let note = localBill.note, !note.isEmpty {
                        noteCard(note: note)
                    }
                    deleteButton
                }
                .padding(16)
                .padding(.bottom, 32)
            }
        }
        .navigationTitle(localBill.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 14) {
                    if localBill.shareToken != nil {
                        Button {
                            hapticLight()
                            showShareSheet = true
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 15))
                                .foregroundColor(Color.brand500)
                        }
                    }
                    if !settlements.isEmpty {
                        Button {
                            hapticLight()
                            showSettleUp = true
                        } label: {
                            Text("ชำระหนี้")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Color.brand500)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if let token = localBill.shareToken {
                ShareBillSheet(shareToken: token)
                    .presentationDetents([.medium])
            }
        }
        .sheet(isPresented: $showSettleUp) {
            SettleUpSheet(settlements: settlements)
                .presentationDetents([.medium])
        }
        .confirmationDialog("ลบรายการหารบิล?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("ลบ", role: .destructive) {
                Task {
                    do {
                        try await vm.deleteBill(id: localBill.id)
                        if let orgId = authVM.org?.id {
                            await vm.load(orgId: orgId)
                        }
                        dismiss()
                    } catch {
                        // silently ignore
                    }
                }
            }
            Button("ยกเลิก", role: .cancel) {}
        } message: {
            Text("การกระทำนี้ไม่สามารถย้อนกลับได้")
        }
    }

    private var amountCard: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(LinearGradient(
                    colors: [Color(hex: "#0E1527"), Color(hex: "#1A2742")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("JOURNEY · EXPENSES")
                        .font(.system(size: 10, weight: .bold)).tracking(1.2)
                        .foregroundColor(Color(hex: "#C7D2FE"))
                Text("ยอดรวมทั้งหมด")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.8))
                Text(fmtTHB(localBill.totalAmount))
                    .font(.system(size: 36, weight: .bold))
                    .foregroundColor(.white)
                if localBill.isSettled {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("ชำระครบแล้ว")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                    .padding(.top, 2)
                }
                }
                Spacer()
                avatarStack
            }
            .padding(20)
        }
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(hex: "#27324D"), lineWidth: 1))
        .shadow(color: .black.opacity(0.16), radius: 10, y: 5)
    }

    private var avatarStack: some View {
        HStack(spacing: -8) {
            ForEach(Array((localBill.participants ?? []).prefix(4))) { participant in
                participantAvatar(participant, size: 36)
            }
        }
    }

    private func participantAvatar(_ participant: SplitParticipant, size: CGFloat) -> some View {
        Group {
            if let raw = participant.linePictureUrl, let url = URL(string: raw) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() }
                    placeholder: { avatarFallback(participant, size: size) }
            } else {
                avatarFallback(participant, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 2))
    }

    private func avatarFallback(_ participant: SplitParticipant, size: CGFloat) -> some View {
        ZStack {
            Circle().fill(Color.brand500)
            Text(String(participant.name.prefix(1))).font(.system(size: size * 0.36, weight: .bold)).foregroundColor(.white)
        }
        .frame(width: size, height: size)
    }

    private var journeyExpenseSummary: some View {
        let receipts = localBill.receipts ?? []
        let groups: [(String, Double, Int)] = {
            if receipts.isEmpty { return [("ค่าใช้จ่ายทั้งหมด", localBill.totalAmount, 0)] }
            var values: [String: (Double, Int)] = [:]
            for receipt in receipts {
                let key: String
                switch summaryScope {
                case .trip: key = "ค่าใช้จ่ายทั้งหมด"
                case .day: key = receipt.expenseDate
                case .meal: key = receipt.mealLabel
                }
                let old = values[key] ?? (0, 0)
                values[key] = (old.0 + receipt.amount, old.1 + 1)
            }
            return values.map { ($0.key, $0.value.0, $0.value.1) }.sorted { $0.0 < $1.0 }
        }()

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("สรุปค่าใช้จ่าย").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    Text("ภาพรวมของ Journey นี้").font(.system(size: 10)).foregroundColor(Color(hex: "#9CA9C4"))
                }
                Spacer()
            }
            HStack(spacing: 4) {
                ForEach(ExpenseSummaryScope.allCases, id: \.self) { scope in
                    Button { withAnimation(.easeInOut(duration: 0.2)) { summaryScope = scope } } label: {
                        Text(scope.rawValue).font(.system(size: 11, weight: .semibold))
                            .foregroundColor(summaryScope == scope ? .white : Color(hex: "#9CA9C4"))
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(summaryScope == scope ? Color.brand500 : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(.plain)
                }
            }.padding(4).background(Color(hex: "#171F35"), in: RoundedRectangle(cornerRadius: 12))

            ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                summaryGroupRow(label: group.0, amount: group.1, count: group.2)
            }
        }
        .padding(14).background(Color(hex: "#0E1527"), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#27324D"), lineWidth: 1))
    }

    private func summaryGroupRow(label: String, amount: Double, count: Int) -> some View {
        let icon = summaryScope == .day ? "calendar" : (summaryScope == .meal ? "fork.knife" : "wallet.pass")
        let subtitle = count == 0 ? "ยังไม่มีใบเสร็จที่เชื่อมไว้" : "\(count) ใบเสร็จ"
        return HStack(spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand300)
                .frame(width: 32, height: 32)
                .background(Color.brand500.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                Text(subtitle).font(.system(size: 10)).foregroundColor(Color(hex: "#9CA9C4"))
            }
            Spacer()
            Text(fmtTHB(amount)).font(.system(size: 14, weight: .bold)).foregroundColor(Color.brand300)
        }
        .padding(11).background(Color(hex: "#171F35"), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#27324D"), lineWidth: 1))
    }

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(localBill.paidCount)/\(localBill.totalCount) คนชำระแล้ว")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                let pct = localBill.totalCount > 0
                    ? Int(Double(localBill.paidCount) / Double(localBill.totalCount) * 100)
                    : 0
                Text("\(pct)%")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color.brand500)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.border)
                        .frame(height: 10)
                    let w = localBill.totalCount > 0
                        ? geo.size.width * Double(localBill.paidCount) / Double(localBill.totalCount)
                        : 0
                    RoundedRectangle(cornerRadius: 6)
                        .fill(localBill.isSettled ? Color.green : Color.brand500)
                        .frame(width: w, height: 10)
                        .animation(.spring(response: 0.4), value: localBill.paidCount)
                }
            }
            .frame(height: 10)
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private var participantsList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("ผู้เข้าร่วม")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 8)

            ForEach(localBill.participants ?? []) { participant in
                participantRow(participant)
                if participant.id != (localBill.participants ?? []).last?.id {
                    Divider()
                        .padding(.leading, 56)
                }
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func participantRow(_ participant: SplitParticipant) -> some View {
        HStack(spacing: 12) {
            participantAvatar(participant, size: 36)
                .overlay(alignment: .bottomTrailing) {
                    if participant.isPaid {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12)).foregroundColor(.green).background(Color.white, in: Circle())
                    }
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(participant.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textPrimary)
                if participant.isPaid, let paidAt = participant.paidAt {
                    Text("ชำระ " + relTime(paidAt))
                        .font(.system(size: 11))
                        .foregroundColor(.green)
                } else if let email = participant.email, !email.isEmpty {
                    Text(email)
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(fmtTHB(participant.amount))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)

                if !participant.isPaid {
                    Button {
                        hapticLight()
                        Task { await markPaid(participant: participant) }
                    } label: {
                        if markingPaidId == participant.id {
                            ProgressView()
                                .scaleEffect(0.7)
                        } else {
                            Text("ทำเครื่องหมายชำระ")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(Color.brand500)
                        }
                    }
                    .disabled(markingPaidId == participant.id)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func noteCard(note: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "note.text")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                Text("หมายเหตุ")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.textSecondary)
            }
            Text(note)
                .font(.system(size: 14))
                .foregroundColor(Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private var deleteButton: some View {
        Button {
            hapticLight()
            showDeleteConfirm = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "trash")
                Text("ลบรายการหารบิล")
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(.red)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.red.opacity(0.3), lineWidth: 1))
        }
    }

    private var balanceSection: some View {
        let participants = localBill.participants ?? []
        guard !participants.isEmpty else { return AnyView(EmptyView()) }
        return AnyView(
            VStack(alignment: .leading, spacing: 0) {
                Text("ยอดสุทธิต่อคน")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.textSecondary)
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 8)

                ForEach(participants) { p in
                    HStack(spacing: 10) {
                        participantAvatar(p, size: 32)
                        Text(p.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(fmtTHB(p.amount))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color.textPrimary)
                            Text(p.isPaid ? "ชำระแล้ว" : "ค้างชำระ")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(p.isPaid ? .green : .orange)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    if p.id != participants.last?.id {
                        Divider().padding(.leading, 54)
                    }
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
        )
    }

    private func markPaid(participant: SplitParticipant) async {
        markingPaidId = participant.id
        defer { markingPaidId = nil }
        do {
            try await vm.markPaid(participantId: participant.id)
            hapticSuccess()
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let nowStr = iso.string(from: Date())
            if var parts = localBill.participants,
               let idx = parts.firstIndex(where: { $0.id == participant.id }) {
                let old = parts[idx]
                parts[idx] = SplitParticipant(
                    id: old.id,
                    splitBillId: old.splitBillId,
                    name: old.name,
                    email: old.email,
                    amount: old.amount,
                    paidAt: nowStr,
                    createdAt: old.createdAt,
                    guestCount: old.guestCount,
                    paymentProofUrl: old.paymentProofUrl,
                    addedByParticipantId: old.addedByParticipantId,
                    linePictureUrl: old.linePictureUrl
                )
                localBill = SplitBill(
                    id: localBill.id,
                    organizationId: localBill.organizationId,
                    creatorId: localBill.creatorId,
                    title: localBill.title,
                    totalAmount: localBill.totalAmount,
                    note: localBill.note,
                    shareToken: localBill.shareToken,
                    lineGroupId: localBill.lineGroupId,
                    status: localBill.status,
                    createdAt: localBill.createdAt,
                    participants: parts,
                    receipts: localBill.receipts
                )
            }
        } catch {
            // silently ignore
        }
    }
}

/* ─── Settle Up Sheet ───────────────────────────────────────────────────── */
struct SettleUpSheet: View {
    let settlements: [Settlement]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        if settlements.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 48))
                                    .foregroundColor(.green)
                                Text("ชำระครบแล้ว!")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(Color.textPrimary)
                                Text("ไม่มียอดค้างชำระระหว่างกัน")
                                    .font(.system(size: 14))
                                    .foregroundColor(Color.textSecondary)
                            }
                            .padding(.top, 48)
                        } else {
                            Text("คำนวณจากอัลกอริทึมลดจำนวนรายการ")
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 20)
                                .padding(.top, 8)

                            ForEach(settlements) { s in
                                HStack(spacing: 14) {
                                    // From avatar
                                    ZStack {
                                        Circle()
                                            .fill(Color(hex: "#fee2e2"))
                                            .frame(width: 40, height: 40)
                                        Text(String(s.from.prefix(1)))
                                            .font(.system(size: 15, weight: .bold))
                                            .foregroundColor(.red)
                                    }

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.from)
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundColor(Color.textPrimary)
                                        HStack(spacing: 4) {
                                            Text("จ่ายให้")
                                                .font(.system(size: 12))
                                                .foregroundColor(Color.textSecondary)
                                            Text(s.to)
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundColor(Color.brand500)
                                        }
                                    }

                                    Spacer()

                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(fmtTHB(s.amount))
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundColor(Color.brand500)
                                        // To avatar
                                        ZStack {
                                            Circle()
                                                .fill(Color(hex: "#d1fae5"))
                                                .frame(width: 32, height: 32)
                                            Text(String(s.to.prefix(1)))
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundColor(.green)
                                        }
                                    }
                                }
                                .padding(14)
                                .background(Color.surface)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
                                .padding(.horizontal, 20)
                            }
                        }
                    }
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle("ชำระหนี้")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("เสร็จ") { dismiss() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color.brand500)
                }
            }
        }
    }
}
