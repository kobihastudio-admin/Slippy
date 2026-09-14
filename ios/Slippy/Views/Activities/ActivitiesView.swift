import SwiftUI

struct ActivitiesView: View {
    @State private var scope: ActivityScope = .mine
    @State private var activities: [ActivitySummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && activities.isEmpty {
                ProgressView().tint(Color.brand500)
            } else if activities.isEmpty {
                ContentUnavailableView(
                    "ยังไม่มีกิจกรรม",
                    systemImage: "calendar.badge.plus",
                    description: Text("เลือกกิจกรรมจากทริป หรือค้นหากิจกรรมที่อยากทำได้ที่นี่")
                )
            } else {
                List(activities) { activity in
                    ActivityRow(activity: activity)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("กิจกรรม")
        .toolbarTitleDisplayMode(.large)
        .safeAreaInset(edge: .top) {
            Picker("ขอบเขตกิจกรรม", selection: $scope) {
                ForEach(ActivityScope.allCases) { value in
                    Text(value.label).tag(value)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.background)
        }
        .alert("ไม่สามารถโหลดกิจกรรม", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("ตกลง", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task(id: scope) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            activities = try await ActivityAPI.list(scope: scope)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ActivityRow: View {
    let activity: ActivitySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(activity.category.isEmpty ? "กิจกรรม" : activity.category)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.brand500)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.brand500.opacity(0.12), in: Capsule())
                Spacer()
                Text(activity.visibility.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(activity.title)
                .font(.headline)
                .foregroundStyle(Color.textPrimary)
            if !activity.summary.isEmpty {
                Text(activity.summary)
                    .font(.subheadline)
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(2)
            }
            HStack(spacing: 12) {
                Label(activity.startDate?.formatted(date: .abbreviated, time: .shortened) ?? "ยังไม่กำหนดเวลา", systemImage: "calendar")
                if let location = activity.locationName, !location.isEmpty {
                    Label(location, systemImage: "mappin")
                }
            }
            .font(.caption)
            .foregroundStyle(Color.textSecondary)
        }
        .padding(.vertical, 6)
    }
}
