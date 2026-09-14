import SwiftUI

struct PlayDashboardView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var store  = PlaySessionStore.shared
    @StateObject private var conn   = PhoneConnectivityManager.shared
    @State private var showSummary  = false
    @State private var lastSession: SportSession?
    @State private var section: Section = .groups

    enum Section: String, CaseIterable {
        case groups = "นัดกีฬา"
        case watch  = "ติดตามด้วย Watch"
    }

    var body: some View {
        NavigationStack {
            Group {
                if section == .watch {
                    watchTrackingContent
                        .navigationTitle("Slippy Play")
                } else {
                    SportGroupsView()
                        .navigationTitle("นัดกีฬา")
                }
            }
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("", selection: $section) {
                        ForEach(Section.allCases, id: \.self) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 260)
                }
            }
        }
        .sheet(isPresented: $showSummary) {
            if let session = lastSession {
                SessionSummaryView(session: session)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .watchSessionEnded)) { note in
            if let session = note.object as? SportSession {
                lastSession  = session
                showSummary  = true
                if let orgId = authVM.org?.id, let userId = authVM.session?.user.id.uuidString {
                    Task {
                        guard let insight = await SportPlaySync.sync(session, orgId: orgId, userId: userId) else { return }
                        var updated = session
                        updated.insightText      = insight.text
                        updated.skillScore       = insight.skillScore
                        updated.powerScore       = insight.powerScore
                        updated.staminaScore     = insight.staminaScore
                        updated.consistencyScore = insight.consistencyScore
                        PlaySessionStore.shared.save(session: updated)
                        await MainActor.run {
                            if lastSession?.id == updated.id { lastSession = updated }
                        }
                    }
                }
            }
        }
    }

    private var watchTrackingContent: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Watch status
                watchStatusBanner

                // Live mirror (if active)
                if let live = conn.activeSummary {
                    liveMirrorCard(live)
                }

                // Weekly stats
                weeklyStatsCard

                // Recent sessions
                recentSessionsList
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(Color.background.ignoresSafeArea())
    }

    // MARK: – Watch Status

    private var watchStatusBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: conn.isWatchReachable ? "applewatch.watchface" : "applewatch")
                .font(.system(size: 22))
                .foregroundColor(conn.isWatchReachable ? .green : .gray)
            VStack(alignment: .leading, spacing: 2) {
                Text(conn.isWatchReachable ? "Apple Watch เชื่อมต่อแล้ว" : "ยังไม่พบ Apple Watch")
                    .font(.system(size: 14, weight: .semibold))
                Text(conn.isWatchReachable ? "พร้อมเริ่มเล่นได้เลย" : "เปิดแอปบน Watch ก่อน")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    // MARK: – Live Mirror

    private func liveMirrorCard(_ live: PhoneConnectivityManager.LiveSummary) -> some View {
        VStack(spacing: 12) {
            HStack {
                Circle().fill(Color.red).frame(width: 8, height: 8)
                    .overlay(Circle().fill(Color.red).scaleEffect(1.6).opacity(0.3))
                Text("กำลังเล่นอยู่")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.red)
                Spacer()
            }

            HStack(spacing: 0) {
                liveMetric(value: formatElapsed(live.elapsedSeconds), label: "เวลา",   color: .white)
                liveMetric(value: "\(live.totalShots)", label: "ลูกตี",  color: .green)
                liveMetric(value: "\(live.smashCount)", label: "Smash",  color: .yellow)
                liveMetric(value: "\(live.heartRate)",  label: "HR",     color: .red)
            }
        }
        .padding(16)
        .background(Color(hex: "#0f172a"))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func liveMetric(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: – Weekly Stats

    private var weeklyStatsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("สัปดาห์นี้")
                .font(.system(size: 15, weight: .bold))

            HStack(spacing: 0) {
                statBlock(value: "\(store.totalShotsThisWeek)",   label: "ลูกตี",        color: Color(hex: "#16a34a"))
                statBlock(value: "\(store.totalSmashThisWeek)",   label: "Smash",        color: Color(hex: "#f59e0b"))
                statBlock(value: "\(store.activeMinutesThisWeek)", label: "นาที",        color: Color(hex: "#3b82f6"))
                statBlock(value: "\(store.sessions.filter { isThisWeek($0.startedAt) }.count)", label: "เซสชัน", color: Color(hex: "#8b5cf6"))
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func statBlock(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 20, weight: .black, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: – Recent Sessions

    private var recentSessionsList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ประวัติล่าสุด")
                .font(.system(size: 15, weight: .bold))

            if store.sessions.isEmpty {
                emptyState
            } else {
                ForEach(store.sessions.prefix(10)) { session in
                    sessionRow(session)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 40))
                .foregroundColor(Color(hex: "#86efac"))
            Text("ยังไม่มีประวัติการเล่น\nเริ่มเล่นกีฬาจาก Apple Watch ได้เลย")
                .font(.system(size: 13))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func sessionRow(_ session: SportSession) -> some View {
        Button {
            lastSession = session
            showSummary = true
        } label: {
            HStack(spacing: 14) {
                Circle()
                    .fill(Color(hex: "#dcfce7"))
                    .frame(width: 44, height: 44)
                    .overlay(
                        Image(systemName: "sportscourt.fill")
                            .font(.system(size: 18))
                            .foregroundColor(Color(hex: "#16a34a"))
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(session.startedAt, style: .date)
                        .font(.system(size: 13, weight: .semibold))
                    Text("\(session.totalShots) ลูก · \(session.smashCount) Smash · \(session.durationFormatted)")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            .padding(14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }

    // MARK: – Helpers

    private func formatElapsed(_ s: Int) -> String {
        let m = s / 60; let sec = s % 60
        return String(format: "%02d:%02d", m, sec)
    }

    private func isThisWeek(_ date: Date) -> Bool {
        Calendar.current.isDate(date, equalTo: .now, toGranularity: .weekOfYear)
    }
}
