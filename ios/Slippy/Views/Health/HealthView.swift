import SwiftUI
import PhotosUI

private let healthCategory = ActivityCategoryStyle.medication

struct HealthView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = HealthViewModel()
    @State private var showAddMed = false
    @State private var actionTarget: Medication? = nil
    @State private var showLogSheet = false
    @State private var showEditMed = false
    /// Non-nil while the "ลบยานี้?" confirmation is up — set on swipe, only
    /// actually deleted once the alert's destructive button is tapped.
    @State private var deleteTarget: Medication? = nil
    @State private var selectedView = 0
    @State private var courseFilter = "active"
    @State private var pendingTransition: (course: MedicationCourse, action: String)?

    // MARK: – Scan-a-label flow: pick a photo → OCR (read-only) → the SAME
    // add-medication form, pre-filled — nothing is ever written until it goes
    // through the one review step every path into `medications` already goes
    // through. Mirrors web's scan flow in medications-client.tsx exactly.
    @State private var showScanSource = false
    @State private var showScanPhotoPicker = false
    @State private var showScanCamera = false
    @State private var scanPhotoItem: PhotosPickerItem?
    @State private var scanning = false
    @State private var scanError: String?
    @State private var scanIssues: [String] = []
    /// More than one label caught in one photo — pick which to review first.
    @State private var scanResults: [ScannedMedication]?
    @State private var scanReviewing: ScannedMedication?

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    // No NavigationStack here — always reached via a NavigationLink push
    // from Dashboard or the "เพิ่มเติม" hub, both of which already own one.
    // A second NavigationStack here swallows the outer back button.
    var body: some View {
            ScrollView {
                VStack(spacing: 18) {
                    summaryCard
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                    Picker("มุมมองยา", selection: $selectedView) {
                        Text("วันนี้").tag(0)
                        Text("ยาทั้งหมด").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)

                    if !vm.notificationsAuthorized && vm.medications.contains(where: { $0.primarySchedule?.reminderEnabled == true }) {
                        notificationBanner
                            .padding(.horizontal, 16)
                    }

                    if selectedView == 0 {
                        todayTimelineSection.padding(.horizontal, 16)
                    } else {
                        medicationsSection.padding(.horizontal, 16)
                    }
                }
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle(healthCategory.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        hapticLight()
                        showAddMed = true
                    } label: {
                        Image(systemName: "plus")
                            .fontWeight(.semibold)
                            .foregroundColor(healthCategory.color)
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        hapticLight()
                        showScanSource = true
                    } label: {
                        Image(systemName: "text.viewfinder")
                            .fontWeight(.semibold)
                            .foregroundColor(healthCategory.color)
                    }
                }
            }
            .task {
                guard !userId.isEmpty else { return }
                await vm.load(userId: userId)
            }
            .refreshable {
                guard !userId.isEmpty else { return }
                await vm.load(userId: userId)
            }
            .sheet(isPresented: $showAddMed) {
                AddMedicationView(vm: vm)
                    .environmentObject(authVM)
            }
            .confirmationDialog(
                actionTarget.map { "บันทึกการทานยา: \($0.name)" } ?? "",
                isPresented: $showLogSheet,
                titleVisibility: .visible
            ) {
                if let med = actionTarget {
                    Button("ทานแล้ว ✅") { logMed(med, status: "taken") }
                    Button("ลืมทาน ❌") { logMed(med, status: "missed") }
                    Button("ข้าม ⏭️") { logMed(med, status: "skipped") }
                    Button("แก้ไขข้อมูลยา ✏️") { showEditMed = true }
                    Button("ยกเลิก", role: .cancel) {}
                }
            }
            .sheet(isPresented: $showEditMed) {
                if let med = actionTarget {
                    AddMedicationView(vm: vm, editing: med)
                        .environmentObject(authVM)
                }
            }
            .alert(
                deleteTarget.map { "ลบ \($0.name)?" } ?? "",
                isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })
            ) {
                Button("ลบ", role: .destructive) {
                    guard let med = deleteTarget else { return }
                    Task { try? await vm.deleteMedication(id: med.id) }
                    deleteTarget = nil
                }
                Button("ยกเลิก", role: .cancel) { deleteTarget = nil }
            } message: {
                Text("จะซ่อนยานี้จากรายการ — ประวัติการทานยาที่ผ่านมายังเก็บไว้เหมือนเดิม")
            }
            .confirmationDialog(
                transitionTitle,
                isPresented: Binding(get: { pendingTransition != nil }, set: { if !$0 { pendingTransition = nil } }),
                titleVisibility: .visible
            ) {
                Button("ยืนยัน") {
                    guard let transition = pendingTransition else { return }
                    Task { try? await vm.transitionCourse(courseId: transition.course.id, action: transition.action) }
                    pendingTransition = nil
                }
                Button("ยกเลิก", role: .cancel) { pendingTransition = nil }
            } message: {
                Text("Slippy จะบันทึกสิ่งที่คุณยืนยันและไม่เปลี่ยนยาแทนแพทย์")
            }
            // MARK: – Scan-a-label
            .confirmationDialog("สแกนฉลากยา", isPresented: $showScanSource, titleVisibility: .visible) {
                Button("ถ่ายรูป") { showScanCamera = true }
                Button("เลือกจากคลังภาพ") { showScanPhotoPicker = true }
                Button("ยกเลิก", role: .cancel) {}
            }
            .photosPicker(isPresented: $showScanPhotoPicker, selection: $scanPhotoItem, matching: .images)
            .onChange(of: scanPhotoItem) { _, item in
                guard let item else { return }
                Task {
                    scanPhotoItem = nil
                    guard let data = try? await item.loadTransferable(type: Data.self) else {
                        scanError = "อ่านรูปไม่สำเร็จ"; return
                    }
                    await scanLabel(data: data)
                }
            }
            .fullScreenCover(isPresented: $showScanCamera) {
                // CameraImagePicker dismisses itself via @Environment(\.dismiss)
                // before calling onImage — see its own doc comment on why a
                // second manual dismiss here would tear down this sheet too.
                CameraImagePicker { img in
                    guard let data = img.jpegData(compressionQuality: 0.9) else { return }
                    Task { await scanLabel(data: data) }
                }
            }
            .overlay {
                if scanning {
                    ZStack {
                        Color.black.opacity(0.35).ignoresSafeArea()
                        VStack(spacing: 10) {
                            ProgressView().tint(.white)
                            Text("กำลังอ่านฉลากยา…")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(.white)
                        }
                        .padding(24)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
            .alert("ไม่สำเร็จ", isPresented: Binding(
                get: { scanError != nil }, set: { if !$0 { scanError = nil } }
            )) {
                Button("ตกลง") { scanError = nil }
            } message: { Text(scanError ?? "") }
            .confirmationDialog(
                scanResults.map { "พบยา \($0.count) รายการในภาพนี้" } ?? "",
                isPresented: Binding(get: { scanResults != nil }, set: { if !$0 { scanResults = nil } }),
                titleVisibility: .visible
            ) {
                ForEach(scanResults ?? [], id: \.name) { item in
                    Button(item.name + (item.strength.map { " \($0)" } ?? "")) {
                        scanReviewing = item
                        scanResults = nil
                    }
                }
                Button("ยกเลิก", role: .cancel) { scanResults = nil }
            }
            .sheet(isPresented: Binding(
                get: { scanReviewing != nil }, set: { if !$0 { scanReviewing = nil } }
            )) {
                AddMedicationView(vm: vm, scanned: scanReviewing, scanIssues: scanIssues)
                    .environmentObject(authVM)
            }
    }

    private var transitionTitle: String {
        switch pendingTransition?.action {
        case "pause": return "ยืนยันพักยาชั่วคราว?"
        case "resume": return "ยืนยันกลับมาใช้ยา?"
        case "stop": return "ยืนยันหยุดยาถาวร?"
        case "complete": return "ยืนยันจบคอร์สยา?"
        default: return "ยืนยันการเปลี่ยนสถานะ?"
        }
    }

    private func scanLabel(data: Data) async {
        scanning = true
        defer { scanning = false }
        do {
            let result = try await MedicationScanAPI.read(imageData: data, fileName: "label.jpg", mimeType: "image/jpeg")
            scanIssues = result.issues
            guard !result.items.isEmpty else {
                scanError = "อ่านฉลากยาไม่พบรายการที่ใช้ได้"
                return
            }
            // One label, the common case: skip straight to the review form.
            // More than one (a photo catching two packs) shows a pick list.
            if result.items.count == 1 {
                scanReviewing = result.items[0]
            } else {
                scanResults = result.items
            }
        } catch {
            scanError = error.localizedDescription
        }
    }

    // MARK: – Summary card
    private var summaryCard: some View {
        let total = vm.todayLogs.count
        let taken = vm.takenCountToday
        let progress = total > 0 ? Double(taken) / Double(total) : 0

        return ZStack {
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(
                    colors: [Color(hex: "#059669"), healthCategory.color],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .shadow(color: healthCategory.color.opacity(0.3), radius: 12, x: 0, y: 6)

            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("วันนี้")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.85))
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text("\(taken)")
                            .font(.system(size: 36, weight: .heavy))
                            .foregroundColor(.white)
                        Text("/ \(total) โดส")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    Text(taken == total && total > 0 ? "ทานยาครบแล้ว 🎉" : "ยาที่ทานแล้ว")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }
                Spacer()
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.25), lineWidth: 8)
                        .frame(width: 72, height: 72)
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(Color.white, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 72, height: 72)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 0.6), value: progress)
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            .padding(20)
        }
    }

    private var todayTimelineSection: some View {
        let groups = Dictionary(grouping: vm.todayLogs) { log in
            let formatter = ISO8601DateFormatter()
            guard let date = formatter.date(from: log.scheduledAt) else { return log.scheduledAt }
            let output = DateFormatter(); output.dateFormat = "HH:mm"
            return output.string(from: date)
        }
        return VStack(spacing: 12) {
            if groups.isEmpty {
                ContentUnavailableView("วันนี้ยังไม่มีรอบยา", systemImage: "pills", description: Text("ยาที่พักอยู่จะไม่ถูกนับเป็นขาดยา"))
            } else {
                ForEach(groups.keys.sorted(), id: \.self) { time in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(time).font(.system(size: 18, weight: .bold)).foregroundColor(.textPrimary)
                            Text(roundLabel(time)).font(.system(size: 11)).foregroundColor(.textSecondary)
                            Spacer()
                            let logs = groups[time] ?? []
                            let resolved = logs.filter { ["taken", "late", "skipped"].contains($0.status) }.count
                            Text(resolved == logs.count ? "ครบ \(resolved)/\(logs.count)" : "รอยืนยัน \(logs.count - resolved)")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(resolved == logs.count ? .green : .orange)
                        }
                        Divider()
                        ForEach(groups[time] ?? []) { log in
                            if let med = vm.medications.first(where: { $0.id == log.medicationId }) {
                                HStack(spacing: 10) {
                                    Image(systemName: "pills.fill").foregroundColor(healthCategory.color).frame(width: 28, height: 28).background(healthCategory.color.opacity(0.1)).cornerRadius(8)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(med.name + (med.strength.map { " \($0)" } ?? "")).font(.system(size: 13, weight: .semibold))
                                        Text("\(med.primarySchedule?.doseQty.clean ?? "1") เม็ด").font(.system(size: 11)).foregroundColor(.textSecondary)
                                        if let instruction = med.currentCourse?.doctorInstructions {
                                            Text("สแกนจากฉลาก · \(instruction)").lineLimit(1).font(.system(size: 10)).foregroundColor(healthCategory.color)
                                        }
                                    }
                                    Spacer()
                                    if ["taken", "late"].contains(log.status) {
                                        Label("ทานแล้ว", systemImage: "checkmark.circle.fill").font(.system(size: 11, weight: .medium)).foregroundColor(.green)
                                    } else if log.status == "skipped" {
                                        Text("ข้ามรอบ").font(.system(size: 11)).foregroundColor(.textSecondary)
                                    } else {
                                        Button("ทานแล้ว") { Task { try? await vm.updateDose(logId: log.id, status: "taken") } }
                                            .font(.system(size: 11, weight: .semibold)).buttonStyle(.borderedProminent).tint(healthCategory.color)
                                    }
                                }
                            }
                        }
                    }
                    .padding(14).background(Color.surface).cornerRadius(15)
                    .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.border, lineWidth: 1))
                }
            }
        }
    }

    private func roundLabel(_ time: String) -> String {
        guard let hour = Int(time.prefix(2)) else { return "รอบยา" }
        if hour < 11 { return "รอบเช้า" }; if hour < 16 { return "รอบกลางวัน" }
        if hour < 21 { return "รอบเย็น" }; return "ก่อนนอน"
    }

    // MARK: – Notification permission banner
    //
    // Shown only when a medication actually wants a reminder AND the OS
    // hasn't granted permission — a schedule with `reminder_enabled` but no
    // authorization is a reminder that silently never fires, which reads as
    // "the app is broken" rather than "tap here to turn it on."
    private var notificationBanner: some View {
        Button {
            hapticLight()
            Task { await vm.requestNotificationPermission() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "bell.badge")
                    .font(.system(size: 18))
                    .foregroundColor(.white)
                VStack(alignment: .leading, spacing: 2) {
                    Text("เปิดแจ้งเตือนบนมือถือ")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    Text("เพื่อให้ Slippy เตือนเวลาทานยาบนเครื่องนี้")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.85))
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.7))
            }
            .padding(14)
            .background(Color(hex: "#f59e0b"))
            .cornerRadius(14)
        }
    }

    // MARK: – Medications section
    private var medicationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("จัดการคอร์สยา")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.textPrimary)

            Picker("สถานะคอร์ส", selection: $courseFilter) {
                Text("กำลังใช้").tag("active")
                Text("พักยา").tag("paused")
                Text("ประวัติ").tag("history")
            }.pickerStyle(.segmented)

            if vm.isLoading {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .padding(.vertical, 20)
            } else if vm.medications.isEmpty {
                emptyState
            } else {
                ForEach(filteredMedications) { med in
                    MedicationCourseManagementCard(med: med) { course, action in
                        pendingTransition = (course, action)
                    }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                hapticLight()
                                deleteTarget = med
                            } label: {
                                Label("ลบ", systemImage: "trash")
                            }
                        }
                }
            }
        }
    }

    private var filteredMedications: [Medication] {
        vm.medications.filter { med in
            guard let status = med.currentCourse?.status else { return courseFilter == "active" }
            if courseFilter == "history" { return status == .stopped || status == .completed }
            return status.rawValue == courseFilter
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("💊")
                .font(.system(size: 44))
            Text("ยังไม่มียาที่บันทึก")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.textSecondary)
            Button {
                hapticLight()
                showAddMed = true
            } label: {
                Text("เพิ่มยา")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(healthCategory.color)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(healthCategory.color.opacity(0.12))
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .background(Color.surface)
        .cornerRadius(14)
    }

    // MARK: – Health tips
    private var healthTipsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("เคล็ดลับสุขภาพ")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.textPrimary)

            VStack(spacing: 10) {
                ForEach(healthTips, id: \.icon) { tip in
                    HStack(spacing: 12) {
                        Text(tip.icon)
                            .font(.system(size: 22))
                            .frame(width: 40, height: 40)
                            .background(Color(hex: "#f0fdf4"))
                            .cornerRadius(10)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tip.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.textPrimary)
                            Text(tip.detail)
                                .font(.system(size: 11))
                                .foregroundColor(.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(Color.surface)
                    .cornerRadius(12)
                    .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 2)
                }
            }
        }
    }

    private func logMed(_ med: Medication, status: String) {
        Task {
            try? await vm.logMedication(userId: userId, medicationId: med.id, status: status)
            hapticSuccess()
        }
    }
}

