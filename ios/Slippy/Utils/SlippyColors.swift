import SwiftUI

extension Color {
    // MARK: – Brand (Indigo) — matches web brand-* CSS vars
    static let brand50  = Color(hex: "#eef2ff")
    static let brand100 = Color(hex: "#e0e7ff")
    static let brand300 = Color(hex: "#a5b4fc")
    static let brand400 = Color(hex: "#818cf8")
    static let brand500 = Color(hex: "#6366f1")
    static let brand600 = Color(hex: "#4f46e5")
    static let brand700 = Color(hex: "#4338ca")
    static let brand900 = Color(hex: "#312e81")

    // MARK: – Document status colours
    static let statusPending    = Color(hex: "#94a3b8")
    static let statusProcessing = Color(hex: "#3b82f6")
    static let statusReviewing  = Color(hex: "#f59e0b")
    static let statusApproved   = Color(hex: "#10b981")
    static let statusPushed     = Color(hex: "#8b5cf6")
    static let statusFailed     = Color(hex: "#ef4444")

    // MARK: – Adaptive surfaces (light / dark)
    /// White in light mode, ~#1e2030 in dark mode
    static let surface = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#1e2030")
            : .white
    })
    /// ~#f4f4f6 light / #14161f dark
    static let surfaceMuted = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#14161f")
            : UIColor(hex: "#f4f4f6")
    })
    /// Input background
    static let inputBg = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#1a1d2e")
            : UIColor(hex: "#f9fafb")
    })
    /// Border
    static let border = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#2d3150")
            : UIColor(hex: "#e5e7eb")
    })
    /// Primary text
    static let textPrimary = Color(UIColor { t in
        t.userInterfaceStyle == .dark ? .white : UIColor(hex: "#111827")
    })
    /// Secondary / muted text
    static let textSecondary = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#9ca3af")
            : UIColor(hex: "#6b7280")
    })
    /// Screen background — ~#f8f9fc light / #0a0d1a dark (matches web --background)
    static let background = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(hex: "#0a0d1a")
            : UIColor(hex: "#f8f9fc")
    })
    /// Text colour for content drawn on top of a selected/brand-filled chip
    static let textOnBrand = Color(UIColor { t in
        t.userInterfaceStyle == .dark ? .white : UIColor(hex: "#111827")
    })

    // MARK: – Hex initialiser (SwiftUI Color)
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB,
                  red:     Double(r) / 255,
                  green:   Double(g) / 255,
                  blue:    Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}

// MARK: – UIColor hex convenience (for adaptive colour blocks)
extension UIColor {
    convenience init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6: (r, g, b) = (int >> 16, int >> 8 & 0xFF, int & 0xFF)
        default: (r, g, b) = (0, 0, 0)
        }
        self.init(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
    }
}

// MARK: – Status colour helper
func statusColor(for status: String) -> Color {
    switch status {
    case "pushed":     return .statusPushed
    case "approved":   return .statusApproved
    case "reviewing":  return .statusReviewing
    case "processing": return .statusProcessing
    case "failed":     return .statusFailed
    case "rejected":   return .statusFailed
    default:           return .statusPending
    }
}
