import SwiftUI
import LocalAuthentication
import Supabase
import PhotosUI

private enum ProfileTab: String, CaseIterable, Identifiable {
    case info = "ข้อมูลส่วนตัว"
    case notifications = "การแจ้งเตือน"
    case security = "ความปลอดภัย"
    var id: String { rawValue }
}

struct ProfileView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var profileVM = ProfileViewModel()
    @State private var biometric      = false
    @State private var resetPasswordMessage: String?
    @State private var lineNotif      = true
    @State private var weeklyRpt      = false
    @State private var docNotif       = true
    @State private var showLogoutAlert = false
    @State private var loggingOut     = false
    @State private var tab: ProfileTab = .info
    @State private var showEditName    = false
    @State private var showOrgSwitcher = false
    @State private var editedName      = ""
    @State private var savingName      = false
    @State private var editedDOB: Date = Date()
    @State private var hasDOB          = false

    // Photo pickers
    @State private var avatarItem:     PhotosPickerItem?
    @State private var bgItem:         PhotosPickerItem?
    @State private var uploadingAvatar = false
    @State private var customBgData:   Data? = UserDefaults.standard.data(forKey: "slippy_profile_bg")

    private var role: String { authVM.membership?.role ?? "member" }
    private let roleColors: [String: Color] = [
        "owner": Color(hex: "#f59e0b"), "admin": Color(hex: "#8b5cf6"),
        "accountant": Color(hex: "#6366f1"), "member": Color(hex: "#94a3b8")
    ]
    private let roleLabels: [String: String] = [
        "owner":"OWNER","admin":"ADMIN","accountant":"ACCOUNTANT","member":"MEMBER"
    ]

    // No NavigationStack here — always reached via a push from Dashboard,
    // SplitView, or the "เพิ่มเติม" hub, all of which already own one.
    var body: some View {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(spacing: 0) {
                        heroCard
                        tabBar
                            .padding(.top, 20)

                        switch tab {
                        case .info:          infoTabContent
                        case .notifications: notificationsTabContent
                        case .security:      securityTabContent
                        }

                        logoutButton
                    }
                    .padding(.bottom, 100)
                }
                .background(Color.background)
                .navigationBarTitleDisplayMode(.inline)
                .onAppear {
                    // `bool(forKey:)` returns false for a key that was never
                    // written, so on a fresh install this silently flipped every
                    // switch OFF — contradicting the `= true` declared above, and
                    // then persisting that false through onChange. Read the
                    // stored value only when one exists.
                    biometric = storedFlag("slippy_biometric", default: biometric)
                    lineNotif = storedFlag("slippy_line_notif", default: lineNotif)
                    weeklyRpt = storedFlag("slippy_weekly_rpt", default: weeklyRpt)
                    docNotif  = storedFlag("slippy_doc_notif",  default: docNotif)
                }
                .alert("เปลี่ยนรหัสผ่าน",
                       isPresented: Binding(get: { resetPasswordMessage != nil },
                                            set: { if !$0 { resetPasswordMessage = nil } })) {
                    Button("ตกลง", role: .cancel) { resetPasswordMessage = nil }
                } message: { Text(resetPasswordMessage ?? "") }
                .task {
                    guard let orgId = authVM.org?.id,
                          let userId = authVM.session?.user.id.uuidString else { return }
                    await profileVM.load(orgId: orgId, userId: userId)
                }

                // Floating support / chat button (matches web FAB)
                Button {
                    UIApplication.shared.open(URL(string: "mailto:hello@slippy.app")!)
                } label: {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 54, height: 54)
                        .background(
                            LinearGradient(colors: [Color(hex: "#8b5cf6"), Color(hex: "#6366f1")],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .clipShape(Circle())
                        .shadow(color: Color(hex: "#6366f1").opacity(0.4), radius: 14, x: 0, y: 6)
                }
                .padding(.trailing, 20)
                .padding(.bottom, 24)
            }
        .alert("ออกจากระบบ", isPresented: $showLogoutAlert) {
            Button("ยกเลิก", role: .cancel) {}
            Button("ออกจากระบบ", role: .destructive) {
                Task {
                    loggingOut = true
                    await authVM.signOut()
                }
            }
        } message: {
            Text("คุณต้องการออกจากระบบหรือไม่?")
        }
        .sheet(isPresented: $showEditName) {
            NavigationStack {
                Form {
                    Section("ชื่อ-นามสกุล") {
                        TextField("ชื่อ-นามสกุล", text: $editedName)
                    }
                    Section("วันเกิด") {
                        Toggle("ระบุวันเกิด", isOn: $hasDOB)
                        if hasDOB {
                            DatePicker("วันเกิด", selection: $editedDOB, displayedComponents: .date)
                                .datePickerStyle(.compact)
                        }
                    }
                }
                .navigationTitle("แก้ไขโปรไฟล์")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("ยกเลิก") { showEditName = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            savingName = true
                            Task {
                                let nameOK = await authVM.updateProfile(fullName: editedName)
                                let f = DateFormatter()
                                f.dateFormat = "yyyy-MM-dd"
                                f.timeZone = TimeZone(identifier: "UTC")
                                let dobOK = await authVM.updateDateOfBirth(hasDOB ? f.string(from: editedDOB) : nil)
                                savingName = false
                                if nameOK && dobOK { showEditName = false }
                            }
                        } label: {
                            if savingName { ProgressView() } else { Text("บันทึก").bold() }
                        }
                        .disabled(savingName || editedName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .presentationDetents([.height(340)])
        }
    }

    /// A stored toggle, or the declared default when the key was never written.
    private func storedFlag(_ key: String, default fallback: Bool) -> Bool {
        UserDefaults.standard.object(forKey: key) == nil
            ? fallback
            : UserDefaults.standard.bool(forKey: key)
    }

    // MARK: – Stats grid (DB data)
    private var statsGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3),
                  spacing: 10) {
            statCard(value: profileVM.isLoading ? "—" : "\(profileVM.docCount)",
                     label: "เอกสาร",
                     icon: "doc.text.fill", color: Color(hex: "#6366f1"))
            statCard(value: profileVM.isLoading ? "—" : "\(profileVM.splitCount)",
                     label: "หารบิล",
                     icon: "person.2.fill", color: Color(hex: "#3b82f6"))
            statCard(value: profileVM.isLoading ? "—" : "\(profileVM.tripCount)",
                     label: "ทริป",
                     icon: "airplane", color: Color(hex: "#f59e0b"))
        }
    }

    private func statCard(value: String, label: String, icon: String, color: Color) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(color)
                .frame(width: 40, height: 40)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(value)
                .font(.system(size: 20, weight: .heavy))
                .foregroundColor(Color.textPrimary)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    // MARK: – Hero card (gradient cover + avatar, matches web profile header)
    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                // Cover banner — custom photo or gradient fallback
                coverBanner
                    .frame(height: 110)
                    .clipped()

                // Buttons row: change background + edit profile
                HStack(spacing: 8) {
                    PhotosPicker(selection: $bgItem, matching: .images) {
                        Image(systemName: "photo.badge.plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(9)
                            .background(Color.black.opacity(0.30))
                            .clipShape(Circle())
                            .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    }
                    .onChange(of: bgItem) { _, newItem in
                        Task {
                            if let data = try? await newItem?.loadTransferable(type: Data.self) {
                                customBgData = data
                                UserDefaults.standard.set(data, forKey: "slippy_profile_bg")
                            }
                        }
                    }

                    Button {
                        editedName = authVM.profile?.fullName ?? authVM.profile?.displayName ?? ""
                        hasDOB = false
                        if let dobString = authVM.profile?.dateOfBirth {
                            let f = DateFormatter()
                            f.dateFormat = "yyyy-MM-dd"
                            f.timeZone = TimeZone(identifier: "UTC")
                            if let parsed = f.date(from: dobString) {
                                editedDOB = parsed
                                hasDOB = true
                            }
                        }
                        showEditName = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12, weight: .semibold))
                            Text("แก้ไขโปรไฟล์")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Color.black.opacity(0.28))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    }
                }
                .padding(12)
            }

            // Avatar overlapping the banner — tappable to change photo
            ZStack(alignment: .bottomTrailing) {
                PhotosPicker(selection: $avatarItem, matching: .images) {
                    avatarView
                        .overlay(Circle().stroke(Color.surface, lineWidth: 4))
                }
                .onChange(of: avatarItem) { _, newItem in
                    Task {
                        guard let data = try? await newItem?.loadTransferable(type: Data.self),
                              let compressed = compressImage(data) else { return }
                        uploadingAvatar = true
                        _ = await authVM.uploadAvatar(compressed)
                        uploadingAvatar = false
                    }
                }

                // Green online dot + camera hint
                ZStack {
                    Circle().fill(Color(hex: "#10b981"))
                    if uploadingAvatar {
                        ProgressView().tint(.white).scaleEffect(0.55)
                    } else {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 22, height: 22)
                .overlay(Circle().stroke(Color.surface, lineWidth: 3))
            }
            .padding(.top, -42)
            .padding(.leading, 20)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(authVM.profile?.displayName ?? "—")
                        .font(.system(size: 20, weight: .heavy))
                        .foregroundColor(Color.textPrimary)
                    Text(roleLabels[role] ?? role.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .tracking(0.5)
                        .foregroundColor(roleColors[role] ?? .brand500)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background((roleColors[role] ?? .brand500).opacity(0.16))
                        .clipShape(Capsule())
                }

                Text(authVM.session?.user.email ?? authVM.profile?.email ?? "—")
                    .font(.system(size: 14))
                    .foregroundColor(Color.textSecondary)

                HStack(spacing: 16) {
                    if let org = authVM.org {
                        HStack(spacing: 6) {
                            Image(systemName: "building.2")
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                            Text(org.name)
                                .font(.system(size: 12.5))
                                .foregroundColor(Color.textSecondary)
                            Text(org.plan.uppercased())
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(Color.brand500)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Color.brand500.opacity(0.14))
                                .clipShape(Capsule())
                        }
                    }
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                        Text("เข้าร่วม \(joinedDateString)")
                            .font(.system(size: 12.5))
                            .foregroundColor(Color.textSecondary)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 20)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.border, lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    // MARK: – Cover banner (custom photo or gradient)
    @ViewBuilder
    private var coverBanner: some View {
        if let data = customBgData, let uiImg = UIImage(data: data) {
            Image(uiImage: uiImg)
                .resizable()
                .scaledToFill()
                .overlay(Color.black.opacity(0.25))
        } else {
            LinearGradient(
                colors: [Color(hex: "#4338ca"), Color(hex: "#7c3aed"), Color(hex: "#c026d3")],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .overlay(DotPattern().opacity(0.18))
        }
    }

    // MARK: – Avatar (URL image or initials fallback)
    @ViewBuilder
    private var avatarView: some View {
        if let urlStr = authVM.profile?.avatarUrl, let url = URL(string: urlStr) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    img.resizable().scaledToFill()
                        .frame(width: 84, height: 84)
                        .clipShape(Circle())
                default:
                    InitialsAvatar(text: authVM.profile?.initials ?? "?",
                                   size: 84, color: roleColors[role] ?? .brand500)
                }
            }
        } else {
            InitialsAvatar(text: authVM.profile?.initials ?? "?",
                           size: 84, color: roleColors[role] ?? .brand500)
        }
    }

    // MARK: – Compress selected image to JPEG ~500KB
    private func compressImage(_ data: Data) -> Data? {
        guard let uiImg = UIImage(data: data) else { return nil }
        // Resize to max 800px
        let maxDim: CGFloat = 800
        let scale = min(maxDim / uiImg.size.width, maxDim / uiImg.size.height, 1)
        let newSize = CGSize(width: uiImg.size.width * scale, height: uiImg.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized  = renderer.image { _ in uiImg.draw(in: CGRect(origin: .zero, size: newSize)) }
        return resized.jpegData(compressionQuality: 0.75)
    }

    private var joinedDateString: String {
        guard let date = authVM.session?.user.createdAt else { return "—" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "th_TH")
        fmt.dateFormat = "MMMM yyyy"
        return fmt.string(from: date)
    }

    private func formatJoinedDate(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? {
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: iso)
        }()
        guard let date else { return "—" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "th_TH")
        fmt.dateFormat = "MMMM yyyy"
        return fmt.string(from: date)
    }

    // MARK: – Tab bar (segmented pill — matches web tabs)
    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(ProfileTab.allCases) { t in
                let selected = tab == t
                Button { withAnimation(.easeInOut(duration: 0.18)) { tab = t } } label: {
                    Text(t.rawValue)
                        .font(.system(size: 13, weight: selected ? .bold : .medium))
                        .foregroundColor(selected ? Color.textOnBrand : Color.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(selected ? Color.surfaceMuted : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(4)
        .background(Color.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    // MARK: – Tab: ข้อมูลส่วนตัว
    private var infoTabContent: some View {
        VStack(alignment: .leading, spacing: 22) {

            // ── Stats from DB ────────────────────────────────────────────────
            statsGrid

            groupHeader("บัญชี")
            VStack(spacing: 10) {
                Button {
                    hapticLight()
                    editedName = authVM.profile?.fullName ?? authVM.profile?.displayName ?? ""
                    hasDOB = false
                    if let dobString = authVM.profile?.dateOfBirth {
                        let f = DateFormatter()
                        f.dateFormat = "yyyy-MM-dd"
                        f.timeZone = TimeZone(identifier: "UTC")
                        if let parsed = f.date(from: dobString) {
                            editedDOB = parsed
                            hasDOB = true
                        }
                    }
                    showEditName = true
                } label: {
                    HStack {
                        iconInfoRow(icon: "person", label: "ชื่อ-นามสกุล",
                                    value: authVM.profile?.displayName ?? "—")
                        Image(systemName: "pencil")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Color.textSecondary)
                    }
                }
                .buttonStyle(.plain)
                iconInfoRow(icon: "envelope", label: "อีเมล",
                            value: authVM.session?.user.email ?? "—", emphasised: true)
            }

            groupHeader("องค์กรและบทบาท")
            Button {
                if authVM.memberships.count > 1 {
                    hapticLight()
                    showOrgSwitcher = true
                }
            } label: {
                HStack(spacing: 14) {
                    iconBadge("building.2", tint: Color.brand500)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("องค์กรปัจจุบัน")
                            .font(.system(size: 12.5)).foregroundColor(Color.textSecondary)
                        Text(authVM.org?.name ?? "—")
                            .font(.system(size: 16, weight: .bold)).foregroundColor(Color.textPrimary)
                    }
                    Spacer()
                    Text(roleLabels[role] ?? role.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(roleColors[role] ?? .brand500)
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background((roleColors[role] ?? .brand500).opacity(0.16))
                        .clipShape(Capsule())
                    if authVM.memberships.count > 1 {
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color.textSecondary)
                    }
                }
                .padding(16)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .confirmationDialog("สลับองค์กร", isPresented: $showOrgSwitcher, titleVisibility: .visible) {
                ForEach(authVM.memberships, id: \.organizations.id) { m in
                    Button(m.organizations.name) {
                        authVM.switchOrg(to: m.organizations.id)
                    }
                }
                Button("ยกเลิก", role: .cancel) {}
            }

            groupHeader("บัญชีที่เชื่อมต่อ")
            VStack(spacing: 10) {
                if let line = profileVM.lineConnection {
                    connectedAccountRow(
                        icon: "bubble.left.fill", iconBg: Color(hex: "#06C755"),
                        title: "LINE",
                        subtitle: "\(line.displayName ?? "—") · เชื่อมเมื่อ \(formatJoinedDate(line.createdAt))",
                        actionTitle: "ยกเลิก", actionColor: Color(hex: "#ef4444"), enabled: true
                    ) {}
                } else {
                    connectedAccountRow(
                        icon: "bubble.left.fill", iconBg: Color(hex: "#9ca3af"),
                        title: "LINE",
                        subtitle: "ยังไม่ได้เชื่อมต่อ",
                        actionTitle: "เชื่อมต่อ", actionColor: Color(hex: "#06C755"), enabled: true
                    ) {}
                }
                connectedAccountRow(
                    icon: "iphone", iconBg: Color(hex: "#1f2937"),
                    title: "Mobile App",
                    subtitle: "เร็วๆ นี้",
                    actionTitle: "เร็วๆ นี้", actionColor: Color.textSecondary, enabled: false
                ) {}
            }

            groupHeader("กิจกรรมล่าสุด")
            VStack(spacing: 0) {
                if profileVM.isLoading {
                    HStack { Spacer(); ProgressView().tint(Color.brand500); Spacer() }
                        .padding(.vertical, 24)
                } else if profileVM.activityLogs.isEmpty {
                    Text("ยังไม่มีกิจกรรม")
                        .font(.system(size: 14))
                        .foregroundColor(Color.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                } else {
                    ForEach(Array(profileVM.activityLogs.enumerated()), id: \.element.id) { idx, log in
                        if idx > 0 { Divider().padding(.leading, 52) }
                        HStack(spacing: 12) {
                            Image(systemName: log.icon)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(Color.brand500)
                                .frame(width: 36, height: 36)
                                .background(Color.brand500.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(log.label)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(Color.textPrimary)
                                    .lineLimit(1)
                                if let detail = log.detail {
                                    Text(detail)
                                        .font(.system(size: 11))
                                        .foregroundColor(Color.textSecondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            Text(relTime(log.createdAt))
                                .font(.system(size: 11))
                                .foregroundColor(Color.textSecondary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
    }

    // MARK: – Tab: การแจ้งเตือน
    private var notificationsTabContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            groupHeader("ช่องทางการแจ้งเตือน")
            VStack(spacing: 0) {
                toggleRow("แจ้งเตือนผ่าน LINE", sub: "Push ผ่าน Slippy Bot", value: $lineNotif)
                    .onChange(of: lineNotif) { _, v in
                        UserDefaults.standard.set(v, forKey: "slippy_line_notif")
                    }
                rowDivider
                toggleRow("แจ้งเตือนเอกสารใหม่", sub: "เมื่อ AI ประมวลผลเอกสารเสร็จ", value: $docNotif)
                    .onChange(of: docNotif) { _, v in
                        UserDefaults.standard.set(v, forKey: "slippy_doc_notif")
                    }
                rowDivider
                toggleRow("รายงานรายสัปดาห์", sub: "สรุปทุกวันจันทร์", value: $weeklyRpt)
                    .onChange(of: weeklyRpt) { _, v in
                        UserDefaults.standard.set(v, forKey: "slippy_weekly_rpt")
                    }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
    }

    // MARK: – Tab: ความปลอดภัย
    private var securityTabContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            groupHeader("การยืนยันตัวตน")
            VStack(spacing: 0) {
                toggleRow("Biometric Login", sub: "Face ID / Touch ID", value: $biometric)
                    .onChange(of: biometric) { _, v in
                        UserDefaults.standard.set(v, forKey: "slippy_biometric")
                        if v { Task { await checkBiometric() } }
                    }
                rowDivider
                NavigationLink {
                    TwoFactorSettingsView()
                } label: {
                    actionRowLabel("2-Factor Authentication", icon: "shield.checkered")
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))

            groupHeader("เครื่องมือทางบัญชี")
            VStack(spacing: 0) {
                NavigationLink {
                    VendorsView().environmentObject(authVM)
                } label: {
                    actionRowLabel("ผู้ขาย / Vendors", icon: "building.2.fill")
                }
                rowDivider
                NavigationLink {
                    DocumentCategoriesView().environmentObject(authVM)
                } label: {
                    actionRowLabel("จัดการหมวดหมู่บิล", icon: "folder.fill")
                }
                rowDivider
                NavigationLink {
                    TaxView().environmentObject(authVM)
                } label: {
                    actionRowLabel("ภาษี VAT / หัก ณ ที่จ่าย", icon: "percent")
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))

            groupHeader("การดำเนินการ")
            VStack(spacing: 0) {
                actionRow("เปลี่ยนรหัสผ่าน", icon: "key.fill") {
                    // `try?` used to swallow the result entirely: the tap looked
                    // identical whether the email went out, the address was
                    // missing, or the request failed. A person waiting for a
                    // reset link has no way to tell which happened.
                    Task {
                        guard let email = authVM.session?.user.email, !email.isEmpty else {
                            resetPasswordMessage = "ไม่พบอีเมลของบัญชีนี้ — ติดต่อฝ่ายสนับสนุน"
                            return
                        }
                        do {
                            try await SupabaseManager.shared.client.auth.resetPasswordForEmail(email)
                            resetPasswordMessage = "ส่งลิงก์เปลี่ยนรหัสผ่านไปที่ \(email) แล้ว"
                        } catch {
                            resetPasswordMessage = "ส่งไม่สำเร็จ: \(error.localizedDescription)"
                        }
                    }
                }
                rowDivider
                NavigationLink {
                    BillingView().environmentObject(authVM)
                } label: {
                    actionRowLabel("จัดการแผน / Billing", icon: "chart.bar.fill")
                }
                rowDivider
                actionRow("ติดต่อฝ่ายสนับสนุน", icon: "bubble.left.and.bubble.right.fill") {
                    UIApplication.shared.open(URL(string: "mailto:hello@slippy.app")!)
                }
                rowDivider
                actionRow("นโยบายความเป็นส่วนตัว", icon: "lock.shield.fill") {
                    UIApplication.shared.open(URL(string: "https://slippy.app/privacy-policy")!)
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))

            groupHeader("เกี่ยวกับแอป")
            VStack(spacing: 0) {
                infoRow("เวอร์ชัน", Config.appVersion)
                rowDivider
                infoRow("Build", "iOS Native")
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
    }

    // MARK: – Logout
    private var logoutButton: some View {
        Button { showLogoutAlert = true } label: {
            HStack {
                if loggingOut {
                    ProgressView().tint(Color(hex: "#ef4444"))
                } else {
                    Image(systemName: "arrow.left.circle")
                    Text("ออกจากระบบ").font(.system(size: 15, weight: .bold))
                }
            }
            .foregroundColor(Color(hex: "#ef4444"))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color(hex: "#ef4444").opacity(0.10))
            .cornerRadius(16)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#ef4444").opacity(0.35)))
        }
        .padding(.horizontal, 16)
        .padding(.top, 28)
    }

    // MARK: – Shared row builders
    private var rowDivider: some View {
        Divider().padding(.leading, 56).overlay(Color.border)
    }

    @ViewBuilder
    private func groupHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color.textSecondary)
    }

    @ViewBuilder
    private func iconBadge(_ symbol: String, tint: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(tint)
            .frame(width: 42, height: 42)
            .background(tint.opacity(0.14))
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func iconInfoRow(_ symbol: String? = nil, icon: String, label: String, value: String, emphasised: Bool = false) -> some View {
        HStack(spacing: 14) {
            iconBadge(icon, tint: Color.textSecondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.system(size: 12.5)).foregroundColor(Color.textSecondary)
                Text(value)
                    .font(.system(size: emphasised ? 16 : 15, weight: emphasised ? .bold : .semibold))
                    .foregroundColor(Color.textPrimary)
            }
            Spacer()
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    @ViewBuilder
    private func connectedAccountRow(icon: String, iconBg: Color, title: String, subtitle: String,
                                       actionTitle: String, actionColor: Color, enabled: Bool,
                                       action: @escaping () -> Void) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 42, height: 42)
                .background(iconBg)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(Color.textPrimary)
                Text(subtitle).font(.system(size: 12.5)).foregroundColor(Color.textSecondary)
            }
            Spacer()
            Button(action: { hapticLight(); action() }) {
                Text(actionTitle)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(actionColor)
                    .padding(.horizontal, 13).padding(.vertical, 7)
                    .background(actionColor.opacity(enabled ? 0.12 : 0.08))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(actionColor.opacity(enabled ? 0.4 : 0.2), lineWidth: 1))
            }
            .disabled(!enabled)
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    @ViewBuilder
    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundColor(Color.textSecondary)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }

    @ViewBuilder
    private func toggleRow(_ label: String, sub: String, value: Binding<Bool>) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                Text(sub).font(.system(size: 11)).foregroundColor(Color.textSecondary)
            }
            Spacer()
            Toggle("", isOn: value).tint(Color.brand500).labelsHidden()
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }

    @ViewBuilder
    /// Visual content shared by `actionRow` (button) and `NavigationLink` rows —
    /// same look, but usable as a plain label for navigation destinations.
    private func actionRowLabel(_ label: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Color.brand500)
                .frame(width: 32, height: 32)
                .background(Color.brand500.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 9))
            Text(label).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
            Spacer()
            Image(systemName: "chevron.right").foregroundColor(Color.textSecondary).font(.system(size: 13))
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private func actionRow(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: { hapticLight(); action() }) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.brand500)
                    .frame(width: 32, height: 32)
                    .background(Color.brand500.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                Text(label).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(Color.textSecondary).font(.system(size: 13))
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
        }
    }

    #if DEBUG
    static func preview() -> some View {
        let vm = AuthViewModel(_preview: true)
        vm.setPreviewData(
            profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
            org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45),
            role: "owner"
        )
        return ProfileView().environmentObject(vm)
    }
    #endif

    private func checkBiometric() async {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            biometric = false
            return
        }
        do {
            let ok = try await ctx.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "ยืนยันตัวตนเพื่อเปิด Biometric Login"
            )
            biometric = ok
            if ok { hapticSuccess() }
        } catch {
            biometric = false
        }
    }
}

/// Subtle dotted texture overlay used on the gradient cover banner —
/// recreates the web's faint dot-grid pattern.
private struct DotPattern: View {
    var body: some View {
        Canvas { ctx, size in
            let spacing: CGFloat = 16
            let radius: CGFloat = 1.1
            var y: CGFloat = spacing / 2
            while y < size.height {
                var x: CGFloat = spacing / 2
                while x < size.width {
                    let rect = CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)
                    ctx.fill(Path(ellipseIn: rect), with: .color(.white.opacity(0.5)))
                    x += spacing
                }
                y += spacing
            }
        }
    }
}

#if DEBUG
#Preview {
    ProfileView.preview()
}
#endif
