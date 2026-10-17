import SwiftUI
import Combine

/// Manages app-wide display mode (light / system / dark)
/// Persisted in UserDefaults so preference survives restarts.
final class AppSettings: ObservableObject {

    enum DisplayMode: String, CaseIterable {
        case light  = "light"
        case system = "system"
        case dark   = "dark"

        /// SF Symbol matching the web's outline icon set (sun / monitor / moon)
        var symbol: String {
            switch self {
            case .light:  return "sun.max"
            case .system: return "display"
            case .dark:   return "moon.fill"
            }
        }

        var colorScheme: ColorScheme? {
            switch self {
            case .light:  return .light
            case .dark:   return .dark
            case .system: return nil
            }
        }

        var label: String {
            switch self {
            case .light: return "สว่าง"
            case .system: return "ตามระบบ"
            case .dark: return "มืด"
            }
        }
    }

    static let shared = AppSettings()

    @Published var displayMode: DisplayMode {
        didSet { UserDefaults.standard.set(displayMode.rawValue, forKey: "displayMode") }
    }

    private init() {
        let saved = UserDefaults.standard.string(forKey: "displayMode") ?? "system"
        displayMode = DisplayMode(rawValue: saved) ?? .system
    }
}

/// Persisted appearance selection, using the shared palette in either mode.
struct ThemePicker: View {
    @ObservedObject var settings = AppSettings.shared

    private let trackBg = Color.surfaceMuted
    private let chipBg = Color.brand600
    private let mutedIcon = Color.textSecondary

    var body: some View {
        HStack(spacing: 2) {
            ForEach(AppSettings.DisplayMode.allCases, id: \.self) { mode in
                let selected = settings.displayMode == mode
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        settings.displayMode = mode
                    }
                } label: {
                    Image(systemName: mode.symbol)
                        .font(.system(size: 13, weight: selected ? .semibold : .regular))
                        .foregroundColor(selected ? .white : mutedIcon)
                        .frame(width: 44, height: 44)
                        .background(
                            selected
                                ? RoundedRectangle(cornerRadius: 8).fill(chipBg)
                                : RoundedRectangle(cornerRadius: 8).fill(Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(mode.label)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .padding(3)
        .background(trackBg)
        .clipShape(RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11)
            .stroke(Color.border, lineWidth: 1))
    }
}

#if DEBUG
#Preview {
    ZStack {
        Color.background.ignoresSafeArea()
        ThemePicker()
    }
}
#endif
