import SwiftUI

struct AnalyticsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = AnalyticsViewModel()

    private let catColors: [Color] = [.brand500, Color(hex: "#8b5cf6"),
                                       Color(hex: "#06b6d4"), Color(hex: "#10b981"),
                                       Color(hex: "#f97316"), Color(hex: "#ec4899")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if vm.isLoading {
                        SlippyLoadingView(message: "กำลังโหลดรายงาน...")
                    } else {
                        yearTotalCard
                        barChartCard
                        categoryCard
                        monthlyListCard
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle("รายงาน")
            .navigationBarTitleDisplayMode(.large)
            .task {
                guard let orgId = authVM.org?.id else { return }
                await vm.load(orgId: orgId)
            }
        }
    }

    // MARK: – Year total
    private var yearTotalCard: some View {
        VStack(spacing: 8) {
            Text("รวมทั้งปี")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white.opacity(0.75))
            Text(fmtTHB(vm.yearTotal))
                .font(.system(size: 34, weight: .black))
                .foregroundColor(.white)
            Text("จาก \(vm.chartData.count) เดือน")
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.65))
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(
            LinearGradient(colors: [Color.brand500, Color.brand600],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .cornerRadius(24)
        .shadow(color: Color.brand500.opacity(0.35), radius: 16, x: 0, y: 8)
    }

    // MARK: – Bar chart
    private var barChartCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("ค่าใช้จ่ายรายเดือน")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textPrimary)

            MiniBarChart(data: vm.chartData)

            if let latest = vm.chartData.last {
                HStack {
                    Text("เดือนล่าสุด (\(latest.label))")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                    Spacer()
                    Text(fmtTHB(latest.spend))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Color.brand500)
                }
                .padding(.top, 4)
            }
        }
        .sectionCard()
    }

    // MARK: – Category breakdown
    private var categoryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("แยกตามหมวดหมู่")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textPrimary)

            let cats = vm.catBreakdown.isEmpty ? [("ไม่มีข้อมูล", 1.0)] : vm.catBreakdown
            let catTotal = cats.reduce(0) { $0 + $1.value }
            ForEach(Array(cats.enumerated()), id: \.offset) { i, cat in
                VStack(spacing: 4) {
                    HStack {
                        Circle()
                            .fill(catColors[i % catColors.count])
                            .frame(width: 8, height: 8)
                        Text(cat.name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        Spacer()
                        Text(vm.catBreakdown.isEmpty ? "—" : fmtTHB(cat.value))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Color.textPrimary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.border).frame(height: 4)
                            Capsule()
                                .fill(catColors[i % catColors.count])
                                .frame(width: geo.size.width * (catTotal > 0 ? cat.value / catTotal : 0), height: 4)
                        }
                    }
                    .frame(height: 4)
                }
            }
        }
        .sectionCard()
    }

    // MARK: – Monthly list
    private var monthlyListCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("สรุปรายเดือน")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textPrimary)
                .padding(.bottom, 12)

            ForEach(vm.chartData.reversed()) { month in
                HStack {
                    Text(month.label)
                        .font(.system(size: 13))
                        .foregroundColor(Color.textPrimary)
                    Spacer()
                    Text(fmtTHB(month.spend))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                }
                .padding(.vertical, 10)
                if month.label != vm.chartData.first?.label {
                    Divider()
                }
            }
        }
        .sectionCard()
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return AnalyticsView().environmentObject(vm)
}
#endif

// MARK: – Mini bar chart
struct MiniBarChart: View {
    let data: [ChartMonth]

    var body: some View {
        let maxVal = data.map(\.spend).max() ?? 1
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(Array(data.enumerated()), id: \.offset) { i, month in
                VStack(spacing: 4) {
                    Capsule()
                        .fill(i == data.count - 1
                              ? Color.brand500
                              : Color.brand500.opacity(0.25))
                        .frame(height: max(4, CGFloat(month.spend / maxVal) * 64))
                    Text(month.label)
                        .font(.system(size: 8))
                        .foregroundColor(Color.textSecondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 80)
    }
}
