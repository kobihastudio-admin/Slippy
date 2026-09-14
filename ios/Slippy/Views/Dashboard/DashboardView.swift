import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var tabRouter: TabRouter
    @StateObject private var vm      = DashboardViewModel()
    /// Uploads keep being read after the picker closes — this is where the
    /// waiting surfaces, and where the outcome is announced.
    @ObservedObject private var tracker = UploadTracker.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var showCamera           = false
    @State private var showNotifications   = false
    @State private var navigateToDocuments = false
    @State private var navigateToProfile   = false

    // Receipt image viewer (tapped from the recent-docs row icon)
    @State private var showRowImageViewer = false
    @State private var rowImageDoc: SlippyDocument?
    @State private var rowImageURL: URL?
    @State private var rowImageLoading = false
    @State private var rowImageError: String?

    // Swipe-to-delete confirmation
    @State private var docToDelete: SlippyDocument?

    // Reference mockup shows the balance amount togglable via the eye icon
    // (privacy — screen-share/over-the-shoulder). Persists across app
    // launches like a normal user preference.
    @AppStorage("slippy.dashboard.balanceHidden") private var balanceHidden = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Color(hex: "#f4f3ff").ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        headerSection
                        heroBalanceCard
                        featureGrid
                        processingBanner
                        summarySection
                        recentSection
                        notificationsSection
                        lifeGraphSection
                        Spacer().frame(height: 100)
                    }
                }
                .background(Color.clear)

                if vm.isLoading {
                    SlippyLoadingView(message: "กำลังโหลดข้อมูล...")
                        .transition(.opacity.animation(.easeOut(duration: 0.25)))
                }
            }
            .navigationBarHidden(true)
            .task { await loadData() }
            .onChange(of: authVM.org?.id) { _, newOrgId in
                guard newOrgId != nil else { return }
                Task { await loadData() }
            }
            .refreshable { await loadData() }
            // Every observable change in the tracker — a new upload enqueued,
            // a document finishing, one being rejected — is a reason for this
            // screen's numbers to be stale. Reloading on `revision` covers the
            // recent list, the month totals and the credit bar in one pass,
            // which is why the picker no longer needs to report anything back.
            .onChange(of: tracker.revision) { _, _ in
                Task { await loadData() }
            }
            .onChange(of: scenePhase) { _, phase in
                tracker.setPaused(phase != .active)
            }
            // The queue is popped in exactly ONE place — the binding's setter.
            //
            // Doing it in the button as well dismissed two rejections per tap:
            // the button removed the first, SwiftUI then set isPresented to
            // false, and the setter removed what had by then become the first
            // again. Upload two junk photos together and the second rejection
            // was never shown, along with the fact that its credit came back.
            .alert("ไม่ใช่เอกสารการเงิน", isPresented: Binding(
                get: { tracker.rejections.first != nil },
                set: { if !$0, let first = tracker.rejections.first { tracker.dismissRejection(first.id) } }
            )) {
                Button("ตกลง", role: .cancel) { }
            } message: {
                Text(tracker.rejections.first?.reason ?? "")
            }
            .navigationDestination(isPresented: $navigateToDocuments) {
                DocumentsView()
            }
            .sheet(isPresented: $navigateToProfile) {
                ProfileView().environmentObject(authVM)
            }
            .sheet(isPresented: $showCamera) {
                CameraPickerView().environmentObject(authVM)
            }
            .sheet(isPresented: $showNotifications) { NotificationsView().environmentObject(authVM) }
        }
    }

    // MARK: – Load

    private func loadData() async {
        guard let orgId = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString else { return }
        await vm.load(orgId: orgId, userId: userId)
    }

    // MARK: – Header

    private var headerSection: some View {
        HStack(alignment: .center, spacing: 10) {
            SlippyLogoMark(size: 36)
            Text("Slippy")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#1e1b4b"))

            Spacer()

            Button { hapticLight(); showNotifications = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                        .frame(width: 40, height: 40)
                    let unread = vm.notifications.filter { $0.readAt == nil }.count
                    if unread > 0 {
                        Circle().fill(Color(hex: "#ef4444")).frame(width: 9, height: 9)
                            .offset(x: 8, y: 4)
                    }
                }
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
                        img.resizable().scaledToFill()
                            .frame(width: 40, height: 40)
                            .clipShape(Circle())
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

    // MARK: – Hero balance card (purple gradient, matches reference mockup)
    // No income/wallet-balance concept exists in this app's data model (it's
    // an expense/document tracker, not a full ledger) — reusing the real
    // "this month's expense" total here rather than inventing a fake
    // balance number. See DashboardViewModel.totalExpense.

    private var heroBalanceCard: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22)
                .fill(LinearGradient(
                    colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1"), Color(hex: "#4f46e5")],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))

            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(vm.periodLabel == "เดือนนี้" ? "รายจ่ายเดือนนี้" : "รายจ่าย \(vm.periodLabel)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.85))
                        Button { withAnimation(.easeInOut(duration: 0.15)) { balanceHidden.toggle() } } label: {
                            Image(systemName: balanceHidden ? "eye.slash" : "eye")
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.75))
                        }
                    }

                    HStack(spacing: 6) {
                        Text(balanceHidden ? "••••••" : fmtTHB(vm.totalExpense))
                            .font(.system(size: 26, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        NavigationLink { AnalyticsView() } label: {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }

                    heroTrendRow

                    HStack(spacing: 6) {
                        NavigationLink { AnalyticsView() } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "chart.bar.fill").font(.system(size: 10))
                                Text("ดูรายงาน").font(.system(size: 11.5, weight: .semibold))
                            }
                            .foregroundColor(Color(hex: "#4f46e5"))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Color.white)
                            .clipShape(Capsule())
                        }

                        // Only shown when something actually needs attention —
                        // stays out of the way on a clean/empty month.
                        if vm.pendingDocs > 0 {
                            NavigationLink { DocumentsView() } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "clock.fill").font(.system(size: 9))
                                    Text("รอตรวจ \(vm.pendingDocs)")
                                        .font(.system(size: 11, weight: .semibold))
                                        .lineLimit(1)
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Color.white.opacity(0.20))
                                .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.top, 2)
                }

                Spacer(minLength: 4)

                heroWalletArt
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
        .frame(height: 138)
        .shadow(color: Color(hex: "#6366f1").opacity(0.25), radius: 16, x: 0, y: 8)
        .padding(.horizontal, 20)
        .padding(.bottom, 18)
    }

    // Month-over-month spend trend, surfaced right on the hero. Falls back to
    // the last-updated time when there's no prior month to compare against
    // (momLabel returns the sentinel "เดือนนี้"). Colour + arrow mirror the
    // summary card so the whole screen tells one story.
    @ViewBuilder
    private var heroTrendRow: some View {
        let text = vm.spendMomText
        if text == "เดือนนี้" {
            Text("อัปเดตล่าสุด \(currentTimeLabel())")
                .font(.system(size: 10.5))
                .foregroundColor(.white.opacity(0.6))
        } else {
            HStack(spacing: 4) {
                Image(systemName: text.hasPrefix("+") ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(vm.spendMomColor)
                Text(text)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    // MARK: – Hero wallet illustration (layered SwiftUI "3D" wallet + coins)
    // Replaces the flat wallet SF Symbol with a small stacked scene — a soft
    // halo, sparkles, two ฿ coins, and a glossy purple wallet with the Slippy
    // "S" clasp — echoing the reference mockup without needing an image asset.

    private var heroWalletArt: some View {
        ZStack {
            Circle().fill(Color.white.opacity(0.10)).frame(width: 96, height: 96)

            Image(systemName: "sparkle")
                .font(.system(size: 12)).foregroundColor(.white.opacity(0.6))
                .offset(x: -34, y: -30)
            Image(systemName: "sparkle")
                .font(.system(size: 8)).foregroundColor(.white.opacity(0.45))
                .offset(x: 30, y: 30)

            heroCoin(size: 26).offset(x: 28, y: 18)
            heroCoin(size: 20).offset(x: -30, y: 24)

            heroWalletBody
        }
        .frame(width: 104, height: 104)
    }

    private var heroWalletBody: some View {
        ZStack {
            // Card peeking out of the top of the wallet.
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.white.opacity(0.92))
                .frame(width: 44, height: 30)
                .offset(y: -12)
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(hex: "#c4b5fd"))
                .frame(width: 44, height: 30)
                .offset(y: -16)

            // Wallet front, glossy.
            RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [Color(hex: "#a78bfa"), Color(hex: "#7c3aed")],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: 58, height: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(LinearGradient(colors: [Color.white.opacity(0.28), .clear],
                                             startPoint: .top, endPoint: .center))
                        .padding(1)
                )
                .shadow(color: Color(hex: "#4c1d95").opacity(0.45), radius: 6, x: 0, y: 4)

            // "S" clasp on the right edge.
            ZStack {
                Circle().fill(Color.white).frame(width: 18, height: 18)
                Text("S")
                    .font(.system(size: 11, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#7c3aed"))
            }
            .offset(x: 20)
        }
    }

    private func heroCoin(size: CGFloat) -> some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(hex: "#fde68a"), Color(hex: "#f59e0b")],
                                         startPoint: .top, endPoint: .bottom))
            Circle().strokeBorder(Color.white.opacity(0.65), lineWidth: 1)
            Text("฿")
                .font(.system(size: size * 0.52, weight: .bold, design: .rounded))
                .foregroundColor(Color(hex: "#b45309"))
        }
        .frame(width: size, height: size)
        .shadow(color: Color(hex: "#b45309").opacity(0.3), radius: 3, x: 0, y: 2)
    }

    private func currentTimeLabel() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm น."
        return fmt.string(from: Date())
    }

    // MARK: – Feature grid ("ฟีเจอร์หลัก")

    private struct FeatureTile: Identifiable {
        let id = UUID()
        let kind: FeatureIconKind
        let label: String
    }

    private let featureTiles: [FeatureTile] = [
        FeatureTile(kind: .expenses, label: "จัดการรายจ่าย"),
        FeatureTile(kind: .split,    label: "หารบิล"),
        FeatureTile(kind: .sports,   label: "นัดหมายกีฬา"),
        FeatureTile(kind: .trip,     label: "ทริป"),
        FeatureTile(kind: .health,   label: "สุขภาพและยา"),
        FeatureTile(kind: .tasks,    label: "ภารกิจ & แพลน"),
        FeatureTile(kind: .chat,     label: "แชทกับเพื่อน"),
        FeatureTile(kind: .more,     label: "เพิ่มเติม"),
    ]

    @State private var comingSoonLabel: String?

    private var featureGrid: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("ฟีเจอร์หลัก")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Spacer()
                Text("ดูทั้งหมด")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 18) {
                ForEach(featureTiles) { tile in
                    featureTileButton(tile)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
        .alert(item: Binding(
            get: { comingSoonLabel.map { IdentifiableString(value: $0) } },
            set: { comingSoonLabel = $0?.value }
        )) { item in
            Alert(title: Text(item.value), message: Text("ฟีเจอร์นี้กำลังจะมาเร็วๆ นี้"))
        }
    }

    private struct IdentifiableString: Identifiable { let value: String; var id: String { value } }

    @ViewBuilder
    private func featureTileButton(_ tile: FeatureTile) -> some View {
        switch tile.label {
        case "จัดการรายจ่าย":
            NavigationLink { DocumentsView() } label: { featureTileLabel(tile) }
        case "หารบิล":
            // SplitView owns its own NavigationStack (its own tab) —
            // switching tabs instead of pushing avoids nesting one
            // NavigationStack inside another.
            Button { hapticLight(); tabRouter.selected = 1 } label: { featureTileLabel(tile) }
        case "นัดหมายกีฬา":
            Button { hapticLight(); tabRouter.selected = 2 } label: { featureTileLabel(tile) }
        case "ทริป":
            // TripsView, not straight into CreateTripView — the list already
            // owns its own "+"/empty-state create entry point (and reloads
            // itself on save), so this tile now lands on "your trips" first,
            // same as every other list-backed tile here.
            NavigationLink { TripsView() } label: { featureTileLabel(tile) }
        case "สุขภาพและยา":
            NavigationLink { HealthView() } label: { featureTileLabel(tile) }
        case "แชทกับเพื่อน":
            NavigationLink { FriendChatListView() } label: { featureTileLabel(tile) }
        case "เพิ่มเติม":
            Button { hapticLight(); tabRouter.selected = 3 } label: { featureTileLabel(tile) }
        case "ภารกิจ & แพลน":
            NavigationLink { TasksView() } label: { featureTileLabel(tile) }
        default:
            Button { hapticLight(); comingSoonLabel = tile.label } label: { featureTileLabel(tile) }
        }
    }

    private func featureTileLabel(_ tile: FeatureTile) -> some View {
        VStack(spacing: 8) {
            FeatureIcon(kind: tile.kind, size: 56)
            Text(tile.label)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundColor(Color(hex: "#4b5563"))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
    }

    // MARK: – Summary section ("สรุปภาพรวม") — 3 real metrics, no fabricated income

    // NOTE: the previous doc-quota usage strip (docUsed/docQuota/orgPlan) was
    // dropped from the main dashboard layout to match the reference mockup,
    // which has no room for it — that data is still fetched by
    // DashboardViewModel and real, just no longer surfaced here. Worth
    // relocating to ProfileView/Settings if quota visibility matters.

    // MARK: – Background processing banner

    /// The only place the wait is visible now that the picker leaves
    /// immediately. It exists so "ระบบกำลังอ่านอยู่" is a statement on screen
    /// rather than something the user has to infer from a document that shows
    /// no vendor and no total yet.
    @ViewBuilder
    private var processingBanner: some View {
        if tracker.isProcessing {
            HStack(spacing: 12) {
                ProgressView().tint(Color.brand500)
                VStack(alignment: .leading, spacing: 2) {
                    Text("กำลังประมวลผล \(tracker.pending.count) ฉบับ")
                        .font(.system(size: 13.5, weight: .bold))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                    Text("ข้อมูลจะอัพเดทที่หน้านี้เองเมื่ออ่านเสร็จ")
                        .font(.system(size: 11.5))
                        .foregroundColor(Color.textSecondary)
                }
                Spacer()
            }
            .padding(14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.brand500.opacity(0.25)))
            .padding(.horizontal, 20)
            .padding(.bottom, 4)
            .transition(.opacity)
        }
    }

    // MARK: – Stat cards grid (matches web statCards exactly)

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("สรุปภาพรวม")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Spacer()
                HStack(spacing: 4) {
                    Text(vm.periodLabel)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color(hex: "#6366f1"))
                    Image(systemName: "calendar")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color(hex: "#6366f1"))
                }
            }

            HStack(spacing: 10) {
                NavigationLink { DocumentsView() } label: {
                    summaryCard(icon: "arrow.down.circle.fill", iconColor: Color(hex: "#7c3aed"),
                                label: "เอกสาร", value: "\(vm.docsThisMonth)",
                                trend: vm.docMomText, trendColor: vm.docMomColor)
                }
                .buttonStyle(.plain)

                NavigationLink { AnalyticsView() } label: {
                    summaryCard(icon: "arrow.up.circle.fill", iconColor: Color(hex: "#db2777"),
                                label: "รายจ่าย", value: fmtTHB(vm.totalExpense),
                                trend: vm.spendMomText, trendColor: vm.spendMomColor)
                }
                .buttonStyle(.plain)

                NavigationLink { TaxView() } label: {
                    summaryCard(icon: "banknote.fill", iconColor: Color(hex: "#16a34a"),
                                label: "VAT ขอคืนได้", value: fmtTHB(vm.totalVat),
                                trend: nil, trendColor: .clear)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
    }

    private func summaryCard(icon: String, iconColor: Color, label: String, value: String,
                              trend: String?, trendColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundColor(iconColor)

            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color(hex: "#6b7280"))
                .lineLimit(1)

            Text(value)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if let trend {
                Text(trend)
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundColor(trendColor)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    // MARK: – Life Score radar card ("เป้าหมายชีวิต")

    private var lifeScoreCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("เป้าหมายชีวิต")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                    Text("Life Score · 4 มิติของ Slippy")
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: "#9ca3af"))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(Int(vm.overallScore.rounded()))")
                        .font(.system(size: 24, weight: .black, design: .rounded))
                        .foregroundColor(lifeScoreTone(vm.overallScore))
                    Text("Life Score")
                        .font(.system(size: 9))
                        .foregroundColor(Color(hex: "#9ca3af"))
                }
            }

            LifeRadarChart(
                wealth: vm.wealthScore, lifestyle: vm.lifestyleScore,
                journey: vm.journeyScore, social: vm.socialScore
            )
            .frame(height: 200)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
                      spacing: 8) {
                lifeDomainRow("ความมั่งคั่ง", "Wealth", vm.wealthScore, Color(hex: "#8b5cf6"))
                lifeDomainRow("ไลฟ์สไตล์", "Lifestyle", vm.lifestyleScore, Color(hex: "#ec4899"))
                lifeDomainRow("การเดินทาง", "Journey", vm.journeyScore, Color(hex: "#6366f1"))
                lifeDomainRow("สังคม", "Social", vm.socialScore, Color(hex: "#06b6d4"))
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.04), radius: 8, x: 0, y: 2)
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private func lifeDomainRow(_ label: String, _ short: String, _ score: Double, _ color: Color) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Color(hex: "#374151"))
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(hex: "#f3f4f6")).frame(height: 4)
                        Capsule().fill(color).frame(width: g.size.width * (score / 100), height: 4)
                    }
                }
                .frame(height: 4)
            }
            Text("\(Int(score.rounded()))")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(color)
        }
        .padding(10)
        .background(Color(hex: "#f9fafb"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func lifeScoreTone(_ s: Double) -> Color {
        s >= 75 ? Color(hex: "#10b981") : s >= 50 ? Color(hex: "#8b5cf6")
              : s >= 25 ? Color(hex: "#f59e0b") : Color(hex: "#ef4444")
    }

    // MARK: – Recent documents

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("รายการล่าสุด")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Spacer()
                NavigationLink("ดูทั้งหมด") { DocumentsView() }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
            .padding(.horizontal, 20)

            if vm.recentDocs.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "tray.fill")
                        .font(.system(size: 32))
                        .foregroundColor(Color(hex: "#ddd6fe"))
                    Text("ยังไม่มีรายการ")
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#9ca3af"))
                    Text("กดสแกนเพื่อเพิ่มเอกสารแรกของคุณ")
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: "#c4b5fd"))
                }
                .frame(maxWidth: .infinity)
                .padding(40)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .padding(.horizontal, 20)
            } else {
                VStack(spacing: 8) {
                    ForEach(vm.recentDocs) { doc in
                        SwipeActionsRow(actions: swipeActions(for: doc)) {
                            NavigationLink { DocumentDetailView(doc: doc, documents: vm.recentDocs) } label: {
                                DocRow(doc: doc, onTapImage: {
                                    hapticLight()
                                    rowImageDoc = doc
                                    rowImageURL = nil
                                    rowImageError = nil
                                    showRowImageViewer = true
                                    Task { await loadRowImageURL(doc) }
                                })
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.top, 20)
        .sheet(isPresented: $showRowImageViewer) {
            ReceiptImageViewer(
                url: rowImageURL, isLoading: rowImageLoading, error: rowImageError,
                initialRotation: rowImageDoc?.displayRotation ?? 0,
                onSaveRotation: { newRotation in await saveRowRotation(newRotation) }
            )
        }
        .alert("ลบเอกสารนี้?", isPresented: Binding(
            get: { docToDelete != nil },
            set: { if !$0 { docToDelete = nil } }
        )) {
            Button("ลบ", role: .destructive) {
                if let doc = docToDelete {
                    Task { _ = await vm.deleteDocument(doc) }
                }
                docToDelete = nil
            }
            Button("ยกเลิก", role: .cancel) { docToDelete = nil }
        } message: {
            Text("ไม่สามารถกู้คืนได้หลังจากลบแล้ว")
        }
        .alert("ผิดพลาด", isPresented: Binding(
            get: { vm.error != nil },
            set: { if !$0 { vm.error = nil } }
        )) {
            Button("ตกลง", role: .cancel) { vm.error = nil }
        } message: {
            Text(vm.error ?? "")
        }
    }

    // MARK: – Swipe actions (approve/reject hidden once already decided)

    private func swipeActions(for doc: SlippyDocument) -> [SwipeAction] {
        let approveAction = SwipeAction(icon: "checkmark", label: "อนุมัติ", color: Color.statusApproved) {
            hapticSuccess()
            Task { _ = await vm.updateDocumentStatus(doc, status: "approved") }
        }
        let rejectAction = SwipeAction(icon: "xmark", label: "ปฏิเสธ", color: Color(hex: "#f59e0b")) {
            hapticMedium()
            Task {
                let ok = await vm.updateDocumentStatus(doc, status: "rejected")
                if ok { await notifyDocumentSource(documentId: doc.id, action: "rejected", authVM: authVM) }
            }
        }
        let deleteAction = SwipeAction(icon: "trash.fill", label: "ลบ", color: Color.statusFailed) {
            hapticMedium()
            docToDelete = doc
        }

        switch doc.status {
        case "rejected":
            return [deleteAction]
        case "approved":
            return [rejectAction, deleteAction]
        default: // "reviewing" and any other not-yet-decided status
            return [approveAction, rejectAction, deleteAction]
        }
    }

    private func loadRowImageURL(_ doc: SlippyDocument) async {
        rowImageLoading = true
        do {
            rowImageURL = try await SupabaseManager.shared.client
                .storage.from(Config.storageBucket)
                .createSignedURL(path: doc.filePath, expiresIn: 3600)
        } catch {
            rowImageError = "โหลดรูปไม่สำเร็จ: \(error.localizedDescription)"
        }
        rowImageLoading = false
    }

    private func saveRowRotation(_ rotation: Int) async -> Bool {
        guard let doc = rowImageDoc else { return false }
        do {
            // See DocumentDetailView.saveRotation — `.select()` is required to detect
            // RLS silently filtering the row (0 rows updated) instead of erroring.
            let updated: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents")
                .update(["display_rotation": rotation])
                .eq("id", value: doc.id)
                .select()
                .execute()
                .value
            return !updated.isEmpty
        } catch {
            return false
        }
    }

    // MARK: – Activity feed (real notifications table)

    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("กิจกรรมล่าสุด")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Spacer()
                Button("ดูทั้งหมด") { showNotifications = true }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
            .padding(.horizontal, 20)

            if vm.notifications.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 6) {
                        Image(systemName: "tray")
                            .font(.system(size: 24))
                            .foregroundColor(Color(hex: "#d1d5db"))
                        Text("ยังไม่มีกิจกรรม")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: "#9ca3af"))
                    }
                    Spacer()
                }
                .padding(.vertical, 24)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(vm.notifications.enumerated()), id: \.element.id) { idx, n in
                        if idx > 0 { Divider().padding(.leading, 56) }
                        notifRow(n)
                    }
                }
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
                .padding(.horizontal, 20)
            }
        }
        .padding(.top, 20)
    }

    private func notifRow(_ n: AppNotification) -> some View {
        let (icon, color) = notifMeta(n.type)
        return HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(color)
                .frame(width: 32, height: 32)
                .background(color.opacity(0.1))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(n.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .lineLimit(1)
                if let body = n.body {
                    Text(body)
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: "#9ca3af"))
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(relTime(n.createdAt))
                .font(.system(size: 10))
                .foregroundColor(Color(hex: "#9ca3af"))
        }
        .padding(12)
    }

    private func notifMeta(_ type: String) -> (String, Color) {
        switch type {
        case "document_approved":  return ("checkmark.circle.fill", Color(hex: "#10b981"))
        case "document_failed":    return ("exclamationmark.circle.fill", Color(hex: "#ef4444"))
        case "document_duplicate": return ("doc.badge.gearshape.fill", Color(hex: "#f59e0b"))
        case "quota_warning":      return ("exclamationmark.triangle.fill", Color(hex: "#f59e0b"))
        case "quota_exceeded":     return ("exclamationmark.triangle.fill", Color(hex: "#ef4444"))
        case "payment_due":        return ("creditcard.fill", Color(hex: "#f59e0b"))
        case "payment_failed":     return ("creditcard.trianglebadge.exclamationmark", Color(hex: "#ef4444"))
        case "payment_success":    return ("creditcard.fill", Color(hex: "#10b981"))
        case "integration_sync":   return ("bolt.fill", Color(hex: "#8b5cf6"))
        case "line_received":      return ("message.fill", Color(hex: "#06C755"))
        case "email_received":     return ("envelope.fill", Color(hex: "#3b82f6"))
        default:                   return ("bell.fill", Color(hex: "#6366f1"))
        }
    }

    // MARK: – Life Graph: AI Insights + Top merchants

    @ViewBuilder
    private var lifeGraphSection: some View {
        if !vm.lifeInsights.isEmpty || !vm.lifeMerchants.isEmpty {
            VStack(spacing: 14) {
                if !vm.lifeInsights.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Text("💡").font(.system(size: 14))
                            Text("AI Insights")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Color(hex: "#1e1b4b"))
                            Text("\(vm.lifeInsights.count)")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 18, height: 18)
                                .background(Color(hex: "#6366f1"))
                                .clipShape(Circle())
                        }
                        VStack(spacing: 8) {
                            ForEach(vm.lifeInsights) { ins in
                                HStack(alignment: .top, spacing: 10) {
                                    Text(ins.emoji).font(.system(size: 15))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(ins.title)
                                            .font(.system(size: 12.5, weight: .semibold))
                                            .foregroundColor(Color(hex: "#1e1b4b"))
                                        Text(ins.body)
                                            .font(.system(size: 11))
                                            .foregroundColor(Color(hex: "#9ca3af"))
                                            .lineLimit(2)
                                    }
                                }
                            }
                        }
                    }
                    .padding(16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
                }

                if !vm.lifeMerchants.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Text("🏪").font(.system(size: 14))
                            Text("ร้านค้าที่ใช้บ่อย")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Color(hex: "#1e1b4b"))
                        }
                        VStack(spacing: 8) {
                            ForEach(Array(vm.lifeMerchants.enumerated()), id: \.offset) { idx, m in
                                HStack(spacing: 10) {
                                    Text("\(idx + 1)")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundColor(Color(hex: "#9ca3af"))
                                        .frame(width: 26, height: 26)
                                        .background(Color(hex: "#f3f4f6"))
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(m.name)
                                            .font(.system(size: 12.5, weight: .medium))
                                            .foregroundColor(Color(hex: "#1e1b4b"))
                                            .lineLimit(1)
                                        Text("\(m.visitCount) ครั้ง")
                                            .font(.system(size: 10.5))
                                            .foregroundColor(Color(hex: "#9ca3af"))
                                    }
                                    Spacer()
                                    Text(fmtTHB(m.totalSpent))
                                        .font(.system(size: 12.5, weight: .semibold))
                                        .foregroundColor(Color(hex: "#1e1b4b"))
                                }
                            }
                        }
                    }
                    .padding(16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
        }
    }
}

