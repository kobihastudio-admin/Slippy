import SwiftUI

struct SplitView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = SplitViewModel()
    @State private var showCreate = false
    @State private var showNotifications = false
    @State private var navigateToProfile = false
    @State private var filter: FilterOption = .all

    enum FilterOption: String, CaseIterable {
        case all       = "ทั้งหมด"
        case waiting   = "รอชำระ"      // waiting on OTHER people to pay
        case owedByMe  = "รอฉันจ่าย"   // waiting on ME to pay
        case settled   = "จ่ายครบแล้ว"
    }

    // MARK: – Current-user identity helpers

    private var myId: String? { authVM.profile?.id }
    private var myEmail: String? { authVM.profile?.email }

    private func isCreator(_ bill: SplitBill) -> Bool {
        guard let myId else { return false }
        return bill.creatorId == myId
    }

    private func myParticipant(_ bill: SplitBill) -> SplitParticipant? {
        guard let myEmail else { return nil }
        return bill.participants?.first { $0.email == myEmail }
    }

    /// Personal stance on a bill relative to the signed-in user — creators
    /// are owed by everyone else who hasn't paid yet; everyone else either
    /// still owes their own share or has already paid it.
    private func personalStance(_ bill: SplitBill) -> (label: String, amount: Double, color: Color)? {
        if isCreator(bill) {
            let owed = (bill.participants ?? [])
                .filter { !$0.isPaid && $0.email != myEmail }
                .reduce(0.0) { $0 + $1.amount }
            if owed > 0 { return ("คุณจะได้รับ", owed, Color(hex: "#db2777")) }
        } else if let mine = myParticipant(bill), !mine.isPaid {
            return ("คุณต้องจ่าย", mine.amount, Color(hex: "#ea580c"))
        }
        return nil
    }

    private func amIWaitingToBePaid(_ bill: SplitBill) -> Bool {
        isCreator(bill) && (bill.participants ?? []).contains { !$0.isPaid && $0.email != myEmail }
    }

    private func doIOwe(_ bill: SplitBill) -> Bool {
        !isCreator(bill) && (myParticipant(bill).map { !$0.isPaid } ?? false)
    }

    var filtered: [SplitBill] {
        switch filter {
        case .all:      return vm.bills
        case .waiting:  return vm.bills.filter { amIWaitingToBePaid($0) }
        case .owedByMe: return vm.bills.filter { doIOwe($0) }
        case .settled:  return vm.bills.filter { $0.isSettled }
        }
    }

    // MARK: – Summary numbers (matches reference mockup's 3 stat cards)

    private var pendingFromFriends: (total: Double, count: Int) {
        let bills = vm.bills.filter { amIWaitingToBePaid($0) }
        let total = bills.reduce(0.0) { sum, bill in
            sum + (bill.participants ?? []).filter { !$0.isPaid && $0.email != myEmail }.reduce(0.0) { $0 + $1.amount }
        }
        return (total, bills.count)
    }

    private var paidInFull: (total: Double, count: Int) {
        let bills = vm.bills.filter { $0.isSettled }
        return (bills.reduce(0.0) { $0 + $1.totalAmount }, bills.count)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#f4f3ff").ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        headerSection
                        titleSection
                        summaryCard
                        filterChips
                            .padding(.horizontal, 20)
                            .padding(.top, 18)
                            .padding(.bottom, 14)

                        if vm.isLoading {
                            ProgressView().tint(Color.brand500).padding(.top, 60)
                        } else if filtered.isEmpty {
                            emptyState
                        } else {
                            recentBillsSection
                        }

                        howItWorksCard
                        Spacer().frame(height: 100)
                    }
                }
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showCreate) {
                CreateSplitView(vm: vm)
                    .environmentObject(authVM)
            }
            .sheet(isPresented: $showNotifications) {
                NotificationsView().environmentObject(authVM)
            }
            .sheet(isPresented: $navigateToProfile) {
                ProfileView().environmentObject(authVM)
            }
            .task {
                if let orgId = authVM.org?.id {
                    await vm.load(orgId: orgId)
                }
            }
            .refreshable {
                if let orgId = authVM.org?.id {
                    await vm.load(orgId: orgId)
                }
            }
        }
    }

    // MARK: – Header (logo + bell + avatar — matches Dashboard's header)

    private var headerSection: some View {
        HStack(alignment: .center, spacing: 10) {
            SlippyLogoMark(size: 36)
            Text("Slippy")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#1e1b4b"))

            Spacer()

            Button { hapticLight(); showNotifications = true } label: {
                Image(systemName: "bell.fill")
                    .font(.system(size: 18))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .frame(width: 40, height: 40)
            }

            Button { hapticLight(); navigateToProfile = true } label: {
                profileAvatar
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var profileAvatar: some View {
        ZStack {
            Circle().fill(Color(hex: "#ede9fe")).frame(width: 40, height: 40)
            if let urlStr = authVM.profile?.avatarUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill().frame(width: 40, height: 40).clipShape(Circle())
                    default:
                        Text(authVM.profile?.displayName.prefix(1).uppercased() ?? "S")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Color(hex: "#6366f1"))
                    }
                }
            } else {
                Text(authVM.profile?.displayName.prefix(1).uppercased() ?? "S")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
        }
    }

    // MARK: – Title + create button

    private var titleSection: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("การหารบิล")
                    .font(.system(size: 26, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Text("จัดการบิลและแบ่งจ่ายกับเพื่อน")
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "#6b7280"))
            }
            Spacer()
            Button { hapticLight(); showCreate = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .bold))
                    Text("สร้างการหารบิล").font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color(hex: "#6366f1"))
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 18)
    }

    // MARK: – Summary card (3 stats — matches reference mockup)

    private var summaryCard: some View {
        HStack(spacing: 0) {
            summaryStat(icon: "doc.text.fill", iconBg: Color(hex: "#ede9fe"), iconFg: Color(hex: "#6366f1"),
                        label: "บิลทั้งหมด", value: "\(vm.bills.count)", sub: "บิล", subColor: Color(hex: "#9ca3af"))
            Divider().frame(height: 44)
            summaryStat(icon: "person.2.fill", iconBg: Color(hex: "#fce7f3"), iconFg: Color(hex: "#db2777"),
                        label: "รอชำระจากเพื่อน", value: fmtTHB(pendingFromFriends.total),
                        sub: "\(pendingFromFriends.count) บิล", subColor: Color(hex: "#db2777"))
            Divider().frame(height: 44)
            summaryStat(icon: "checkmark.circle.fill", iconBg: Color(hex: "#dcfce7"), iconFg: Color(hex: "#16a34a"),
                        label: "จ่ายครบแล้ว", value: fmtTHB(paidInFull.total),
                        sub: "\(paidInFull.count) บิล", subColor: Color(hex: "#16a34a"))
        }
        .padding(.vertical, 16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.04), radius: 10, x: 0, y: 4)
        .padding(.horizontal, 20)
    }

    private func summaryStat(icon: String, iconBg: Color, iconFg: Color, label: String,
                              value: String, sub: String, subColor: Color) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().fill(iconBg).frame(width: 40, height: 40)
                Image(systemName: icon).font(.system(size: 16)).foregroundColor(iconFg)
            }
            Text(value)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 10.5))
                .foregroundColor(Color(hex: "#9ca3af"))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(sub)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(subColor)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: – Filter chips (4 — matches reference mockup)

    private var filterChips: some View {
        // Fixed-width flexible row (not a horizontal scroller) so all 4
        // chips are always visible at once, matching the reference mockup —
        // compact enough at these sizes to fit on the smallest supported
        // screen width without truncating "จ่ายครบแล้ว".
        HStack(spacing: 6) {
            ForEach(FilterOption.allCases, id: \.self) { option in
                Button {
                    hapticLight()
                    filter = option
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: filterIcon(option)).font(.system(size: 10, weight: .semibold))
                        Text(option.rawValue).font(.system(size: 11.5, weight: filter == option ? .semibold : .medium))
                    }
                    .foregroundColor(filter == option ? .white : Color(hex: "#6b7280"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 9)
                    .background(
                        Capsule().fill(filter == option ? Color(hex: "#6366f1") : Color.white)
                    )
                    .overlay(
                        Capsule().stroke(filter == option ? Color.clear : Color(hex: "#e5e7eb"), lineWidth: 1)
                    )
                }
            }
        }
    }

    private func filterIcon(_ option: FilterOption) -> String {
        switch option {
        case .all:      return "list.bullet"
        case .waiting:  return "clock"
        case .owedByMe: return "arrow.down.circle"
        case .settled:  return "checkmark.circle.fill"
        }
    }

    // MARK: – Recent bills list

    private var recentBillsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("บิลล่าสุด")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Spacer()
                NavigationLink("ดูทั้งหมด") { AllSplitBillsView(vm: vm) }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
            .padding(.horizontal, 20)

            VStack(spacing: 12) {
                ForEach(filtered) { bill in
                    NavigationLink(destination: SplitDetailView(bill: bill, vm: vm)) {
                        SplitBillRow(bill: bill, stance: personalStance(bill))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.bottom, 8)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.2")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color(hex: "#c4b5fd"))
            Text("ยังไม่มีรายการหารบิล")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Color(hex: "#6b7280"))
            Text("กด “สร้างการหารบิล” เพื่อเริ่มต้น")
                .font(.system(size: 12))
                .foregroundColor(Color(hex: "#9ca3af"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    // MARK: – "หารบิลง่ายๆ ใน 3 ขั้นตอน" onboarding card (matches mockup)

    private var howItWorksCard: some View {
        NavigationLink {
            SplitWorkflowExampleView()
        } label: {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(hex: "#6366f1").opacity(0.08))

                HStack(spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(LinearGradient(colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1")],
                                                  startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 56, height: 56)
                        SlippyLogoMark(size: 34)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Text("หารบิลง่ายๆ ใน 3 ขั้นตอน")
                                .font(.system(size: 13.5, weight: .bold))
                                .foregroundColor(Color(hex: "#1e1b4b"))
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(Color(hex: "#6366f1"))
                        }

                        HStack(spacing: 8) {
                            howItWorksStep(icon: "camera.fill", label: "1. ถ่ายบิล")
                            Image(systemName: "chevron.right").font(.system(size: 9)).foregroundColor(Color(hex: "#c4b5fd"))
                            howItWorksStep(icon: "person.2.fill", label: "2. เลือกเพื่อน")
                            Image(systemName: "chevron.right").font(.system(size: 9)).foregroundColor(Color(hex: "#c4b5fd"))
                            howItWorksStep(icon: "checkmark.circle.fill", label: "3. เสร็จสิ้น")
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(16)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private func howItWorksStep(icon: String, label: String) -> some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().fill(Color(hex: "#6366f1")).frame(width: 30, height: 30)
                Image(systemName: icon).font(.system(size: 12)).foregroundColor(.white)
            }
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color(hex: "#4b5563"))
                .fixedSize()
        }
    }
}

// MARK: – Split bill row (matches reference mockup — category icon, avatars, personal stance)

struct SplitBillRow: View {
    let bill: SplitBill
    /// (label, amount, color) — e.g. ("คุณต้องจ่าย", 200, orange). nil when
    /// settled or the signed-in user has no personal stake in this bill.
    let stance: (label: String, amount: Double, color: Color)?

    private var categoryGlyph: (emoji: String, tint: Color) {
        let t = bill.title.lowercased()
        if t.contains("dinner") || t.contains("lunch") || t.contains("อาหาร") || t.contains("ข้าว") {
            return ("🍴", Color(hex: "#ea580c"))
        } else if t.contains("coffee") || t.contains("กาแฟ") || t.contains("คาเฟ่") {
            return ("☕️", Color(hex: "#7c3aed"))
        } else if t.contains("taxi") || t.contains("แท็กซี่") || t.contains("grab") || t.contains("เดินทาง") {
            return ("🚕", Color(hex: "#16a34a"))
        } else if t.contains("shop") || t.contains("ช้อป") || t.contains("ห้าง") {
            return ("🛍️", Color(hex: "#db2777"))
        } else {
            return ("🧾", Color(hex: "#6366f1"))
        }
    }

    private var statusBadge: (label: String, color: Color) {
        if bill.isSettled { return ("จ่ายครบแล้ว", Color(hex: "#16a34a")) }
        if stance?.label == "คุณจะได้รับ" { return ("รอชำระจากเพื่อน", Color(hex: "#db2777")) }
        if stance?.label == "คุณต้องจ่าย"  { return ("รอฉันจ่าย", Color(hex: "#ea580c")) }
        return ("รอชำระ", Color(hex: "#9ca3af"))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(categoryGlyph.tint.opacity(0.14)).frame(width: 44, height: 44)
                    Text(categoryGlyph.emoji).font(.system(size: 19))
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(bill.title)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                        .lineLimit(1)
                    Text("\(thaiShortDate(bill.createdAt)) · \(bill.totalCount) คน")
                        .font(.system(size: 11.5))
                        .foregroundColor(Color(hex: "#9ca3af"))
                    avatarStack
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 5) {
                    Text(statusBadge.label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(statusBadge.color)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(statusBadge.color.opacity(0.12))
                        .clipShape(Capsule())

                    Text(fmtTHB(bill.totalAmount))
                        .font(.system(size: 15.5, weight: .bold))
                        .foregroundColor(Color(hex: "#1e1b4b"))

                    if let stance {
                        Text("\(stance.label) \(fmtTHB(stance.amount))")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundColor(stance.color)
                    }
                }
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private var avatarStack: some View {
        HStack(spacing: -8) {
            ForEach(Array((bill.participants ?? []).prefix(4).enumerated()), id: \.offset) { _, p in
                ZStack {
                    Circle().fill(Color(hex: "#ddd6fe")).frame(width: 22, height: 22)
                    Text(p.name.prefix(1).uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color(hex: "#6366f1"))
                }
                .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
            }
            if bill.totalCount > 4 {
                ZStack {
                    Circle().fill(Color(hex: "#e5e7eb")).frame(width: 22, height: 22)
                    Text("+\(bill.totalCount - 4)")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(Color(hex: "#6b7280"))
                }
                .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
            }
        }
        .padding(.top, 2)
    }
}

private func thaiShortDate(_ iso: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "th_TH")
    fmt.dateFormat = "d MMM yy"
    return fmt.string(from: date)
}

// MARK: – "ดูทั้งหมด" — full list with the same filter chips, for when the
// home tab only shows a preview slice.

struct AllSplitBillsView: View {
    @ObservedObject var vm: SplitViewModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(vm.bills) { bill in
                    NavigationLink(destination: SplitDetailView(bill: bill, vm: vm)) {
                        SplitBillRow(bill: bill, stance: nil)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Color(hex: "#f4f3ff").ignoresSafeArea())
        .navigationTitle("บิลทั้งหมด")
        .navigationBarTitleDisplayMode(.inline)
    }
}
