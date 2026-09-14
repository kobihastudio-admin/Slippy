import SwiftUI

/// Mobile counterpart of `web/src/app/(app)/billing` — shows live plan/usage/
/// subscription data straight from `organizations` (same columns as web), plus
/// recent `billing_invoices`. "Manage plan"/"Upgrade" open the authenticated
/// web billing flow in an in-app browser sheet (Stripe session creation needs
/// server-side secrets), so the user never leaves the app.
private struct IdentifiableURL: Identifiable {
    let id = UUID()
    let url: URL
}

struct BillingView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = BillingViewModel()
    @State private var safariURL: IdentifiableURL?

    // No NavigationStack here — always reached via a push from Profile or
    // the "เพิ่มเติม" hub, both of which already own one.
    var body: some View {
            ScrollView {
                VStack(spacing: 16) {
                    if vm.isLoading && vm.org == nil {
                        SlippyLoadingView(message: "กำลังโหลดข้อมูล...")
                    } else if let org = vm.org {
                        planCard(org)
                        usageCard(org)
                        actionsCard
                        if !vm.invoices.isEmpty {
                            invoicesSection
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("แผนการใช้งาน / Billing")
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.background)
            .task { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .refreshable { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .sheet(item: $safariURL) { item in
                SafariView(url: item.url).ignoresSafeArea()
            }
    }

    // MARK: – Plan
    private func planCard(_ org: BillingOrg) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("แผนปัจจุบัน")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white.opacity(0.78))
                    Text(org.planLabel)
                        .font(.system(size: 26, weight: .heavy))
                        .foregroundColor(.white)
                }
                Spacer()
                Text(org.statusLabel)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.white.opacity(0.18))
                    .clipShape(Capsule())
            }
            if let endsAt = org.subscriptionEndsAt {
                Text("ต่ออายุ/สิ้นสุด: \(fmtDate(endsAt))")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.85))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Color(hex: "#8b5cf6"), Color(hex: "#6366f1"), Color(hex: "#4338ca")],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    // MARK: – Usage
    private func usageCard(_ org: BillingOrg) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("โควต้าเอกสารรายเดือน")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Text("\(org.docUsed) / \(org.docQuota)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.textSecondary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.border).frame(height: 8)
                    Capsule()
                        .fill(LinearGradient(colors: [Color.brand500, Color.brand400],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(org.quotaPercent), height: 8)
                }
            }
            .frame(height: 8)
        }
        .sectionCard()
    }

    // MARK: – Actions (open in-app browser for Stripe-backed flows)
    private var actionsCard: some View {
        VStack(spacing: 0) {
            billingActionRow(title: "อัปเกรด / เปลี่ยนแผน", icon: "arrow.up.circle.fill",
                             tint: Color.brand500, path: "/pricing")
            rowDivider
            billingActionRow(title: "จัดการการชำระเงิน (Stripe Portal)", icon: "creditcard.fill",
                             tint: Color(hex: "#10b981"), path: "/billing?portal=open")
            rowDivider
            billingActionRow(title: "ซื้อแพ็กเอกสารเพิ่ม", icon: "shippingbox.fill",
                             tint: Color(hex: "#f59e0b"), path: "/billing?buy-pack=open")
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    private func billingActionRow(title: String, icon: String, tint: Color, path: String) -> some View {
        Button {
            hapticLight()
            // Same dead-domain bug already found in TripDocumentAPI/
            // MedicationScanAPI — "app.slippy.app" is NXDOMAIN, never
            // actually provisioned. Config.webAppURL is the real one.
            if let url = URL(string: "\(Config.webAppURL.absoluteString)\(path)") {
                safariURL = IdentifiableURL(url: url)
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(tint)
                    .frame(width: 32, height: 32)
                    .background(tint.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
        }
    }

    private var rowDivider: some View {
        Divider().padding(.leading, 62)
    }

    // MARK: – Invoices
    private var invoicesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ประวัติการชำระเงิน")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textPrimary)
            VStack(spacing: 8) {
                ForEach(vm.invoices) { inv in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(inv.createdAt.map(fmtDate) ?? "—")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color.textPrimary)
                            Text((inv.status ?? "paid").capitalized)
                                .font(.system(size: 11))
                                .foregroundColor(Color.textSecondary)
                        }
                        Spacer()
                        Text(fmtTHB(inv.amount ?? 0))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(Color.textPrimary)
                    }
                    .padding(12)
                    .background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
                }
            }
        }
    }
}
