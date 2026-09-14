import SwiftUI

/// "เพิ่มเติม" tab — a hub for features that don't warrant their own bottom
/// tab slot (Social, Health, Trips, Tax, Vendors, Billing, Profile). Replaces
/// the old dedicated "โซเชียล" tab slot; Social is still one tap away from
/// here, just consolidated alongside everything else this app has that
/// previously had no tab-level entry point at all.
struct MoreMenuView: View {
    @EnvironmentObject var authVM: AuthViewModel

    private struct Item: Identifiable {
        let id = UUID()
        let icon: String
        let label: String
        let sub: String
        let tint: Color
    }

    private let items: [Item] = [
        Item(icon: "person.3.fill",       label: "โซเชียล",        sub: "เพื่อน กิจกรรม และฟีด",         tint: Color(hex: "#db2777")),
        Item(icon: "airplane",             label: "ทริป",           sub: "จัดการทริปและที่พัก",            tint: Color(hex: "#2563eb")),
        Item(icon: "checkmark.circle.fill", label: "ภารกิจ",        sub: "รายการสิ่งที่ต้องทำ",            tint: Color(hex: "#2563eb")),
        Item(icon: "heart.text.square.fill", label: "สุขภาพและยา", sub: "บันทึกยาและการนัดหมอ",           tint: Color(hex: "#dc2626")),
        Item(icon: "doc.plaintext.fill",   label: "ภาษี",           sub: "VAT และภาษีหัก ณ ที่จ่าย",       tint: Color(hex: "#7c3aed")),
        Item(icon: "building.2.fill",      label: "ผู้ขาย/ร้านค้า", sub: "รายชื่อผู้ขายที่ใช้บ่อย",        tint: Color(hex: "#16a34a")),
        Item(icon: "creditcard.fill",      label: "แพ็กเกจและการเรียกเก็บเงิน", sub: "จัดการแผนการใช้งาน", tint: Color(hex: "#ea580c")),
        Item(icon: "person.crop.circle.fill", label: "โปรไฟล์",     sub: "บัญชีและการตั้งค่า",             tint: Color(hex: "#6366f1")),
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#f4f3ff").ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(items) { item in
                            NavigationLink(destination: destination(for: item.label)) {
                                HStack(spacing: 14) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 14).fill(item.tint.opacity(0.12)).frame(width: 48, height: 48)
                                        Image(systemName: item.icon).font(.system(size: 19)).foregroundColor(item.tint)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.label).font(.system(size: 14.5, weight: .semibold)).foregroundColor(Color(hex: "#1e1b4b"))
                                        Text(item.sub).font(.system(size: 12)).foregroundColor(Color(hex: "#9ca3af"))
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 13)).foregroundColor(Color(hex: "#d1d5db"))
                                }
                                .padding(14)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("เพิ่มเติม")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    @ViewBuilder
    private func destination(for label: String) -> some View {
        switch label {
        case "โซเชียล":                          SocialView()
        case "ทริป":                              TripsView()
        case "ภารกิจ":                            TasksView()
        case "สุขภาพและยา":                       HealthView()
        case "ภาษี":                               TaxView()
        case "ผู้ขาย/ร้านค้า":                     VendorsView()
        case "แพ็กเกจและการเรียกเก็บเงิน":         BillingView()
        default:                                   ProfileView()
        }
    }
}
