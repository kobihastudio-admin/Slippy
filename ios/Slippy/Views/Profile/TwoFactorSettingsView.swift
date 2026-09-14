import SwiftUI

/// Enroll/unenroll TOTP — same flow as the web app's `MfaCard` in
/// `web/src/app/(app)/privacy/page.tsx`. Linked from ProfileView's
/// "การยืนยันตัวตน" section.
struct TwoFactorSettingsView: View {
    @StateObject private var vm = MfaViewModel()
    @State private var code = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("เพิ่มชั้นความปลอดภัยด้วยแอป Authenticator (Google Authenticator, Authy ฯลฯ) — ไม่บังคับ แนะนำให้เปิดใช้งาน")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)

                if vm.isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                } else {
                    statusCard

                    if vm.enrollFactorId != nil {
                        enrollCard
                    }
                }

                if let error = vm.error {
                    Text(error).font(.system(size: 12)).foregroundColor(Color.statusFailed)
                }
            }
            .padding(16)
        }
        .background(Color.background)
        .navigationTitle("2-Factor Authentication")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadFactors() }
    }

    private var statusCard: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill((vm.verifiedFactor != nil ? Color.statusApproved : Color(hex: "#f59e0b")).opacity(0.12))
                    .frame(width: 40, height: 40)
                Image(systemName: "shield.checkered")
                    .foregroundColor(vm.verifiedFactor != nil ? Color.statusApproved : Color(hex: "#f59e0b"))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("TOTP Authenticator").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                Text(vm.verifiedFactor != nil ? "เปิดใช้งานแล้ว" : "ยังไม่เปิดใช้งาน")
                    .font(.system(size: 12)).foregroundColor(Color.textSecondary)
            }
            Spacer()
            if vm.verifiedFactor != nil {
                Button("ปิดใช้งาน") {
                    Task { await vm.disable() }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.statusFailed)
                .disabled(vm.isBusy)
            } else {
                Button("เปิดใช้งาน") {
                    Task { await vm.startEnroll() }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.brand500)
                .disabled(vm.isBusy || vm.enrollFactorId != nil)
            }
        }
        .padding(14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
    }

    private var enrollCard: some View {
        VStack(spacing: 14) {
            Text("สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน")
                .font(.system(size: 12.5)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)

            if let qrImage = vm.qrImage {
                Image(uiImage: qrImage)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 180, height: 180)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            if let secret = vm.secret {
                VStack(spacing: 4) {
                    Text("หรือกรอกโค้ดนี้เอง").font(.system(size: 11)).foregroundColor(Color.textSecondary)
                    Text(secret)
                        .font(.system(size: 12, design: .monospaced))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color.surfaceMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }

            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.system(size: 20, weight: .bold, design: .monospaced))
                .onChange(of: code) { _, v in
                    code = String(v.filter(\.isNumber).prefix(6))
                }
                .padding(.vertical, 10)
                .frame(width: 160)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))

            HStack(spacing: 12) {
                Button("ยกเลิก") { Task { await vm.cancelEnroll() } }
                    .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                Button("ยืนยัน") {
                    Task {
                        if await vm.confirmEnroll(code: code) { code = "" }
                    }
                }
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(code.count == 6 ? Color.brand500 : Color.brand500.opacity(0.4))
                .clipShape(Capsule())
                .disabled(vm.isBusy || code.count != 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
    }
}
