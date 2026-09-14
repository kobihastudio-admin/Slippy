import SwiftUI
import Supabase

struct LoginView: View {
    @EnvironmentObject var authVM: AuthViewModel

    @State private var email     = ""
    @State private var password  = ""
    @State private var showPw    = false
    @State private var remember  = true
    @State private var isLoading = false
    @State private var oauthKey: String?
    @State private var localError: String?
    @State private var appeared   = false
    @State private var showSignUp = false

    private var busy: Bool {
        isLoading || oauthKey != nil || (authVM.loginLockedUntil.map { $0 > Date() } ?? false)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                splashBackground(geo)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 36)

                        logoSection

                        Spacer().frame(height: 28)

                        socialSection

                        divider

                        emailSection

                        Spacer().frame(height: 40)
                    }
                    .frame(width: geo.size.width - 48)
                }
            }
        }
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                            to: nil, from: nil, for: nil)
        }
        .sheet(isPresented: $showSignUp) {
            SignUpView().environmentObject(authVM)
        }
        .onAppear {
            withAnimation(.spring(response: 0.65, dampingFraction: 0.8).delay(0.1)) {
                appeared = true
            }
        }
    }

    // MARK: – Background
    private func splashBackground(_ geo: GeometryProxy) -> some View {
        ZStack {
            Color(hex: "#eeeaff").ignoresSafeArea()
            // top-right blob
            Ellipse()
                .fill(Color(hex: "#c4b5fd").opacity(0.55))
                .frame(width: 340, height: 260)
                .rotationEffect(.degrees(-20))
                .offset(x: geo.size.width * 0.3, y: -geo.size.height * 0.28)
            // bottom-left blob
            Ellipse()
                .fill(Color(hex: "#ddd6fe").opacity(0.4))
                .frame(width: 300, height: 200)
                .rotationEffect(.degrees(15))
                .offset(x: -geo.size.width * 0.2, y: geo.size.height * 0.42)
        }
    }

    // MARK: – Logo
    private var logoSection: some View {
        VStack(spacing: 0) {
            // Logo + sparkles — fixed frame so sparkles don't bleed
            ZStack {
                sparkle(dx: -68, dy: -26, size: 15, color: Color(hex: "#a78bfa"))
                sparkle(dx:  70, dy: -18, size: 12, color: Color(hex: "#f472b6"))
                sparkle(dx: -55, dy:  42, size:  9, color: Color(hex: "#818cf8"))
                sparkle(dx:  64, dy:  38, size: 11, color: Color(hex: "#a78bfa"))
                sparkle(dx:  10, dy: -50, size:  8, color: Color(hex: "#f9a8d4"))

                SlippyLogoMark(size: 84, glow: false)
                    .scaleEffect(appeared ? 1.0 : 0.55)
                    .opacity(appeared ? 1.0 : 0.0)
            }
            .frame(width: 180, height: 140)

            Spacer().frame(height: 14)

            Text("Slippy")
                .font(.system(size: 32, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#1e1b4b"))

            Spacer().frame(height: 4)

            Text("Your AI Life Assistant")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Color(hex: "#7c72f5"))

            Spacer().frame(height: 8)

            Text("จัดการชีวิตให้ง่ายขึ้น\nด้วยผู้ช่วยอัจฉริยะของคุณ 💜")
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#6b7280"))
                .multilineTextAlignment(.center)
                .lineSpacing(3)
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

    // MARK: – Social buttons
    private var socialSection: some View {
        VStack(spacing: 10) {
            if let err = localError ?? authVM.error {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(Color(hex: "#ef4444"))
                    Text(err).font(.system(size: 13)).foregroundColor(Color(hex: "#dc2626"))
                    Spacer()
                }
                .padding(12)
                .background(Color(hex: "#fef2f2"))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#fecaca"), lineWidth: 1))
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            socialBtn(label: "เข้าสู่ระบบด้วย LINE",
                      icon: AnyView(LineLogo(size: 20)),
                      bg: Color(hex: "#06C755"),
                      isLoading: oauthKey == "LINE") {
                Task { await runNative("LINE") { await authVM.signInWithLineNative() } }
            }

            socialBtn(label: "เข้าสู่ระบบด้วย Facebook",
                      icon: AnyView(FacebookLogo(size: 20)),
                      bg: Color(hex: "#1877F2"),
                      isLoading: oauthKey == "Facebook") {
                Task { await runNative("Facebook") { await authVM.signInWithFacebookNative() } }
            }

            socialBtn(label: "เข้าสู่ระบบด้วย Google",
                      icon: AnyView(GoogleLogo(size: 20)),
                      bg: .white,
                      textColor: Color(hex: "#1a1a2e"),
                      border: Color(hex: "#e5e7eb"),
                      isLoading: oauthKey == "Google") {
                Task { await runNative("Google") { await authVM.signInWithGoogleNative() } }
            }
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 16)
    }

    // ★ frame(maxWidth:.infinity) is on the Button directly — not inside the label
    private func socialBtn(label: String,
                           icon: AnyView,
                           bg: Color,
                           textColor: Color = .white,
                           border: Color = .clear,
                           isLoading: Bool,
                           action: @escaping () -> Void) -> some View {
        Button(action: { if !busy { hapticLight(); action() } }) {
            ZStack {
                if isLoading {
                    ProgressView().tint(textColor)
                } else {
                    HStack(spacing: 10) {
                        icon
                        Text(label)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(textColor)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(border, lineWidth: border == .clear ? 0 : 1))
            .shadow(color: bg == .white ? .black.opacity(0.06) : bg.opacity(0.25), radius: 6, x: 0, y: 3)
        }
        .opacity(busy ? 0.65 : 1)
        .scaleEffect(busy ? 0.98 : 1)
        .animation(.spring(response: 0.2), value: busy)
    }

    // MARK: – Divider
    private var divider: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Color(hex: "#ddd6fe")).frame(height: 1)
            Text("หรือ")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: "#9ca3af"))
            Rectangle().fill(Color(hex: "#ddd6fe")).frame(height: 1)
        }
        .padding(.vertical, 18)
        .opacity(appeared ? 1 : 0)
    }

    // MARK: – Email form
    private var emailSection: some View {
        VStack(spacing: 12) {
            // Email
            HStack(spacing: 12) {
                Image(systemName: "envelope")
                    .font(.system(size: 14)).foregroundColor(Color(hex: "#9ca3af"))
                TextField("", text: $email,
                          prompt: Text("E-mail Address").foregroundColor(Color(hex: "#9ca3af")))
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .font(.system(size: 15))
                    .foregroundColor(Color(hex: "#1e1b4b"))
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#e5e7eb"), lineWidth: 1))

            // Password
            HStack(spacing: 12) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 14)).foregroundColor(Color(hex: "#9ca3af"))
                Group {
                    if showPw {
                        TextField("", text: $password,
                                  prompt: Text("Password").foregroundColor(Color(hex: "#9ca3af")))
                    } else {
                        SecureField("", text: $password,
                                    prompt: Text("Password").foregroundColor(Color(hex: "#9ca3af")))
                    }
                }
                .font(.system(size: 15))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .onSubmit { Task { await handleEmailSignIn() } }
                Button { showPw.toggle(); hapticLight() } label: {
                    Image(systemName: showPw ? "eye.slash" : "eye")
                        .font(.system(size: 14))
                        .foregroundColor(Color(hex: "#9ca3af"))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#e5e7eb"), lineWidth: 1))

            // Remember + Forgot
            HStack {
                Button { remember.toggle(); hapticLight() } label: {
                    HStack(spacing: 8) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 5)
                                .fill(remember ? Color(hex: "#6366f1") : Color.white)
                                .frame(width: 18, height: 18)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 5)
                                        .stroke(remember ? Color(hex: "#6366f1") : Color(hex: "#d1d5db"),
                                                lineWidth: 1.5)
                                )
                            if remember {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.white)
                            }
                        }
                        Text("จดจำฉัน")
                            .font(.system(size: 13))
                            .foregroundColor(Color(hex: "#6b7280"))
                    }
                }
                Spacer()
                Button("ลืมรหัสผ่าน?") {}
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Color(hex: "#6366f1"))
            }

            // Sign-in button — frame(maxWidth:.infinity) on Button directly
            Button { Task { await handleEmailSignIn() } } label: {
                ZStack {
                    if isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("เข้าสู่ระบบ")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
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
            .disabled(busy)
            .opacity(busy ? 0.7 : 1)
            .scaleEffect(busy ? 0.98 : 1)
            .animation(.spring(response: 0.2), value: busy)

            // Register link
            HStack(spacing: 4) {
                Text("ยังไม่มีบัญชี?")
                    .font(.system(size: 13)).foregroundColor(Color(hex: "#9ca3af"))
                Button("สมัครสมาชิก") { showSignUp = true }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
            .padding(.top, 4)
        }
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 16)
    }

    // MARK: – Actions
    private func handleEmailSignIn() async {
        guard !email.isEmpty, !password.isEmpty else {
            withAnimation { localError = "กรุณากรอกอีเมลและรหัสผ่าน" }
            hapticError(); return
        }
        localError = nil; isLoading = true; hapticLight()
        await authVM.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        if let err = authVM.error {
            withAnimation {
                localError = err.contains("Invalid login credentials") ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
                           : err.contains("Email not confirmed")       ? "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ"
                           : err
            }
            authVM.error = nil; hapticError()
        }
        isLoading = false
    }

    private func runNative(_ key: String, action: () async -> Void) async {
        oauthKey = key; localError = nil; authVM.error = nil; hapticLight()
        await action()
        if let err = authVM.error {
            withAnimation { localError = err }
            authVM.error = nil; hapticError()
        }
        oauthKey = nil
    }
}

private func hapticError() { UINotificationFeedbackGenerator().notificationOccurred(.error) }

#if DEBUG
#Preview { LoginView().environmentObject(AuthViewModel(_preview: true)) }
#endif