private struct MedicationCourseManagementCard: View {
    let med: Medication
    let transition: (MedicationCourse, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "cross.case.fill").foregroundColor(healthCategory.color).frame(width: 38, height: 38).background(healthCategory.color.opacity(0.1)).cornerRadius(10)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(med.name + (med.strength.map { " \($0)" } ?? "")).font(.system(size: 14, weight: .semibold))
                        if let course = med.currentCourse {
                            Text(statusLabel(course)).font(.system(size: 9, weight: .semibold)).padding(.horizontal, 7).padding(.vertical, 3).background(statusColor(course).opacity(0.12)).foregroundColor(statusColor(course)).clipShape(Capsule())
                        }
                    }
                    if let course = med.currentCourse {
                        Text("เริ่ม \(course.startDate)" + (course.plannedEndDate.map { " · ถึง \($0)" } ?? "")).font(.system(size: 10)).foregroundColor(.textSecondary)
                        if let instruction = course.doctorInstructions {
                            Text("สแกนจากฉลาก · \(instruction)").font(.system(size: 10)).foregroundColor(healthCategory.color).lineLimit(2)
                        }
                    }
                    if let inventory = med.inventory { Text("เหลือ \(inventory.qtyRemaining.clean) \(inventory.qtyUnit)").font(.system(size: 10)).foregroundColor(.textSecondary) }
                }
                Spacer()
            }
            if let course = med.currentCourse, course.status == .active {
                HStack { Spacer(); Button("พักยา") { transition(course, "pause") }.buttonStyle(.bordered).font(.system(size: 11)); Button("จบคอร์ส") { transition(course, "complete") }.buttonStyle(.bordered).font(.system(size: 11)); Button("หยุดยา") { transition(course, "stop") }.buttonStyle(.bordered).tint(.red).font(.system(size: 11)) }
            } else if let course = med.currentCourse, course.status == .paused {
                HStack { Spacer(); Button("กลับมาใช้") { transition(course, "resume") }.buttonStyle(.borderedProminent).tint(healthCategory.color).font(.system(size: 11)); Button("หยุดถาวร") { transition(course, "stop") }.buttonStyle(.bordered).tint(.red).font(.system(size: 11)) }
            }
        }.padding(14).background(Color.surface).cornerRadius(15).overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.border, lineWidth: 1))
    }

    private func statusLabel(_ course: MedicationCourse) -> String {
        if course.status == .active, let end = course.plannedEndDate, end <= Self.today { return "ครบกำหนด — รอยืนยัน" }
        return [.active: "กำลังใช้", .paused: "พักยา", .stopped: "หยุดแล้ว", .completed: "จบคอร์ส"][course.status] ?? ""
    }
    private func statusColor(_ course: MedicationCourse) -> Color { course.status == .active ? .green : course.status == .paused ? .orange : .gray }
    private static var today: String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }
}

