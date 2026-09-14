import SwiftUI

/// Mobile counterpart of `web/src/app/(app)/tax` (`tax-page-client.tsx`) —
/// computes VAT (ภ.พ.30) and WHT from the same `documents` table/columns
/// as `/api/tax/vat` and `/api/tax/wht`'s Supabase fallback path, so the
/// figures always match what's shown on the web.
struct TaxView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = TaxViewModel()
    @State private var tab: Tab = .vat

    enum Tab: String, CaseIterable { case vat = "VAT (ภ.พ.30)", wht = "หัก ณ ที่จ่าย" }

    private var now: (year: Int, month: Int) {
        let cal = Calendar(identifier: .gregorian)
        let comps = cal.dateComponents([.year, .month], from: Date())
        return (comps.year ?? 2026, comps.month ?? 1)
    }

    // No NavigationStack here — always reached via a push from Dashboard,
    // Profile, or the "เพิ่มเติม" hub, all of which already own one.
    var body: some View {
            ScrollView {
                VStack(spacing: 18) {
                    Picker("", selection: $tab) {
                        ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                    if vm.isLoading {
                        SlippyLoadingView(message: "กำลังโหลดภาษี...")
                    } else if tab == .vat {
                        vatSection
                    } else {
                        whtSection
                    }
                }
                .padding(.bottom, 32)
            }
            .navigationTitle("ภาษี")
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.background)
            .task {
                guard let orgId = authVM.org?.id else { return }
                await vm.load(orgId: orgId, year: now.year, month: now.month)
            }
            .refreshable {
                guard let orgId = authVM.org?.id else { return }
                await vm.load(orgId: orgId, year: now.year, month: now.month)
            }
    }

    // MARK: – VAT
    private var vatSection: some View {
        VStack(spacing: 14) {
            if let vat = vm.vat {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("ภาษีมูลค่าเพิ่มสุทธิ (ภ.พ.30)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white.opacity(0.8))
                        Spacer()
                        if let due = vat.dueDate {
                            Text("ครบกำหนด \(fmtDate(due + "T00:00:00Z"))")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.white.opacity(0.85))
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(Color.white.opacity(0.16))
                                .clipShape(Capsule())
                        }
                    }
                    Text(fmtTHB(abs(vat.netVat)))
                        .font(.system(size: 30, weight: .heavy))
                        .foregroundColor(.white)
                    Text(vat.netVat >= 0 ? "ต้องชำระเพิ่ม" : "ขอคืนภาษีได้")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white.opacity(0.85))
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Color.white.opacity(0.16))
                        .clipShape(Capsule())
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(colors: [Color(hex: "#6366f1"), Color(hex: "#4338ca")],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 16)

                HStack(spacing: 12) {
                    vatBox(title: "ภาษีซื้อ (Input VAT)", base: vat.inputBase, vat: vat.inputVat,
                           tint: Color(hex: "#10b981"))
                    vatBox(title: "ภาษีขาย (Output VAT)", base: vat.outputBase, vat: vat.outputVat,
                           tint: Color(hex: "#f59e0b"))
                }
                .padding(.horizontal, 16)
            } else {
                emptyTax
            }
        }
    }

    private func vatBox(title: String, base: Double, vat: Double, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .lineLimit(1)
            Text(fmtTHB(vat))
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(tint)
            Text("ฐานภาษี \(fmtTHB(base))")
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
    }

    // MARK: – WHT
    private var whtSection: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                summaryTile(title: "ฐานภาษีรวม", value: fmtTHB(vm.whtTotalBase), tint: Color.brand500)
                summaryTile(title: "ภาษีหัก ณ ที่จ่ายรวม", value: fmtTHB(vm.whtTotalTax), tint: Color(hex: "#ef4444"))
            }
            .padding(.horizontal, 16)

            if vm.whtItems.isEmpty {
                emptyTax
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(vm.whtItems) { item in
                        whtRow(item)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func summaryTile(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
            Text(value)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(tint)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
    }

    private func whtRow(_ item: WhtItem) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(item.payer)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .lineLimit(1)
                Text("\(fmtDate(item.date + "T00:00:00Z")) · อัตรา \(String(format: "%.0f", item.rate))%")
                    .font(.system(size: 11))
                    .foregroundColor(Color.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(fmtTHB(item.tax))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color(hex: "#ef4444"))
                Text("จาก \(fmtTHB(item.amount))")
                    .font(.system(size: 10))
                    .foregroundColor(Color.textSecondary)
            }
        }
        .padding(12)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border, lineWidth: 1))
    }

    private var emptyTax: some View {
        VStack(spacing: 10) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36))
                .foregroundColor(Color.border)
            Text("ไม่มีข้อมูลภาษีในเดือนนี้")
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 50)
    }
}
