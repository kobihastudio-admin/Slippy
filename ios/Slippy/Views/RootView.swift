import SwiftUI

struct RootView: View {
    @EnvironmentObject var authVM: AuthViewModel

    var body: some View {
        Group {
            if authVM.isLoading {
                SplashView()
            } else if authVM.session != nil && authVM.pendingMfaFactorId != nil {
                MfaChallengeView()
            } else if authVM.isSignedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: authVM.isSignedIn)
    }
}

private struct CosmicLandscape: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .bottom) {
                // Far hill (lighter)
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * 0.55))
                    p.addCurve(to: CGPoint(x: w, y: h * 0.62),
                               control1: CGPoint(x: w * 0.3, y: h * 0.3),
                               control2: CGPoint(x: w * 0.7, y: h * 0.72))
                    p.addLine(to: CGPoint(x: w, y: h))
                    p.addLine(to: CGPoint(x: 0, y: h))
                }
                .fill(Color(hex: "#2d1b69").opacity(0.6))

                // Near hill (darker)
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * 0.72))
                    p.addCurve(to: CGPoint(x: w, y: h * 0.78),
                               control1: CGPoint(x: w * 0.25, y: h * 0.5),
                               control2: CGPoint(x: w * 0.75, y: h * 0.9))
                    p.addLine(to: CGPoint(x: w, y: h))
                    p.addLine(to: CGPoint(x: 0, y: h))
                }
                .fill(Color(hex: "#1a0b3b").opacity(0.9))
            }
        }
        .frame(height: 200)
    }
}

#if DEBUG
#Preview("Splash") {
    let vm = AuthViewModel(_preview: true)
    return RootView().environmentObject(vm)
}

#Preview("Login") {
    let vm = AuthViewModel(_preview: true)
    vm.isLoading = false
    return RootView().environmentObject(vm)
}
#endif

// MARK: – Splash / Launch Screen
private struct SplashView: View {
    @State private var appeared    = false
    @State private var pulse       = false
    @State private var progress: CGFloat = 0
    @State private var progressPct = 0

    private let progressTimer = Timer.publish(every: 0.04, on: .main, in: .common).autoconnect()

    private struct Star: Identifiable {
        let id: Int; let x, y, opacity, size: CGFloat
    }
    private let stars: [Star] = (0..<50).map { i in
        Star(id: i,
             x: CGFloat.random(in: -1...1),
             y: CGFloat.random(in: -1...0.4),
             opacity: CGFloat.random(in: 0.2...0.9),
             size: CGFloat.random(in: 1...2.5))
    }

    private func featureIcon(_ sys: String, _ label: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: sys)
                .font(.system(size: 18))
                .foregroundColor(Color(hex: "#a78bfa"))
                .frame(width: 44, height: 44)
                .background(Color.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(Color(hex: "#94a3b8"))
        }
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                // ── Deep space background ──────────────────────────────
                LinearGradient(
                    colors: [Color(hex: "#0d0720"), Color(hex: "#1a0b3b"), Color(hex: "#0f0527")],
                    startPoint: .top, endPoint: .bottom
                ).ignoresSafeArea()

                // Glow blobs
                Circle().fill(Color(hex: "#7c3aed").opacity(0.22))
                    .frame(width: 340).blur(radius: 90)
                    .offset(x: -60, y: -geo.size.height * 0.22)
                Circle().fill(Color(hex: "#4f46e5").opacity(0.15))
                    .frame(width: 260).blur(radius: 80)
                    .offset(x: 100, y: geo.size.height * 0.1)

                // Stars
                ForEach(stars, id: \.id) { s in
                    Circle().fill(Color.white.opacity(s.opacity))
                        .frame(width: s.size, height: s.size)
                        .offset(x: s.x * geo.size.width * 0.5,
                                y: s.y * geo.size.height * 0.5)
                }

                // ── Cosmic landscape at bottom ─────────────────────────
                CosmicLandscape()
                    .ignoresSafeArea(edges: .bottom)

                // ── Main content ──────────────────────────────────────
                VStack(spacing: 0) {
                    Spacer()

                    // Logo + pulse rings
                    ZStack {
                        Circle()
                            .stroke(Color(hex: "#a78bfa").opacity(pulse ? 0 : 0.35), lineWidth: 1.5)
                            .frame(width: 130, height: 130)
                            .scaleEffect(pulse ? 1.8 : 1)
                            .animation(.easeOut(duration: 1.8).repeatForever(autoreverses: false), value: pulse)
                        Circle()
                            .stroke(Color(hex: "#a78bfa").opacity(pulse ? 0 : 0.18), lineWidth: 1)
                            .frame(width: 130, height: 130)
                            .scaleEffect(pulse ? 2.4 : 1.3)
                            .animation(.easeOut(duration: 1.8).delay(0.4).repeatForever(autoreverses: false), value: pulse)

                        SlippyLogoMark(size: 100, glow: true)
                            .scaleEffect(appeared ? 1 : 0.5)
                            .opacity(appeared ? 1 : 0)
                    }
                    .frame(width: 180, height: 180)

                    Spacer().frame(height: 20)

                    // Title + tagline
                    Text("Slippy")
                        .font(.system(size: 38, weight: .black, design: .rounded))
                        .foregroundStyle(
                            LinearGradient(colors: [.white, Color(hex: "#c4b5fd")],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 12)

                    Spacer().frame(height: 6)

                    Text("Your AI Life Assistant")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color(hex: "#a78bfa"))
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 8)

                    Spacer().frame(height: 32)

                    // Feature icons row
                    HStack(spacing: 20) {
                        featureIcon("doc.text.fill",   "สลิป")
                        featureIcon("calendar",        "นัดหมาย")
                        featureIcon("person.2.fill",   "ทีม")
                        featureIcon("heart.fill",      "สุขภาพ")
                        featureIcon("figure.run",      "กีฬา")
                    }
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 10)

                    Spacer().frame(height: 36)

                    // Loading text + progress bar
                    VStack(spacing: 12) {
                        Text("กำลังเตรียมทุกอย่างให้พร้อม...")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(Color(hex: "#94a3b8"))

                        GeometryReader { bar in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white.opacity(0.12))
                                    .frame(height: 6)
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(LinearGradient(
                                        colors: [Color(hex: "#a78bfa"), Color(hex: "#6366f1")],
                                        startPoint: .leading, endPoint: .trailing
                                    ))
                                    .frame(width: bar.size.width * progress, height: 6)
                                    .animation(.easeInOut(duration: 0.3), value: progress)
                            }
                        }
                        .frame(height: 6)

                        Text("\(progressPct)%")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(hex: "#7c72f5"))
                    }
                    .padding(.horizontal, 40)
                    .opacity(appeared ? 1 : 0)

                    Spacer().frame(height: 120)
                }
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.7, dampingFraction: 0.75).delay(0.1)) { appeared = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { pulse = true }
        }
        .onReceive(progressTimer) { _ in
            if progressPct < 100 {
                progressPct = min(100, progressPct + 1)
                progress = CGFloat(progressPct) / 100
            }
        }
    }
}
