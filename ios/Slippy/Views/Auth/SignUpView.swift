import SwiftUI
import Supabase

struct SignUpView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var fullName  = ""
    @State private var email     = ""
    @State private var password  = ""
    @State private var confirm   = ""
    @State private var showPw    = false
    @State private var showCfPw  = false
    @State private var isLoading = false
    @State private var localError: String?
    @State private var success   = false
    @State private var appeared  = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                signUpBackground(geo)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 20)

                        headerSection

                        Spacer().frame(height: 24)

                        if let err = localError {
                            errorBanner(err)
                                .padding(.horizontal, 24)
                                .transition(.move(edge: .top).combined(with: .opacity))
                            Spacer().frame(height: 12)
                        }

                        if success {
                            successSection
                                .padding(.horizontal, 24)
                        } else {
                            formSection
                                .padding(.horizontal, 24)
                        }

                        Spacer().frame(height: 40)
                    }
                    .frame(width: geo.size.width)
                }
            }
        }
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                            to: nil, from: nil, for: nil)
        }
        .onAppear {
            withAnimation(.spring(response: 0.65, dampingFraction: 0.8).delay(0.1)) {
                appeared = true
            }
        }
    }

    // MARK: – Background (same blobs as LoginView)

    private func signUpBackground(_ geo: GeometryProxy) -> some View {
        ZStack {
            Color(hex: "#eeeaff").ignoresSafeArea()
            Ellipse()
                .fill(Color(hex: "#c4b5fd").opacity(0.55))
                .frame(width: 340, height: 260)
                .rotationEffect(.degrees(-20))
                .offset(x: geo.size.width * 0.3, y: -geo.size.height * 0.28)
            Ellipse()
                .fill(Color(hex: "#ddd6fe").opacity(0.4))
                .frame(width: 300, height: 200)
                .rotationEffect(.degrees(15))
                .offset(x: -geo.size.width * 0.2, y: geo.size.height * 0.42)
        }
    }

    // MARK: – Header

    private var headerSection: some View {
        VStack(spacing: 0) {
            ZStack {
                sparkle(dx: -62, dy: -22, size: 13, color: Color(hex: "#a78bfa"))
                sparkle(dx:  64, dy: -16, size: 10, color: Color(hex: "#f472b6"))
                sparkle(dx: -50, dy:  36, size:  8, color: Color(hex: "#818cf8"))
                sparkle(dx:  58, dy:  32, size: 10, color: Color(hex: "#a78bfa"))
                sparkle(dx:   8, dy: -44, size:  7, color: Color(hex: "#f9a8d4"))

                SlippyLogoMark(size: 72, glow: false)
                    .scaleEffect(appeared ? 1.0 : 0.55)
                    .opacity(appeared ? 1.0 : 0.0)
            }
            .frame(width: 160, height: 120)

            Spacer().frame(height: 12)

            Text("สร้างบัญชีใหม่")
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#1e1b4b"))

            Spacer().frame(height: 4)

            Text("เริ่มต้นใช้งาน Slippy วันนี้")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color(hex: "#7c72f5"))

            Spacer().frame(height: 6)

            Text("ผู้ช่วย AI จัดการชีวิตให้ง่ายขึ้น 💜")
                .font(.system(size: 12))
                .foregroundColor(Color(hex: "#6b7280"))
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : -10)
    }

    private func sparkle(dx: CGFloat, dy: CGFloat, size: CGFloat, color: Color) -> some View {
        Image(systemName: "sparkle")
            .font(.system(size: size, weight: .bold))
            .foregroundColor(color.opacity(0.85))
            .offset(x: dx, y: dy)
    }

    // MARK: – Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(Color(hex: "#ef4444"))
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#dc2626"))
            Spacer()
            Button { withAnimation { localError = nil } } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color(hex: "#9ca3af"))
            }
        }
        .padding(12)
        .background(Color(hex: "#fef2f2"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#fecaca"), lineWidth: 1))
    }

    // MARK: – Success

    private var successSection: some View {
        VStack(spacing: 20) {
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color(hex: "#16a34a").opacity(0.12))
                        .frame(width: 80, height: 80)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundColor(Color(hex: "#16a34a"))
                }
                Text("สมัครสมาชิกสำเร็จ!")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(Color(hex: "#15803d"))
                Text("กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ")
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "#6b7280"))
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
            .padding(24)
            .background(Color.white.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: .black.opacity(0.05), radius: 10, y: 4)

            Button { dismiss() } label: {
                Text("กลับหน้าเข้าสู่ระบบ")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(
                        LinearGradient(
                            colors: [Color(hex: "#8b7cf8"), Color(hex: "#6366f1")],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .shadow(color: Color(hex: "#6366f1").opacity(0.3), radius: 10, x: 0, y: 4)
            }
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 16)
    }

    // MARK: – Form

    private var formSection: some View {
        VStack(spacing: 12) {
            // Card background wrapping all fields
            VStack(spacing: 0) {
                inputRow(icon: "person.fill", placeholder: "Full Name") {
                    TextField("", text: $fullName)
                        .autocapitalization(.words)
                        .autocorrectionDisabled()
                        .font(.system(size: 15))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                }

                fieldDivider

                inputRow(icon: "envelope.fill", placeholder: "E-mail Address") {
                    TextField("", text: $email)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .font(.system(size: 15))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                }

                fieldDivider

                passwordRow(placeholder: "Password (min 8 characters)",
                            text: $password, show: $showPw)

                fieldDivider

                passwordRow(placeholder: "Confirm Password",
                            text: $confirm, show: $showCfPw)
            }
            .background(Color.white.opacity(0.92))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color(hex: "#e5e7eb"), lineWidth: 1)
            )

            // Password strength indicator
            if !password.isEmpty {
                passwordStrengthBar(password: password)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Spacer().frame(height: 4)

            // Sign Up button
            Button { Task { await handleSignUp() } } label: {
                ZStack {
                    if isLoading {
                        ProgressView().tint(.white)
                    } else {
                        HStack(spacing: 8) {
                            Text("สมัครสมาชิก")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.white)
                            Image(systemName: "arrow.right")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(
                    LinearGradient(
                        colors: [Color(hex: "#8b7cf8"), Color(hex: "#6366f1")],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .shadow(color: Color(hex: "#6366f1").opacity(0.3), radius: 10, x: 0, y: 4)
            }
            .disabled(isLoading)
            .opacity(isLoading ? 0.7 : 1)
            .scaleEffect(isLoading ? 0.98 : 1)
            .animation(.spring(response: 0.2), value: isLoading)

            // Terms hint
            Text("การสมัครสมาชิกถือว่าคุณยอมรับ Terms of Service\nและ Privacy Policy ของ Slippy")
                .font(.system(size: 11))
                .foregroundColor(Color(hex: "#9ca3af"))
                .multilineTextAlignment(.center)
                .lineSpacing(2)

            // Already have account
            HStack(spacing: 4) {
                Text("มีบัญชีแล้ว?")
                    .font(.system(size: 13)).foregroundColor(Color(hex: "#9ca3af"))
                Button("เข้าสู่ระบบ") { dismiss() }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 16)
    }

    private var fieldDivider: some View {
        Divider()
            .padding(.leading, 48)
    }

    @ViewBuilder
    private func inputRow<F: View>(icon: String, placeholder: String,
                                   @ViewBuilder field: () -> F) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "#a78bfa"))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(placeholder)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color(hex: "#9ca3af"))
                field()
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    @ViewBuilder
    private func passwordRow(placeholder: String,
                             text: Binding<String>,
                             show: Binding<Bool>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "#a78bfa"))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(placeholder)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color(hex: "#9ca3af"))
                Group {
                    if show.wrappedValue {
                        TextField("", text: text)
                    } else {
                        SecureField("", text: text)
                    }
                }
                .font(.system(size: 15))
                .foregroundColor(Color(hex: "#1e1b4b"))
            }
            Button { show.wrappedValue.toggle(); hapticLight() } label: {
                Image(systemName: show.wrappedValue ? "eye.slash.fill" : "eye.fill")
                    .font(.system(size: 14))
                    .foregroundColor(Color(hex: "#c4b5fd"))
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    // MARK: – Password strength

    private func passwordStrengthBar(password: String) -> some View {
        let strength = passwordStrength(password)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(i < strength.level ? strength.color : Color(hex: "#e5e7eb"))
                        .frame(maxWidth: .infinity).frame(height: 4)
                        .animation(.spring(response: 0.3), value: strength.level)
                }
            }
            Text(strength.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(strength.color)
        }
    }

    private struct PasswordStrength {
        let level: Int    // 0–4
        let label: String
        let color: Color
    }

    private func passwordStrength(_ pw: String) -> PasswordStrength {
        var score = 0
        if pw.count >= 8  { score += 1 }
        if pw.count >= 12 { score += 1 }
        if pw.range(of: "[0-9]", options: .regularExpression) != nil { score += 1 }
        if pw.range(of: "[^A-Za-z0-9]", options: .regularExpression) != nil { score += 1 }
        switch score {
        case 0, 1: return PasswordStrength(level: 1, label: "อ่อนมาก", color: Color(hex: "#ef4444"))
        case 2:    return PasswordStrength(level: 2, label: "พอใช้",   color: Color(hex: "#f97316"))
        case 3:    return PasswordStrength(level: 3, label: "ดี",       color: Color(hex: "#eab308"))
        default:   return PasswordStrength(level: 4, label: "แข็งแกร่ง", color: Color(hex: "#16a34a"))
        }
    }

    // MARK: – Sign Up Logic

    private func handleSignUp() async {
        withAnimation { localError = nil }

        let name = fullName.trimmingCharacters(in: .whitespaces)
        let mail = email.trimmingCharacters(in: .whitespaces)

        guard !name.isEmpty else { withAnimation { localError = "กรุณากรอกชื่อ-นามสกุล" }; hapticError(); return }
        guard !mail.isEmpty else { withAnimation { localError = "กรุณากรอกอีเมล" }; hapticError(); return }
        guard password.count >= 8 else { withAnimation { localError = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" }; hapticError(); return }
        guard password == confirm else { withAnimation { localError = "รหัสผ่านไม่ตรงกัน" }; hapticError(); return }

        isLoading = true
        hapticLight()

        do {
            try await SupabaseManager.shared.client.auth.signUp(
                email: mail,
                password: password,
                data: ["full_name": AnyJSON.string(name)]
            )
            isLoading = false
            withAnimation(.spring(response: 0.5)) { success = true }
            hapticSuccess()
        } catch {
            isLoading = false
            withAnimation { localError = error.localizedDescription }
            hapticError()
        }
    }
}

private func hapticError() {
    UINotificationFeedbackGenerator().notificationOccurred(.error)
}

#if DEBUG
#Preview {
    SignUpView().environmentObject(AuthViewModel(_preview: true))
}
#endif