// MARK: – Native SwiftUI radar/spider chart (Wealth · Lifestyle · Journey · Social)

struct LifeRadarChart: View {
    let wealth: Double
    let lifestyle: Double
    let journey: Double
    let social: Double

    private var scores: [Double] { [wealth, lifestyle, journey, social] }
    private let labels = ["Wealth", "Lifestyle", "Journey", "Social"]
    private let colors = [Color(hex: "#8b5cf6"), Color(hex: "#ec4899"),
                           Color(hex: "#6366f1"), Color(hex: "#06b6d4")]

    var body: some View {
        GeometryReader { g in
            let size = min(g.size.width, g.size.height)
            let center = CGPoint(x: g.size.width / 2, y: size / 2)
            let radius = size * 0.36

            ZStack {
                // Grid rings
                ForEach([0.25, 0.5, 0.75, 1.0], id: \.self) { ring in
                    polygonPath(radius: radius * ring, center: center)
                        .stroke(Color(hex: "#e5e7eb"), lineWidth: 1)
                }
                // Axis lines
                ForEach(0..<4, id: \.self) { i in
                    let p = point(for: 1.0, index: i, radius: radius, center: center)
                    Path { path in
                        path.move(to: center)
                        path.addLine(to: p)
                    }
                    .stroke(Color(hex: "#e5e7eb"), lineWidth: 1)
                }
                // Data polygon
                dataPath(radius: radius, center: center)
                    .fill(LinearGradient(colors: [Color(hex: "#8b5cf6").opacity(0.35),
                                                   Color(hex: "#ec4899").opacity(0.25)],
                                          startPoint: .topLeading, endPoint: .bottomTrailing))
                dataPath(radius: radius, center: center)
                    .stroke(Color(hex: "#8b5cf6"), lineWidth: 2)
                // Data point dots
                ForEach(0..<4, id: \.self) { i in
                    let p = point(for: scores[i] / 100, index: i, radius: radius, center: center)
                    Circle().fill(colors[i]).frame(width: 6, height: 6).position(p)
                }
                // Labels
                ForEach(0..<4, id: \.self) { i in
                    let p = point(for: 1.18, index: i, radius: radius, center: center)
                    Text(labels[i])
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color(hex: "#6b7280"))
                        .position(p)
                }
            }
        }
    }

    private func point(for ratio: Double, index: Int, radius: CGFloat, center: CGPoint) -> CGPoint {
        let angle = -Double.pi / 2 + Double(index) * (Double.pi * 2 / 4)
        return CGPoint(
            x: center.x + CGFloat(cos(angle)) * radius * ratio,
            y: center.y + CGFloat(sin(angle)) * radius * ratio
        )
    }

    private func polygonPath(radius: CGFloat, center: CGPoint) -> Path {
        var path = Path()
        for i in 0..<4 {
            let p = point(for: 1.0, index: i, radius: radius, center: center)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }

    private func dataPath(radius: CGFloat, center: CGPoint) -> Path {
        var path = Path()
        for i in 0..<4 {
            let p = point(for: scores[i] / 100, index: i, radius: radius, center: center)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

// MARK: – Swipe-to-delete row wrapper

struct SwipeAction {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void
}

struct SwipeActionsRow<Content: View>: View {
    let actions: [SwipeAction]
    @ViewBuilder var content: () -> Content

    @State private var offsetX: CGFloat = 0
    private let actionWidth: CGFloat = 72
    private var totalWidth: CGFloat { actionWidth * CGFloat(actions.count) }

    var body: some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: 0) {
                Spacer()
                ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { offsetX = 0 }
                        action.action()
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: action.icon).font(.system(size: 16))
                            Text(action.label).font(.system(size: 10, weight: .bold))
                        }
                        .foregroundColor(.white)
                        .frame(width: actionWidth)
                        .frame(maxHeight: .infinity)
                        .background(action.color)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))

            content()
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .offset(x: offsetX)
                // `content()` contains a NavigationLink/Button, which normally
                // wins gesture recognition over a plain `.gesture()` ancestor —
                // `.highPriorityGesture` lets horizontal drags win instead, while
                // a quick tap (never crossing minimumDistance) still reaches the
                // button/link underneath untouched.
                .highPriorityGesture(
                    DragGesture(minimumDistance: 16)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            offsetX = max(-totalWidth, min(0, value.translation.width))
                        }
                        .onEnded { value in
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                offsetX = value.translation.width < -totalWidth / 2 ? -totalWidth : 0
                            }
                        }
                )
        }
    }
}

