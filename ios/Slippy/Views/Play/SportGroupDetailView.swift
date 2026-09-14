import SwiftUI

/// Recurring group header + its generated sessions — native port of the
/// LIFF page's "group-detail" view.
struct SportGroupDetailView: View {
    let group: SportGroup
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = SportGroupsViewModel()
    @State private var showAddSession = false
    @State private var newSessionDate = Date()
    @State private var isAddingSession = false
    @State private var addSessionError: String?

    var body: some View {
        ZStack {
            Color.background.ignoresSafeArea()

            if vm.isLoading && vm.groupSessions.isEmpty {
                ProgressView().tint(Color.brand500)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        headerCard
                        addSessionButton

                        if vm.groupSessions.isEmpty {
                            Text("ยังไม่มีเซสชันที่จะถึง")
                                .font(.system(size: 13))
                                .foregroundColor(Color.textSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 24)
                        } else {
                            ForEach(vm.groupSessions) { session in
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
        .navigationTitle("\(sportEmoji(for: group.sportType)) \(group.title)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadGroupSessions(groupId: group.id) }
        .refreshable { await vm.loadGroupSessions(groupId: group.id) }
        .sheet(isPresented: $showAddSession) { addSessionSheet }
        .alert("ผิดพลาด", isPresented: Binding(
            get: { vm.error != nil }, set: { if !$0 { vm.error = nil } }
        )) {
            Button("ตกลง", role: .cancel) { vm.error = nil }
        } message: { Text(vm.error ?? "") }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(recurringDaysLabel(group.recurringDays), systemImage: "calendar")
                .font(.system(size: 14, weight: .bold))
            if group.defaultStartTime != nil || group.defaultCourtNo != nil {
                Label(timeRangeLabel(group.defaultStartTime, group.defaultEndTime) +
                      (group.defaultCourtNo != nil ? " · \(group.defaultCourtNo!)" : ""),
                      systemImage: "clock")
                    .font(.system(size: 12))
            }
            if let venue = group.defaultVenue {
                Label(venue, systemImage: "mappin.and.ellipse").font(.system(size: 12))
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

    private var addSessionButton: some View {
        Button {
            hapticLight(); showAddSession = true
        } label: {
            HStack {
                Image(systemName: "plus.circle.fill")
                Text("สร้างนัดใหม่ (เลือกวันที่)")
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(Color.brand500)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.brand500.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private var addSessionSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    DatePicker("เลือกวันที่", selection: $newSessionDate,
                               in: Date()..., displayedComponents: .date)
                        .datePickerStyle(.graphical)

                    if let addSessionError {
                        Text(addSessionError)
                            .font(.system(size: 12))
                            .foregroundColor(Color.statusFailed)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        guard !isAddingSession else { return }
                        Task { await createSession() }
                    } label: {
                        HStack {
                            if isAddingSession { ProgressView().tint(.white) }
                            else { Text("สร้างนัด") }
                        }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(isAddingSession ? Color.brand500.opacity(0.6) : Color.brand500)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(isAddingSession)
                }
                .padding(20)
            }
            .navigationTitle("สร้างนัดใหม่")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { showAddSession = false }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isAddingSession)
    }

    private func createSession() async {
        guard let userId = authVM.session?.user.id.uuidString else {
            addSessionError = "ไม่พบข้อมูลผู้ใช้ — กรุณาเข้าสู่ระบบใหม่"
            return
        }
        isAddingSession = true
        addSessionError = nil
        hapticLight()
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        let result = await vm.addSession(group: group, userId: userId, bookingDate: fmt.string(from: newSessionDate))
        isAddingSession = false
        if result != nil {
            hapticSuccess()
            showAddSession = false
        } else {
            addSessionError = vm.error ?? "สร้างนัดไม่สำเร็จ ลองอีกครั้ง"
            hapticLight()
        }
    }
}
