import SwiftUI

/// Slippy brand logo mark — pixel-perfect match to slippy_logo.svg
/// Circle background with purple→indigo→pink gradient + receipt ghost mascot.
struct SlippyLogoMark: View {
    var size: CGFloat = 48
    var glow: Bool = false

    var body: some View {
        ZStack {
            if glow {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color(hex: "#8b5cf6").opacity(0.5), .clear],
                            center: .center, startRadius: 0, endRadius: size * 0.9
                        )
                    )
                    .frame(width: size * 1.9, height: size * 1.9)
                    .blur(radius: size * 0.22)
            }

            Image("SlippyLogo")
                .resizable()
                .interpolation(.high)
                .antialiased(true)
                .frame(width: size, height: size)
        }
    }
}

// MARK: – Convenience alias

struct SlippyLogoImage: View {
    var size: CGFloat = 48
    var body: some View { SlippyLogoMark(size: size) }
}

#if DEBUG
#Preview("Logo sizes") {
    ZStack {
        LinearGradient(colors: [Color(hex: "#070a18"), Color(hex: "#0f1235")],
                       startPoint: .top, endPoint: .bottom).ignoresSafeArea()
        VStack(spacing: 28) {
            SlippyLogoMark(size: 100, glow: true)

            HStack(spacing: 20) {
                SlippyLogoMark(size: 36)
                SlippyLogoMark(size: 56)
                SlippyLogoMark(size: 80)
            }

            Text("Slippy")
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundStyle(
                    LinearGradient(colors: [.white, Color(hex: "#c4b5fd")],
                                   startPoint: .leading, endPoint: .trailing)
                )
        }
    }
}
#endif