// MARK: – Doc row

struct DocRow: View {
    let doc: SlippyDocument
    var onTapImage: (() -> Void)? = nil

    /// The category the user actually picked (`expense_category`) takes priority
    /// over the AI-assigned `doc_category` — matching what DocumentDetailView's
    /// picker edits, so the icon/label reflect the user's choice instead of the
    /// AI value (which is often a doc-type like "receipt"/"other").
    private var displayCategory: String? {
        if let c = doc.expenseCategory,
           !c.trimmingCharacters(in: .whitespaces).isEmpty { return c }
        return doc.category
    }

    private var thumbnail: some View {
        CategoryIcon(category: displayCategory, size: 44)
    }

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let onTapImage {
                    Button(action: onTapImage) { thumbnail }
                        .buttonStyle(.plain)
                } else {
                    thumbnail
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(doc.vendorName ?? doc.fileName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .lineLimit(1)
                Text("\(displayCategory ?? "ทั่วไป") · \(relTime(doc.createdAt))")
                    .font(.system(size: 11))
                    .foregroundColor(Color(hex: "#9ca3af"))
                    .lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let amt = doc.totalAmount {
                    Text(fmtTHB(amt))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                }
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color(hex: doc.statusColor))
                        .frame(width: 6, height: 6)
                    Text(doc.statusLabel.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color(hex: doc.statusColor))
                        .tracking(0.4)
                }
            }
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return DashboardView().environmentObject(vm)
}
#endif
