import SwiftUI

extension Color {
    // MARK: – Brand (Indigo)
    static let brand50  = adaptive(light: "#eef2ff", dark: "#24263b")
    static let brand100 = adaptive(light: "#e0e7ff", dark: "#30334b")
    static let brand300 = Color(hex: "#a5b4fc")
    static let brand400 = Color(hex: "#818cf8")
    static let brand500 = Color(hex: "#5b5ee5")
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

    // MARK: – Shared adaptive appearance
    static let background = adaptive(light: "#f7f8fa", dark: "#101217")
    static let surface = adaptive(light: "#ffffff", dark: "#1b1e25")
    static let surfaceMuted = adaptive(light: "#eef0f4", dark: "#242831")
    static let inputBg = adaptive(light: "#f2f4f7", dark: "#22262e")
    static let border = adaptive(light: "#d8dde5", dark: "#3b414d")
    static let textPrimary = adaptive(light: "#18212e", dark: "#f3f5f8")
    static let textSecondary = adaptive(light: "#596475", dark: "#b2bac8")
    static let textTertiary = adaptive(light: "#667085", dark: "#a1aabb")
    static let accent = adaptive(light: "#4f46e5", dark: "#a5b4fc")
    static let textOnBrand = Color.white
    static let successSurface = adaptive(light: "#eaf7f0", dark: "#17352a")
    static let warningSurface = adaptive(light: "#fff5df", dark: "#382d19")
    static let errorSurface = adaptive(light: "#fff0f1", dark: "#3b2027")
    static let infoSurface = adaptive(light: "#eaf2ff", dark: "#1c2c43")
    static let successText = adaptive(light: "#047857", dark: "#6ee7b7")
    static let warningText = adaptive(light: "#8a5b00", dark: "#fcd34d")
    static let errorText = adaptive(light: "#b91c1c", dark: "#fca5a5")
    static let infoText = adaptive(light: "#1d4ed8", dark: "#93c5fd")

    static func adaptive(light: String, dark: String) -> Color {
        Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }

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
