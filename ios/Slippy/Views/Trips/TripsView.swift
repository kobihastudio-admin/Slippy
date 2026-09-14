import SwiftUI

struct TripsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = TripsViewModel()
    @State private var showCreate = false
    @State private var space: JourneySpace = .personal

    private enum JourneySpace: String, CaseIterable, Identifiable {
        case personal
        case groups

        var id: String { rawValue }
        var title: String { self == .personal ? "ชีวิตของฉัน" : "ทริปกลุ่ม" }
        var subtitle: String {
            self == .personal
                ? "บันทึกและวางแผนแบบเป็นส่วนตัว"
                : "แผนร่วมกัน · ค่าใช้จ่าย · แชต · ตำแหน่ง"
        }
        var icon: String { self == .personal ? "sparkles" : "person.3.fill" }
    }

    /// These are presentation spaces, not parallel data models. A shared trip
    /// remains the same `life_journeys` record (and the same participants,
    /// itinerary, expenses and conversation) wherever it is opened.
    private var displayedTrips: [Trip] {
        switch space {
        case .personal:
            let currentUserId = authVM.session?.user.id.uuidString.lowercased()
            return vm.trips.filter { $0.creatorId?.lowercased() == currentUserId }
        case .groups:
            return vm.trips.filter { ($0.participants?.count ?? 0) > 1 }
        }
    }

    // No NavigationStack here — this view is only ever reached by being
    // pushed onto a NavigationLink from Dashboard or the "เพิ่มเติม" hub,
    // both of which already own a NavigationStack. Wrapping another one
    // here used to swallow the outer back button (a real, nested-stack bug,
    // not cosmetic — see MoreMenuView's own note on why it switches tabs
    // instead of pushing for the same reason).
    var body: some View {
            ZStack {
                Color.background.ignoresSafeArea()

                if vm.isLoading && vm.trips.isEmpty {
                    ProgressView()
                        .tint(Color.brand500)
                } else if vm.trips.isEmpty {
                    emptyState
                } else {
                    tripsList
                }
            }
            .navigationTitle("ทริป")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink {
                        ActivitiesView()
                    } label: {
                        Image(systemName: "calendar.badge.checkmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Color.brand500)
                    }
                    .accessibilityLabel("เปิดกิจกรรม")

                    NavigationLink {
                        JourneyPrototypeView()
                    } label: {
                        Image(systemName: "map.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Color(hex: "#08783F"))
                    }
                    .accessibilityLabel("เปิด Journey Prototype")

                    Button {
                        hapticLight()
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Color.brand500)
                    }
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateTripView { [weak vm] in
                    if let orgId = authVM.org?.id {
                        Task { await vm?.load(orgId: orgId) }
                    }
                }
                .environmentObject(authVM)
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

    // MARK: – List

    private var tripsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                journeySpacePicker

                if displayedTrips.isEmpty {
                    spaceEmptyState
                }

                ForEach(displayedTrips) { trip in
                    NavigationLink(destination: JourneyWorkspaceView(trip: trip)
                        .environmentObject(authVM)) {
                        TripCard(trip: trip)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private var journeySpacePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: space.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(Color(hex: "#08783F"))
                    .frame(width: 42, height: 42)
                    .background(Color(hex: "#ECFDF5"))
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 3) {
                    Text(space.title).font(.system(size: 19, weight: .bold)).foregroundColor(.textPrimary)
                    Text(space.subtitle).font(.system(size: 12)).foregroundColor(.textSecondary)
                }
                Spacer()
            }

            Picker("มุมมอง Journey", selection: $space) {
                ForEach(JourneySpace.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("เลือกมุมมอง Journey")
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [Color(hex: "#F0FDF4"), Color.surface],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var spaceEmptyState: some View {
        VStack(spacing: 9) {
            Image(systemName: space == .personal ? "heart.text.square" : "person.3.sequence.fill")
                .font(.system(size: 26)).foregroundColor(Color(hex: "#08783F"))
            Text(space == .personal ? "ยังไม่มี Journey ส่วนตัว" : "ยังไม่มีทริปกลุ่ม")
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.textPrimary)
            Text(space == .personal
                 ? "สร้างแผนหรือบันทึกการเดินทางของคุณได้เลย"
                 : "เชิญเพื่อนเข้าทริป แล้วทุกคนจะเห็นแผนและค่าใช้จ่ายชุดเดียวกัน")
                .font(.system(size: 12)).foregroundColor(.textSecondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 32).padding(.horizontal, 24)
        .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    // MARK: – Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Text("✈️")
                .font(.system(size: 56))
            Text("ยังไม่มีทริป")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(Color.textPrimary)
            Text("สร้างทริปแรกของคุณได้เลย")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
            Button {
                hapticLight()
                showCreate = true
            } label: {
                Label("สร้างทริป", systemImage: "plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.brand500)
                    .clipShape(Capsule())
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: – TripCard

struct TripCard: View {
    let trip: Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(alignment: .top, spacing: 12) {
                Text(trip.tripTypeEmoji)
                    .font(.system(size: 32))
                    .frame(width: 52, height: 52)
                    .background(Color.brand500.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .lineLimit(1)

                    Text(trip.tripTypeLabel)
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }

                Spacer()

                statusBadge(trip.status)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)

            // Details row
            if trip.eventDate != nil || trip.venue != nil {
                HStack(spacing: 16) {
                    if let date = trip.eventDate {
                        Label(formatEventDate(date), systemImage: "calendar")
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                    }
                    if let venue = trip.venue, !venue.isEmpty {
                        Label(venue, systemImage: "mappin")
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
            }

            Divider()
                .padding(.horizontal, 16)
                .padding(.top, 12)

            // Footer row
            HStack {
                Label("\(trip.participants?.count ?? 0) คน", systemImage: "person.2.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.textSecondary)

                Spacer()

                Text(fmtTHB(trip.computedTotal))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color.textPrimary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let (label, color) = statusInfo(status)
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func statusInfo(_ status: String) -> (String, Color) {
        switch status {
        case "settled":   return ("เสร็จสิ้น", .purple)
        case "cancelled": return ("ยกเลิก", .red)
        default:          return ("กำลังดำเนินการ", .green)
        }
    }

    private func formatEventDate(_ dateStr: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: dateStr) else { return dateStr }
        fmt.dateFormat = "d MMM yyyy"
        fmt.locale = Locale(identifier: "th_TH")
        return fmt.string(from: date)
    }
}
