import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// SlippyLoadingView — full-screen branded loading overlay
// ─────────────────────────────────────────────────────────────────────────────

/// Full-page loading screen with Slippy logo + pulse ring.
/// Drop-in replacement for `ProgressView()` in any page-level loading state.
struct SlippyLoadingView: View {
    var message: String? = nil
    @State private var pulse = false
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color(hex: "#07091a").ignoresSafeArea()

            VStack(spacing: 24) {
                ZStack {
                    // Outer pulse ring
                    Circle()
                        .stroke(Color.brand500.opacity(pulse ? 0 : 0.35), lineWidth: 1.5)
                        .frame(width: 108, height: 108)
                        .scaleEffect(pulse ? 1.55 : 1)
                        .animation(
                            .easeOut(duration: 1.4).repeatForever(autoreverses: false),
                            value: pulse
                        )

                    // Inner pulse ring
                    Circle()
                        .stroke(Color.brand500.opacity(pulse ? 0 : 0.2), lineWidth: 1)
                        .frame(width: 108, height: 108)
                        .scaleEffect(pulse ? 1.9 : 1.2)
                        .animation(
                            .easeOut(duration: 1.4).delay(0.3).repeatForever(autoreverses: false),
                            value: pulse
                        )

                    SlippyLogoMark(size: 68, glow: true)
                        .scaleEffect(appeared ? 1 : 0.7)
                        .opacity(appeared ? 1 : 0)
                }

                if let msg = message {
                    Text(msg)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color(hex: "#94a3b8"))
                        .opacity(appeared ? 1 : 0)
                }
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                appeared = true
            }
            pulse = true
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SlippyLoadingOverlay — semi-transparent overlay for in-place loading
// (e.g. pull-to-refresh, uploading)
// ─────────────────────────────────────────────────────────────────────────────

struct SlippyLoadingOverlay: View {
    var message: String? = nil
    @State private var pulse = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .background(.ultraThinMaterial)

            VStack(spacing: 18) {
                ZStack {
                    Circle()
                        .stroke(Color.brand500.opacity(pulse ? 0 : 0.4), lineWidth: 1.5)
                        .frame(width: 80, height: 80)
                        .scaleEffect(pulse ? 1.5 : 1)
                        .animation(
                            .easeOut(duration: 1.2).repeatForever(autoreverses: false),
                            value: pulse
                        )

                    SlippyLogoMark(size: 52, glow: false)
                }

                if let msg = message {
                    Text(msg)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.85))
                }
            }
            .padding(28)
            .background(Color(hex: "#111827").opacity(0.92))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.4), radius: 30)
        }
        .onAppear { pulse = true }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// View modifier — .slippyLoading(isLoading)
// Overlays SlippyLoadingOverlay on any view when loading is true
// ─────────────────────────────────────────────────────────────────────────────

extension View {
    func slippyLoading(_ isLoading: Bool, message: String? = nil) -> some View {
        self.overlay {
            if isLoading {
                SlippyLoadingOverlay(message: message)
                    .transition(.opacity.animation(.easeInOut(duration: 0.2)))
            }
        }
    }
}

#if DEBUG
#Preview("Full page") {
    SlippyLoadingView(message: "กำลังโหลดข้อมูล...")
}

#Preview("Overlay") {
    ZStack {
        Color(hex: "#07091a").ignoresSafeArea()
        Text("Content behind").foregroundColor(.white)
        SlippyLoadingOverlay(message: "กำลังอัพโหลด...")
    }
}
#endif