// MARK: – Medication card
private struct MedicationCard: View {
    let med: Medication
    let status: String

    private var statusColor: Color {
        switch status {
        case "taken":   return .green
        case "missed":  return .red
        case "skipped": return .orange
        default:        return .gray
        }
    }

    private var statusLabel: String {
        switch status {
        case "taken":   return "ทานแล้ว"
        case "missed":  return "ลืมทาน"
        case "skipped": return "ข้าม"
        default:        return "รอทาน"
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(statusColor.opacity(0.15))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(med.dosageForm == "liquid" || med.dosageForm == "cream" ? "🧴" : med.dosageForm == "inhaler" ? "💨" : med.dosageForm == "injection" ? "💉" : med.dosageForm == "patch" ? "🩹" : "💊")
                        .font(.system(size: 22))
                )

            VStack(alignment: .leading, spacing: 3) {
                Text(med.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.textPrimary)
                HStack(spacing: 6) {
                    Text(med.dosageFormLabel)
                        .font(.system(size: 11))
                        .foregroundColor(.textSecondary)
                    if let brand = med.brandName, !brand.isEmpty {
                        Text("·")
                            .foregroundColor(.border)
                        Text(brand)
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
                    if let sched = med.primarySchedule, !sched.times.isEmpty {
                        Text(sched.isBedtime ? "· 🌙 ก่อนนอน" : "· ⏰ \(sched.times.joined(separator: ", "))")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
                }
                if let inv = med.inventory {
                    let daysLeft = inv.daysRemaining(schedule: med.primarySchedule)
                    let lowStock = inv.qtyRemaining <= inv.lowStockAlert
                    HStack(spacing: 4) {
                        if lowStock {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 9))
                        }
                        Text(daysLeft.map { "เหลือ \(inv.qtyRemaining.clean) \(inv.qtyUnit) · อีก \($0) วัน" }
                            ?? "เหลือ \(inv.qtyRemaining.clean) \(inv.qtyUnit)")
                            .font(.system(size: 10, weight: lowStock ? .semibold : .regular))
                    }
                    .foregroundColor(lowStock ? .red : .textSecondary)
                }
                if let notes = med.notes, !notes.isEmpty {
                    Label(notes, systemImage: "doc.text")
                        .font(.system(size: 10.5))
                        .foregroundColor(.textSecondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Text(statusLabel)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(statusColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(statusColor.opacity(0.12))
                .clipShape(Capsule())
        }
        .padding(14)
        .background(Color.surface)
        .cornerRadius(14)
        .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 2)
    }
}

// MARK: – Health tips data
private struct HealthTip {
    let icon: String
    let title: String
    let detail: String
}

private let healthTips: [HealthTip] = [
    HealthTip(icon: "💧", title: "ดื่มน้ำ 8 แก้วต่อวัน", detail: "ช่วยระบบการทำงานของร่างกายให้สมบูรณ์"),
    HealthTip(icon: "😴", title: "นอนหลับ 7-8 ชั่วโมง", detail: "ร่างกายซ่อมแซมตัวเองได้ดีที่สุดในช่วงหลับ"),
    HealthTip(icon: "🏃", title: "ออกกำลังกาย 30 นาที/วัน", detail: "ลดความเสี่ยงโรคหัวใจและเบาหวาน"),
    HealthTip(icon: "🥗", title: "ทานผักผลไม้ให้ครบ 5 หมู่", detail: "วิตามินและแร่ธาตุจากธรรมชาติดีที่สุด"),
]
