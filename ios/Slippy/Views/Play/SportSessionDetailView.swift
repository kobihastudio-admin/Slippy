import SwiftUI
import PhotosUI

/// Session detail — roster + payment + itemized expenses + PromptPay QR.
/// Native port of the LIFF page's "session-detail" view.
struct SportSessionDetailView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = SportGroupsViewModel()
    @StateObject private var socialVM = SocialViewModel()
    @State private var localSession: SplitBill
    @State private var showShareSheet = false
    @State private var showAddExpense = false
    @State private var showAddFriend = false
    @State private var showPromptPayEdit = false
    @State private var promptpayDraft = ""
    @State private var guestEditId: String?
    @State private var amountEditId: String?
    @State private var amountDraft = ""
    @State private var proofUploadId: String?
    @State private var proofPickerItem: PhotosPickerItem?
    @State private var isWorking = false
    @State private var watchLinked = false

    init(session: SplitBill) {
        self.session = session
        _localSession = State(initialValue: session)
    }

    let session: SplitBill

    private var me: SplitParticipant? {
        localSession.participants?.first { $0.email?.lowercased() == authVM.profile?.email.lowercased() }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                headerCard
                if !localSession.isSettled || (localSession.participants?.isEmpty ?? true) {
                    joinButtonIfNeeded
                }
                watchLinkButton
                rosterCard
                expensesCard
                closeSessionButton
                if let ppid = effectivePromptPayId {
                    promptPaySection(ppid)
                } else {
                    setPromptPayButton
                }
            }
            .padding(16)
            .padding(.bottom, 32)
        }
        .background(Color.background)
        .navigationTitle(localSession.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if localSession.shareToken != nil {
                    Button { hapticLight(); showShareSheet = true } label: {
                        Image(systemName: "square.and.arrow.up").foregroundColor(Color.brand500)
                    }
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if let token = localSession.shareToken {
                ShareBillSheet(shareToken: token).presentationDetents([.medium])
            }
        }
        .sheet(isPresented: $showAddExpense) { addExpenseSheet }
        .sheet(isPresented: $showAddFriend) { addFriendSheet }
        .task { await vm.loadExpenses(billId: localSession.id) }
        .onChange(of: proofPickerItem) { _, item in
            guard let item, let id = proofUploadId else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    isWorking = true
                    if let updated = await vm.uploadProof(bill: localSession, participantId: id, imageData: data) {
                        localSession = updated
                    }
                    isWorking = false
                }
                proofUploadId = nil
            }
        }
        .alert("ผิดพลาด", isPresented: Binding(
            get: { vm.error != nil }, set: { if !$0 { vm.error = nil } }
        )) {
            Button("ตกลง", role: .cancel) { vm.error = nil }
        } message: { Text(vm.error ?? "") }
    }

    private var effectivePromptPayId: String? {
        localSession.promptpayId
    }

    // MARK: – Header

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(sportEmoji(for: localSession.sportType)) \(localSession.title)")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text(fmtTHB(localSession.totalAmount))
                    .font(.system(size: 20, weight: .bold))
            }
            if let date = localSession.bookingDate {
                Label(date + " · " + timeRangeLabel(localSession.startTime, localSession.endTime),
                      systemImage: "calendar").font(.system(size: 12))
            }
            if let venue = localSession.venue {
                Label(venue, systemImage: "mappin.and.ellipse").font(.system(size: 12))
            }
            HStack {
                Text("\(localSession.paidCount)/\(localSession.totalCount) คนชำระแล้ว")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                if localSession.status == "finalized" {
                    Text("🔒 ปิด Session แล้ว").font(.system(size: 12, weight: .semibold))
                } else if localSession.isSettled && localSession.totalCount > 0 {
                    Text("จ่ายครบแล้ว 🎉").font(.system(size: 12, weight: .semibold))
                }
            }
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(LinearGradient(colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1")],
                                    startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: Color(hex: "#6366f1").opacity(0.3), radius: 10, y: 4)
    }

    @ViewBuilder
    private var joinButtonIfNeeded: some View {
        if me == nil {
            Button {
                Task {
                    guard let name = authVM.profile?.displayName, let email = authVM.profile?.email else { return }
                    hapticLight()
                    if let updated = await vm.join(bill: localSession, name: name, email: email) {
                        localSession = updated; hapticSuccess()
                    }
                }
            } label: {
                Text("เข้าร่วมนัดนี้")
                    .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private var watchLinkButton: some View {
        Button {
            hapticLight()
            PhoneConnectivityManager.shared.linkUpcomingSession(billId: localSession.id, title: localSession.title)
            watchLinked = true
        } label: {
            HStack {
                Image(systemName: watchLinked ? "checkmark.circle.fill" : "applewatch")
                Text(watchLinked ? "ส่งไปยัง Apple Watch แล้ว — กดเริ่มบนนาฬิกาได้เลย" : "เริ่มจับเวลาด้วย Apple Watch")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(watchLinked ? Color.statusApproved : Color.brand500)
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background((watchLinked ? Color.statusApproved : Color.brand500).opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: – Roster (tree: friends added via "เพิ่มเพื่อน" nest under their adder)

    private func childrenOf(_ id: String) -> [SplitParticipant] {
        (localSession.participants ?? []).filter { $0.addedByParticipantId == id }
    }

    /// Depth-first flatten of the roster tree so we can render it as a flat
    /// list with per-row indentation (and know where to put dividers).
    private var rosterTree: [(p: SplitParticipant, depth: Int)] {
        var result: [(p: SplitParticipant, depth: Int)] = []
        func walk(_ p: SplitParticipant, depth: Int) {
            result.append((p, depth))
            for child in childrenOf(p.id) { walk(child, depth: depth + 1) }
        }
        for root in (localSession.participants ?? []).filter({ $0.addedByParticipantId == nil }) {
            walk(root, depth: 0)
        }
        return result
    }

    private var rosterCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("ผู้เข้าร่วม").font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                Spacer()
                Button { hapticLight(); showAddFriend = true } label: {
                    Label("เพิ่มเพื่อน", systemImage: "person.badge.plus").font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color.brand500)
                }
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)

            let tree = rosterTree
            ForEach(tree, id: \.p.id) { row in
                participantRow(row.p, depth: row.depth)
                if row.p.id != tree.last?.p.id {
                    Divider().padding(.leading, 56 + CGFloat(row.depth) * 24)
                }
            }
            if tree.isEmpty {
                Text("ยังไม่มีผู้เข้าร่วม").font(.system(size: 13)).foregroundColor(Color.textSecondary)
                    .padding(16)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func participantRow(_ p: SplitParticipant, depth: Int) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                if depth > 0 {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.system(size: 12)).foregroundColor(Color.textSecondary.opacity(0.5))
                }
                ZStack {
                    Circle().fill(p.isPaid ? Color.green.opacity(0.15) : Color.brand500.opacity(0.12))
                        .frame(width: 36, height: 36)
                    if p.isPaid {
                        Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundColor(.green)
                    } else {
                        Text(String(p.name.prefix(1))).font(.system(size: 14, weight: .semibold)).foregroundColor(Color.brand500)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(p.name).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
                        if p.effectiveGuestCount > 0 {
                            Text("+\(p.effectiveGuestCount)").font(.system(size: 11, weight: .bold)).foregroundColor(Color.brand500)
                        }
                    }
                    if p.pendingReview {
                        Text("รอตรวจสลิป").font(.system(size: 11)).foregroundColor(.orange)
                    } else if p.isPaid, let paidAt = p.paidAt {
                        Text("ชำระ " + relTime(paidAt)).font(.system(size: 11)).foregroundColor(.green)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if amountEditId == p.id {
                        HStack(spacing: 4) {
                            TextField("0", text: $amountDraft).keyboardType(.decimalPad)
                                .frame(width: 60).font(.system(size: 13)).foregroundColor(Color.textPrimary)
                            Button("✓") {
                                Task {
                                    if let amt = Double(amountDraft),
                                       let updated = await vm.setAmount(bill: localSession, participantId: p.id, amount: amt) {
                                        localSession = updated
                                    }
                                    amountEditId = nil
                                }
                            }
                        }
                    } else {
                        Text(fmtTHB(p.amount)).font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                            .onTapGesture { amountEditId = p.id; amountDraft = String(format: "%.0f", p.amount) }
                    }
                    if !p.isPaid && !p.pendingReview {
                        Button {
                            hapticLight()
                            Task {
                                if let updated = await vm.markPaid(bill: localSession, participantId: p.id) {
                                    localSession = updated
                                }
                            }
                        } label: {
                            Text("ทำเครื่องหมายชำระ").font(.system(size: 11, weight: .medium)).foregroundColor(Color.brand500)
                        }
                    } else if p.isPaid {
                        Button {
                            hapticLight()
                            Task {
                                if let updated = await vm.unpay(bill: localSession, participantId: p.id) {
                                    localSession = updated
                                }
                            }
                        } label: {
                            Text("ยกเลิกการทำเครื่องหมายชำระ").font(.system(size: 11, weight: .medium)).foregroundColor(.orange)
                        }
                    }
                }
                if depth > 0 {
                    Button {
                        hapticMedium()
                        Task {
                            if let updated = await vm.removeParticipant(bill: localSession, participantId: p.id) {
                                localSession = updated
                            }
                        }
                    } label: {
                        Image(systemName: "trash").font(.system(size: 13)).foregroundColor(Color.textSecondary.opacity(0.5))
                    }
                }
            }

            if p.pendingReview, let url = p.paymentProofUrl, let imgURL = URL(string: url) {
                HStack(spacing: 10) {
                    AsyncImage(url: imgURL) { phase in
                        if let img = phase.image { img.resizable().scaledToFill() }
                        else { Color(hex: "#f3f4f6") }
                    }
                    .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 8))
                    Spacer()
                    Button {
                        Task {
                            hapticSuccess()
                            if let updated = await vm.reviewPayment(bill: localSession, participantId: p.id, approve: true) {
                                localSession = updated
                            }
                        }
                    } label: {
                        Text("อนุมัติ").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.statusApproved).clipShape(Capsule())
                    }
                    Button {
                        Task {
                            hapticMedium()
                            if let updated = await vm.reviewPayment(bill: localSession, participantId: p.id, approve: false) {
                                localSession = updated
                            }
                        }
                    } label: {
                        Text("ปฏิเสธ").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.statusFailed).clipShape(Capsule())
                    }
                }
            }

            if p.email?.lowercased() == authVM.profile?.email.lowercased() && !p.isPaid {
                HStack {
                    Stepper("ผู้ติดตาม +\(p.effectiveGuestCount)", value: Binding(
                        get: { p.effectiveGuestCount },
                        set: { newVal in
                            Task {
                                if let updated = await vm.setGuestCount(bill: localSession, participantId: p.id, count: newVal) {
                                    localSession = updated
                                }
                            }
                        }
                    ), in: 0...10)
                    .font(.system(size: 12))
                }
                if !p.pendingReview {
                    PhotosPicker(selection: $proofPickerItem, matching: .images) {
                        HStack(spacing: 6) {
                            if isWorking && proofUploadId == p.id { ProgressView().scaleEffect(0.7) }
                            else { Image(systemName: "paperclip") }
                            Text("แนบสลิปโอนเงิน").font(.system(size: 12, weight: .medium))
                        }
                        .foregroundColor(Color.brand500)
                    }
                    .onTapGesture { proofUploadId = p.id }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: – Close session

    /// True once the booking's date + end time (or start time, if no end
    /// time was set) has passed — mirrors the web LIFF page's
    /// `isRegistrationClosed` check.
    private var isSessionPast: Bool {
        guard let date = localSession.bookingDate else { return false }
        let timeStr = localSession.endTime ?? localSession.startTime ?? "23:59"
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"
        guard let deadline = fmt.date(from: "\(date)T\(timeStr)") else { return false }
        return Date() > deadline
    }

    /// Only offer to close the session once it's over *and* the bill is
    /// fully settled — closing earlier would lock out people who still owe.
    private var canCloseSession: Bool {
        localSession.status != "finalized" && isSessionPast
            && localSession.isSettled && localSession.totalCount > 0
    }

    @ViewBuilder
    private var closeSessionButton: some View {
        if canCloseSession {
            Button {
                hapticSuccess()
                Task {
                    if let updated = await vm.closeSession(bill: localSession) {
                        localSession = updated
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "lock.fill")
                    Text("ปิด Session — เคลียร์ค่าใช้จ่ายเรียบร้อยแล้ว")
                }
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Color.statusApproved).clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    // MARK: – Expenses

    private var expensesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("ค่าใช้จ่าย").font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                Spacer()
                Button { hapticLight(); showAddExpense = true } label: {
                    Label("เพิ่ม", systemImage: "plus.circle.fill").font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color.brand500)
                }
            }
            if vm.sessionExpenses.isEmpty {
                Text("ยังไม่มีค่าใช้จ่าย").font(.system(size: 12)).foregroundColor(Color.textSecondary)
            } else {
                ForEach(vm.sessionExpenses) { exp in
                    let info = expenseCategoryInfo(exp.category)
                    HStack {
                        Text(info.emoji)
                        Text(exp.label?.isEmpty == false ? exp.label! : info.label)
                            .font(.system(size: 13)).foregroundColor(Color.textPrimary)
                        Spacer()
                        Text(fmtTHB(exp.amount)).font(.system(size: 13, weight: .semibold))
                        Button {
                            Task {
                                if let updated = await vm.deleteExpense(bill: localSession, expenseId: exp.id) {
                                    localSession = updated
                                }
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundColor(Color.textSecondary.opacity(0.5))
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private var addExpenseSheet: some View {
        AddSportExpenseSheet { category, label, amount in
            Task {
                if let updated = await vm.addExpense(bill: localSession, category: category, label: label, amount: amount) {
                    localSession = updated
                }
                showAddExpense = false
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: – Add friend

    private var rosterEmails: Set<String> {
        Set((localSession.participants ?? []).compactMap { $0.email?.lowercased() })
    }

    private var addFriendSheet: some View {
        AddFriendSheet(
            socialVM: socialVM,
            excludedEmails: rosterEmails,
            onPick: { friend in
                Task {
                    if let updated = await vm.addParticipant(
                        bill: localSession, name: friend.displayName, email: friend.email,
                        addedBy: me?.id
                    ) {
                        localSession = updated; hapticSuccess()
                    }
                    showAddFriend = false
                }
            },
            onInviteViaLine: {
                showAddFriend = false
                // Small delay so the sheet finishes dismissing before the
                // system share sheet presents — avoids a "already presenting" conflict.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { presentInviteShareSheet() }
            }
        )
        .task { if let userId = authVM.session?.user.id.uuidString { await socialVM.load(userId: userId) } }
        .presentationDetents([.medium, .large])
    }

    /// Opens the system share sheet with the session's join link. LINE is
    /// registered as a share target on-device, so tapping it lets the user
    /// pick a LINE friend *or* a LINE group to send the invite to — LINE's own
    /// "share one-time" SDK API was deprecated/shut down by LINE in 2023, so
    /// the system share sheet is the only working way to reach LINE's picker now.
    private func presentInviteShareSheet() {
        guard let token = localSession.shareToken else { return }
        let url = Config.webAppURL.appendingPathComponent("split/join/\(token)").absoluteString
        let text = "\(sportEmoji(for: localSession.sportType)) ชวนเล่น \(localSession.title) — กดลิงก์เพื่อเข้าร่วม: \(url)"
        let av = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let vc = scene.windows.first?.rootViewController {
            vc.present(av, animated: true)
        }
    }

    // MARK: – PromptPay

    private func promptPaySection(_ ppid: String) -> some View {
        VStack(spacing: 12) {
            HStack {
                Label("PromptPay", systemImage: "qrcode").font(.system(size: 13, weight: .semibold))
                Spacer()
                Button("เปลี่ยน") { promptpayDraft = ppid; showPromptPayEdit = true }
                    .font(.system(size: 12)).foregroundColor(Color.brand500)
            }
            if let myAmount = me?.amount, myAmount > 0,
               let qrImage = PromptPayQR.image(target: ppid, amount: myAmount) {
                Image(uiImage: qrImage).resizable().scaledToFit().frame(width: 200, height: 200)
                Text("ยอดที่ต้องโอน: \(fmtTHB(myAmount))")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
            } else {
                Text("เข้าร่วมนัดนี้เพื่อรับ QR สำหรับโอนเงิน")
                    .font(.system(size: 12)).foregroundColor(Color.textSecondary)
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
        .alert("เบอร์ PromptPay", isPresented: $showPromptPayEdit) {
            TextField("เบอร์โทร/เลขบัตรประชาชน", text: $promptpayDraft)
            Button("บันทึก") {
                Task {
                    _ = await vm.setPromptPay(billId: localSession.id, value: promptpayDraft)
                    localSession.promptpayId = promptpayDraft
                }
            }
            Button("ยกเลิก", role: .cancel) {}
        }
    }

    private var setPromptPayButton: some View {
        Button {
            promptpayDraft = ""; showPromptPayEdit = true
        } label: {
            Label("ตั้งค่า PromptPay สำหรับรับเงิน", systemImage: "qrcode")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Color.brand500.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .alert("เบอร์ PromptPay", isPresented: $showPromptPayEdit) {
            TextField("เบอร์โทร/เลขบัตรประชาชน", text: $promptpayDraft)
            Button("บันทึก") {
                Task {
                    _ = await vm.setPromptPay(billId: localSession.id, value: promptpayDraft)
                    localSession.promptpayId = promptpayDraft
                }
            }
            Button("ยกเลิก", role: .cancel) {}
        }
    }
}

// MARK: – Add expense sheet

private struct AddSportExpenseSheet: View {
    let onAdd: (String, String?, Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var category = expenseCategories[0].value
    @State private var label = ""
    @State private var amount = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("หมวดหมู่").font(.system(size: 13, weight: .semibold))
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(expenseCategories, id: \.value) { cat in
                        Button { category = cat.value } label: {
                            VStack(spacing: 4) {
                                Text(cat.emoji).font(.system(size: 18))
                                Text(cat.label).font(.system(size: 10))
                            }
                            .foregroundColor(category == cat.value ? Color.brand500 : Color.textPrimary)
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(category == cat.value ? Color.brand500.opacity(0.1) : Color.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10)
                                .stroke(category == cat.value ? Color.brand500 : Color.border))
                        }
                    }
                }
                TextField("รายละเอียด (ไม่บังคับ)", text: $label)
                    .padding(10).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 10))
                TextField("จำนวนเงิน", text: $amount).keyboardType(.decimalPad)
                    .padding(10).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 10))
                Button {
                    guard let amt = Double(amount), amt > 0 else { return }
                    onAdd(category, label.isEmpty ? nil : label, amt)
                } label: {
                    Text("เพิ่มค่าใช้จ่าย").font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
            .padding(20)
            .navigationTitle("เพิ่มค่าใช้จ่าย")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
            }
        }
    }
}

// MARK: – Add friend sheet

/// Picks a friend (accepted `friendships`) to add directly to the roster —
/// skips the join-link flow since they're already a known Slippy user.
private struct AddFriendSheet: View {
    @ObservedObject var socialVM: SocialViewModel
    let excludedEmails: Set<String>
    let onPick: (UserProfile) -> Void
    let onInviteViaLine: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var source: Source = .app

    private enum Source: String, CaseIterable { case app = "จากแอป", line = "LINE / กลุ่ม LINE" }

    private var filteredFriends: [UserProfile] {
        socialVM.friends.filter { friend in
            !excludedEmails.contains(friend.email.lowercased())
            && (query.trimmingCharacters(in: .whitespaces).isEmpty
                || friend.displayName.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $source) {
                    ForEach(Source.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(16)

                if source == .line {
                    lineInviteContent
                } else {
                    appFriendContent
                }
            }
            .navigationTitle("เพิ่มเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
            }
        }
    }

    @ViewBuilder
    private var appFriendContent: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundColor(Color.textSecondary)
            TextField("ค้นหาเพื่อน", text: $query)
        }
        .padding(10)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16).padding(.bottom, 8)

        if socialVM.isLoading {
            Spacer()
            ProgressView()
            Spacer()
        } else if filteredFriends.isEmpty {
            Spacer()
            Text(socialVM.friends.isEmpty ? "ยังไม่มีเพื่อนในระบบ" : "ไม่พบเพื่อนที่ค้นหา")
                .font(.system(size: 13)).foregroundColor(Color.textSecondary)
            Spacer()
        } else {
            List(filteredFriends) { friend in
                Button { onPick(friend) } label: {
                    HStack(spacing: 12) {
                        Circle().fill(Color.brand500.opacity(0.12)).frame(width: 36, height: 36)
                            .overlay(Text(String(friend.displayName.prefix(1)))
                                .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.brand500))
                        Text(friend.displayName).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
                        Spacer()
                        Image(systemName: "plus.circle.fill").foregroundColor(Color.brand500)
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    @ViewBuilder
    private var lineInviteContent: some View {
        Spacer()
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Color(hex: "#06C755").opacity(0.12)).frame(width: 64, height: 64)
                Image(systemName: "paperplane.fill").font(.system(size: 26)).foregroundColor(Color(hex: "#06C755"))
            }
            Text("ส่งลิงก์เชิญผ่าน LINE").font(.system(size: 15, weight: .semibold)).foregroundColor(Color.textPrimary)
            Text("เลือกเพื่อนหรือกลุ่ม LINE ปลายทางได้จากหน้าแชร์ของ LINE")
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center).padding(.horizontal, 32)
            Button {
                onInviteViaLine()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "square.and.arrow.up"); Text("เลือกเพื่อน/กลุ่ม LINE")
                }
                .font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(Color(hex: "#06C755")).clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        Spacer()
    }
}
