import SwiftUI

/// Shown by RootView instead of MainTabView when AuthViewModel has a
/// pending TOTP challenge after password sign-in — mirrors the web login
/// form's inline code-entry step.
struct MfaChallengeView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var code = ""
    @State private var isVerifying = false

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "shield.checkered")
                .font(.system(size: 40)).foregroundColor(Color.brand500)
            VStack(spacing: 6) {
                Text("ยืนยันตัวตน").font(.system(size: 22, weight: .bold)).foregroundColor(Color.textPrimary)
                Text("กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ")
                    .font(.system(size: 13)).foregroundColor(Color.textSecondary)
                    .multilineTextAlignment(.center)
            }

            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .onChange(of: code) { _, v in
                    code = String(v.filter(\.isNumber).prefix(6))
                }
                .padding(.vertical, 14)
                .frame(width: 220)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))

            if let error = authVM.error {
                Text(error).font(.system(size: 13)).foregroundColor(Color.statusFailed)
            }

            Button {
                Task {
                    isVerifying = true
                    _ = await authVM.completeMfaChallenge(code: code)
                    isVerifying = false
                }
            } label: {
                ZStack {
                    if isVerifying { ProgressView().tint(.white) }
                    else { Text("ยืนยัน").font(.system(size: 16, weight: .bold)).foregroundColor(.white) }
                }
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(code.count == 6 ? Color.brand500 : Color.brand500.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(isVerifying || code.count != 6)
            .padding(.horizontal, 40)

            Button("กลับไปเข้าสู่ระบบ") {
                Task { await authVM.signOut() }
            }
            .font(.system(size: 13)).foregroundColor(Color.textSecondary)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.background)
    }
}
