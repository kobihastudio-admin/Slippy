import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Brand login icons — SwiftUI re-creations of the exact SVG paths used on the
// web (`web/src/components/auth/login-form.tsx` → SvgGoogle / SvgFacebook / SvgLine).
// All paths are defined in a 24×24 viewBox and scaled via Canvas.
// ─────────────────────────────────────────────────────────────────────────────

/// Google "G" mark — 4-colour logo, pixel-matched to web SvgGoogle viewBox 24×24
struct GoogleLogo: View {
    var size: CGFloat = 18
    var body: some View {
        Canvas { ctx, canvasSize in
            let s = canvasSize.width / 24.0
            func P(_ x: Double, _ y: Double) -> CGPoint { .init(x: x * s, y: y * s) }

            var blue = Path()
            blue.move(to: P(22.56, 12.25))
            blue.addCurve(to: P(22.36, 10), control1: P(22.56, 11.47), control2: P(22.49, 10.72))
            blue.addLine(to: P(12, 10))
            blue.addLine(to: P(12, 14.26))
            blue.addLine(to: P(17.92, 14.26))
            blue.addCurve(to: P(15.72, 17.58), control1: P(17.66, 15.63), control2: P(16.89, 16.79))
            blue.addLine(to: P(15.72, 20.35))
            blue.addCurve(to: P(22.56, 12.25), control1: P(19.86, 18.49), control2: P(22.56, 15.72))
            blue.closeSubpath()
            ctx.fill(blue, with: .color(Color(hex: "#4285F4")))

            var green = Path()
            green.move(to: P(12, 23))
            green.addCurve(to: P(19.28, 20.34), control1: P(14.97, 23), control2: P(17.46, 22.02))
            green.addLine(to: P(15.72, 17.57))
            green.addCurve(to: P(12, 18.62), control1: P(14.73, 18.23), control2: P(13.46, 18.62))
            green.addCurve(to: P(5.84, 14.09), control1: P(9.14, 18.62), control2: P(6.71, 16.68))
            green.addLine(to: P(2.18, 16.93))
            green.addCurve(to: P(12, 23), control1: P(3.66, 19.92), control2: P(6.71, 23))
            green.closeSubpath()
            ctx.fill(green, with: .color(Color(hex: "#34A853")))

            var yellow = Path()
            yellow.move(to: P(5.84, 14.09))
            yellow.addCurve(to: P(5.84, 9.91), control1: P(5.62, 13.43), control2: P(5.62, 10.57))
            yellow.addLine(to: P(2.18, 7.07))
            yellow.addCurve(to: P(2.18, 16.93), control1: P(0.86, 9.72), control2: P(0.86, 14.28))
            yellow.addLine(to: P(5.84, 14.09))
            yellow.closeSubpath()
            ctx.fill(yellow, with: .color(Color(hex: "#FBBC05")))

            var red = Path()
            red.move(to: P(12, 5.38))
            red.addCurve(to: P(16.21, 7.02), control1: P(13.62, 5.38), control2: P(15.06, 5.94))
            red.addLine(to: P(19.36, 3.87))
            red.addCurve(to: P(12, 1), control1: P(17.45, 2.09), control2: P(14.97, 1))
            red.addCurve(to: P(2.18, 7.07), control1: P(7.7, 1), control2: P(3.99, 3.47))
            red.addLine(to: P(5.84, 9.91))
            red.addCurve(to: P(12, 5.38), control1: P(6.71, 7.32), control2: P(9.14, 5.38))
            red.closeSubpath()
            ctx.fill(red, with: .color(Color(hex: "#EA4335")))
        }
        .frame(width: size, height: size)
    }
}

/// Facebook "f" — white bold letter on the button's blue background
struct FacebookLogo: View {
    var size: CGFloat = 18
    var body: some View {
        Text("f")
            .font(.system(size: size * 1.15, weight: .bold, design: .default))
            .foregroundColor(.white)
            .frame(width: size, height: size)
            .offset(y: -size * 0.04)
    }
}

/// LINE speech-bubble mark — green rounded square with white "LINE" text
struct LineLogo: View {
    var size: CGFloat = 18
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24)
                .fill(Color.white)
                .frame(width: size, height: size)
            Text("LINE")
                .font(.system(size: size * 0.30, weight: .bold, design: .default))
                .foregroundColor(Color(hex: "#06C755"))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
        }
        .frame(width: size, height: size)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature icons — polished, glossy home-screen tiles ("ฟีเจอร์หลัก").
// Replaces the flat SF-Symbol-on-plain-square look with the layered, gradient,
// soft-3D style from the Slippy reference mockup: a two-tone pastel tile, a
// glossy top highlight, a gradient-filled glyph with a little lift shadow, a
// soft coloured drop shadow, and an optional corner "sticker" badge.
// The app logo (SlippyLogoMark) is intentionally left untouched.
// ─────────────────────────────────────────────────────────────────────────────

/// Every distinct home-screen feature icon. Adding a feature = add a case here
/// and a matching entry in `spec`.
enum FeatureIconKind: CaseIterable {
    case expenses   // จัดการรายจ่าย
    case split      // หารบิล
    case sports     // นัดหมายกีฬา
    case trip       // ทริป
    case health     // สุขภาพและยา
    case tasks      // ภารกิจ & แพลน
    case chat       // แชทกับเพื่อน / Slippy
    case more       // เพิ่มเติม
}

/// Visual recipe for one icon: the SF Symbol, the tile's pastel gradient, the
/// glyph's saturated gradient, and an optional accent sticker badge.
struct FeatureIconSpec {
    let symbol: String
    let tile: [Color]           // background gradient (top-leading → bottom-trailing)
    let glyph: [Color]          // symbol fill gradient (top → bottom)
    var badge: (symbol: String, color: Color)? = nil
}

extension FeatureIconKind {
    var spec: FeatureIconSpec {
        switch self {
        case .expenses:
            return .init(symbol: "doc.text.fill",
                         tile:  [Color(hex: "#f1ecff"), Color(hex: "#ddd0ff")],
                         glyph: [Color(hex: "#9b7bff"), Color(hex: "#6d28d9")])
        case .split:
            return .init(symbol: "person.2.fill",
                         tile:  [Color(hex: "#ffe6f2"), Color(hex: "#ffc7e0")],
                         glyph: [Color(hex: "#f472b6"), Color(hex: "#be185d")])
        case .sports:
            return .init(symbol: "calendar",
                         tile:  [Color(hex: "#dcfce7"), Color(hex: "#b6f2c9")],
                         glyph: [Color(hex: "#34d399"), Color(hex: "#15803d")],
                         badge: (symbol: "tennisball.fill", color: Color(hex: "#eab308")))
        case .trip:
            return .init(symbol: "airplane",
                         tile:  [Color(hex: "#dcebff"), Color(hex: "#bcd7ff")],
                         glyph: [Color(hex: "#60a5fa"), Color(hex: "#1d4ed8")])
        case .health:
            return .init(symbol: "heart.fill",
                         tile:  [Color(hex: "#ffe4e8"), Color(hex: "#fecdd4")],
                         glyph: [Color(hex: "#fb7185"), Color(hex: "#e11d48")],
                         badge: (symbol: "cross.fill", color: Color(hex: "#f43f5e")))
        case .tasks:
            return .init(symbol: "checklist",
                         tile:  [Color(hex: "#fff0dc"), Color(hex: "#ffd8a8")],
                         glyph: [Color(hex: "#fb923c"), Color(hex: "#ea580c")])
        case .chat:
            return .init(symbol: "ellipsis.bubble.fill",
                         tile:  [Color(hex: "#eae7ff"), Color(hex: "#d6d0ff")],
                         glyph: [Color(hex: "#818cf8"), Color(hex: "#4f46e5")])
        case .more:
            return .init(symbol: "square.grid.2x2.fill",
                         tile:  [Color(hex: "#efeaff"), Color(hex: "#ddd6fe")],
                         glyph: [Color(hex: "#a78bfa"), Color(hex: "#7c3aed")])
        }
    }
}

/// A single glossy feature tile. Draw at any `size`; all metrics scale from it.
struct FeatureIcon: View {
    let kind: FeatureIconKind
    var size: CGFloat = 56

    private var spec: FeatureIconSpec { kind.spec }
    private var corner: CGFloat { size * 0.30 }

    var body: some View {
        ZStack {
            tile
            glyph
            if let badge = spec.badge { self.badge(badge) }
        }
        .frame(width: size, height: size)
    }

    // Pastel gradient background + glossy top highlight + hairline rim.
    private var tile: some View {
        RoundedRectangle(cornerRadius: corner, style: .continuous)
            .fill(LinearGradient(colors: spec.tile,
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(LinearGradient(colors: [Color.white.opacity(0.55), .clear],
                                         startPoint: .top, endPoint: .center))
                    .padding(1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.6), lineWidth: 0.8)
            )
            .shadow(color: spec.glyph.last?.opacity(0.22) ?? .clear,
                    radius: size * 0.16, x: 0, y: size * 0.10)
    }

    // Gradient-filled glyph with a subtle lift shadow.
    private var glyph: some View {
        Image(systemName: spec.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(LinearGradient(colors: spec.glyph,
                                            startPoint: .top, endPoint: .bottom))
            .shadow(color: (spec.glyph.last ?? .clear).opacity(0.30),
                    radius: 0.8, x: 0, y: size * 0.02)
    }

    // Corner "sticker" — small white-ringed accent circle (e.g. tennis ball).
    private func badge(_ badge: (symbol: String, color: Color)) -> some View {
        let symbol: String = badge.symbol
        let color: Color = badge.color
        let dot = Image(systemName: symbol)
            .font(.system(size: size * 0.19, weight: .bold))
            .foregroundColor(Color.white)
            .padding(size * 0.055)
            .background(Circle().fill(color))
            .overlay(Circle().strokeBorder(Color.white, lineWidth: size * 0.028))
            .shadow(color: color.opacity(0.4), radius: size * 0.04, x: 0, y: size * 0.02)
        return dot
            .frame(width: size, height: size, alignment: .bottomTrailing)
            .offset(x: size * 0.06, y: size * 0.06)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Category icons — glossy circular avatars for transaction/document rows
// ("รายการล่าสุด"). Replaces the flat emoji-in-tinted-circle with a saturated
// per-category gradient disc + white glyph, matching the reference mockup's
// recent-list style (green cutlery for food, purple cart for shopping, …).
// ─────────────────────────────────────────────────────────────────────────────

/// Look/feel of one category: a glyph + a [mid, deep] gradient pair.
struct CategoryStyle {
    let symbol: String
    let colors: [Color]
}

/// The single source of truth for Slippy's expense categories. It powers BOTH
/// the recent-list icons AND the category-picker suggestions in
/// DocumentDetailView — so the list stays complete (covers everything Slippy
/// does) and whatever the user picks always maps to the right icon.
///
/// `keywords` are lowercased EN+TH fragments matched as substrings against the
/// raw category (tolerant of "food & beverage", "coffee shop",
/// "อาหาร & เครื่องดื่ม"). Order matters — earlier entries win, so keep the more
/// specific ones ahead of the broad ones, and `.other` last.
struct SlippyCategory: Identifiable {
    let id: String
    let label: String          // Thai label shown in the picker
    let symbol: String
    let colors: [Color]        // [mid, deep] disc gradient
    let keywords: [String]

    var style: CategoryStyle { CategoryStyle(symbol: symbol, colors: colors) }

    private static func c(_ a: String, _ b: String) -> [Color] { [Color(hex: a), Color(hex: b)] }

    static let all: [SlippyCategory] = [
        .init(id: "food",          label: "อาหาร & เครื่องดื่ม", symbol: "fork.knife",   colors: c("#34d399", "#15803d"),
              keywords: ["food", "restaurant", "cafe", "coffee", "dining", "beverage", "drink", "grocery",
                         "อาหาร", "เครื่องดื่ม", "กาแฟ", "ร้านอาหาร", "ของกิน"]),
        .init(id: "health",        label: "สุขภาพ & ยา",        symbol: "cross.case.fill", colors: c("#fb7185", "#e11d48"),
              keywords: ["health", "medical", "pharmac", "hospital", "clinic", "medicine", "dental",
                         "สุขภาพ", "ยา", "โรงพยาบาล", "คลินิก", "หมอ"]),
        .init(id: "sports",        label: "กีฬา & ออกกำลังกาย",  symbol: "sportscourt.fill", colors: c("#84cc16", "#4d7c0f"),
              keywords: ["sport", "fitness", "gym", "exercise", "workout", "football", "stadium",
                         "กีฬา", "ออกกำลังกาย", "ฟิตเนส", "ยิม", "ฟุตบอล", "สนาม"]),
        .init(id: "fuel",          label: "น้ำมัน & พลังงาน",    symbol: "fuelpump.fill", colors: c("#fb923c", "#c2410c"),
              keywords: ["fuel", "petrol", "gasoline", "gas station", "energy",
                         "น้ำมัน", "พลังงาน", "ปั๊ม", "ปตท"]),
        .init(id: "travel",        label: "ท่องเที่ยว & ทริป",    symbol: "airplane",     colors: c("#22d3ee", "#0891b2"),
              keywords: ["travel", "trip", "flight", "airline", "hotel", "resort", "tour",
                         "ท่องเที่ยว", "ทริป", "โรงแรม", "ตั๋วเครื่องบิน", "ที่พัก"]),
        .init(id: "transport",     label: "การเดินทาง",         symbol: "car.fill",      colors: c("#60a5fa", "#1d4ed8"),
              keywords: ["transport", "taxi", "grab", "train", "bus", "ride", "parking", "toll", "mrt", "bts",
                         "การเดินทาง", "เดินทาง", "แท็กซี่", "รถไฟ", "ที่จอดรถ", "ทางด่วน"]),
        .init(id: "utilities",     label: "สาธารณูปโภค",        symbol: "lightbulb.fill", colors: c("#fbbf24", "#d97706"),
              keywords: ["utilit", "electric", "water bill", "water supply",
                         "สาธารณูปโภค", "ไฟฟ้า", "น้ำประปา", "ค่าน้ำ", "ค่าไฟ"]),
        .init(id: "telecom",       label: "โทรคมนาคม & เน็ต",    symbol: "antenna.radiowaves.left.and.right", colors: c("#818cf8", "#4f46e5"),
              keywords: ["telecom", "mobile", "internet", "wifi", "network", "phone bill", "data plan",
                         "โทรคมนาคม", "มือถือ", "อินเทอร์เน็ต", "เน็ต", "ค่าโทร"]),
        .init(id: "software",      label: "ซอฟต์แวร์ & คลาวด์",  symbol: "cloud.fill",    colors: c("#38bdf8", "#0369a1"),
              keywords: ["software", "cloud", "saas", "subscription", "hosting", "server",
                         "ซอฟต์แวร์", "คลาวด์", "สมัครสมาชิก"]),
        .init(id: "tech",          label: "อุปกรณ์ & เทคโนโลยี", symbol: "laptopcomputer", colors: c("#2dd4bf", "#0f766e"),
              keywords: ["tech", "electronic", "gadget", "hardware", "computer", "device",
                         "อุปกรณ์", "ไอที", "คอมพิวเตอร์", "เครื่องใช้ไฟฟ้า"]),
        .init(id: "banking",       label: "ธนาคาร & การเงิน",    symbol: "building.columns.fill", colors: c("#10b981", "#065f46"),
              keywords: ["banking", "bank", "atm", "transfer", "deposit", "withdraw", "loan", "interest",
                         "credit card", "debit", "finance", "ค่าธรรมเนียม",
                         "ธนาคาร", "การเงิน", "โอนเงิน", "เงินฝาก", "ถอนเงิน", "บัตรเครดิต", "เงินกู้"]),
        .init(id: "retail",        label: "ช้อปปิ้ง & ค้าปลีก",  symbol: "cart.fill",     colors: c("#a78bfa", "#7c3aed"),
              keywords: ["retail", "shopping", "store", "supermarket", "mart", "mall", "convenience",
                         "ค้าปลีก", "ช้อป", "ห้าง", "ซุปเปอร์", "ร้านค้า"]),
        .init(id: "entertainment", label: "บันเทิง",            symbol: "gamecontroller.fill", colors: c("#f472b6", "#be185d"),
              keywords: ["entertain", "movie", "game", "cinema", "music", "streaming", "concert",
                         "บันเทิง", "หนัง", "เกม", "ดูหนัง", "คอนเสิร์ต"]),
        .init(id: "education",     label: "การศึกษา",           symbol: "book.fill",     colors: c("#6366f1", "#3730a3"),
              keywords: ["education", "school", "course", "tuition", "learning", "textbook", "seminar",
                         "การศึกษา", "เรียน", "คอร์ส", "ค่าเทอม", "สัมมนา"]),
        .init(id: "personal",      label: "ส่วนตัว & ความงาม",    symbol: "sparkles",      colors: c("#e879f9", "#a21caf"),
              keywords: ["personal", "beauty", "salon", "cosmetic", "haircut", "spa", "skincare",
                         "ความงาม", "ส่วนตัว", "เสริมสวย", "ตัดผม", "สปา"]),
        .init(id: "housing",       label: "ที่พักอาศัย & ค่าเช่า", symbol: "house.fill",   colors: c("#f59e0b", "#92400e"),
              keywords: ["housing", "rental", "mortgage", "condo", "home", "apartment",
                         "ค่าเช่า", "บ้าน", "คอนโด", "ผ่อนบ้าน", "หอพัก"]),
        .init(id: "insurance",     label: "ประกันภัย",          symbol: "shield.lefthalf.filled", colors: c("#64748b", "#334155"),
              keywords: ["insurance", "premium", "ประกัน", "ประกันภัย", "เบี้ยประกัน"]),
        .init(id: "donation",      label: "บริจาค & การกุศล",    symbol: "heart.fill",    colors: c("#f87171", "#b91c1c"),
              keywords: ["donation", "charity", "merit", "บริจาค", "การกุศล", "ทำบุญ"]),
        .init(id: "office",        label: "สำนักงาน",           symbol: "building.2.fill", colors: c("#94a3b8", "#475569"),
              keywords: ["office", "stationery", "supplies", "coworking",
                         "สำนักงาน", "เครื่องเขียน"]),
        .init(id: "other",         label: "อื่นๆ",              symbol: "tag.fill",      colors: c("#9ca3af", "#4b5563"),
              keywords: ["other", "misc", "อื่นๆ"]),
    ]

    /// First catalog entry whose Thai label or a keyword is a substring of `raw`.
    static func match(_ raw: String?) -> SlippyCategory? {
        guard let l = raw?.lowercased(), !l.isEmpty else { return nil }
        for cat in all {
            if l.contains(cat.label.lowercased()) { return cat }
            if cat.keywords.contains(where: { l.contains($0) }) { return cat }
        }
        return nil
    }
}

/// A glossy circular category avatar. Colour + glyph derive from the row's
/// category string.
struct CategoryIcon: View {
    let category: String?
    var size: CGFloat = 44

    /// Palette for unrecognised categories — a non-empty topic hashes to a
    /// stable slot here, so two different unknown topics never share a look.
    private static let fallbackPalette: [[Color]] = [
        [Color(hex: "#f472b6"), Color(hex: "#be185d")],  // pink
        [Color(hex: "#c084fc"), Color(hex: "#7e22ce")],  // purple
        [Color(hex: "#4ade80"), Color(hex: "#15803d")],  // lime-green
        [Color(hex: "#38bdf8"), Color(hex: "#0369a1")],  // sky
        [Color(hex: "#fbbf24"), Color(hex: "#b45309")],  // amber
        [Color(hex: "#fb7185"), Color(hex: "#be123c")],  // rose
        [Color(hex: "#2dd4bf"), Color(hex: "#0f766e")],  // teal
        [Color(hex: "#a78bfa"), Color(hex: "#6d28d9")],  // violet
        [Color(hex: "#60a5fa"), Color(hex: "#1e40af")],  // blue
        [Color(hex: "#f97316"), Color(hex: "#c2410c")],  // orange
    ]

    /// Resolve a raw category string into a concrete look.
    static func style(for category: String?) -> CategoryStyle {
        if let cat = SlippyCategory.match(category) { return cat.style }

        let trimmed = category?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !trimmed.isEmpty else {
            // Truly uncategorised — a neutral receipt disc.
            return CategoryStyle(symbol: "doc.text.fill",
                                 colors: [Color(hex: "#9ca3af"), Color(hex: "#4b5563")])
        }

        // Deterministic hash → stable palette slot (mirrors Vendor.brandColorHex).
        var h: Int32 = 0
        for ch in trimmed.unicodeScalars { h = h &* 31 &+ Int32(bitPattern: ch.value) }
        let idx = Int(h.magnitude) % fallbackPalette.count
        return CategoryStyle(symbol: "tag.fill", colors: fallbackPalette[idx])
    }

    var body: some View {
        let style = CategoryIcon.style(for: category)
        let deep = style.colors.last ?? .clear
        return ZStack {
            Circle()
                .fill(LinearGradient(colors: style.colors,
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(
                    Circle()
                        .fill(LinearGradient(colors: [Color.white.opacity(0.38), .clear],
                                             startPoint: .top, endPoint: .center))
                        .padding(1)
                )
                .overlay(Circle().strokeBorder(Color.white.opacity(0.45), lineWidth: 0.7))
                .shadow(color: deep.opacity(0.32), radius: size * 0.14, x: 0, y: size * 0.09)

            Image(systemName: style.symbol)
                .font(.system(size: size * 0.40, weight: .semibold))
                .foregroundColor(.white)
                .shadow(color: deep.opacity(0.35), radius: 0.5, x: 0, y: size * 0.02)
        }
        .frame(width: size, height: size)
    }
}

#if DEBUG
#Preview {
    ZStack {
        Color(hex: "#070a18").ignoresSafeArea()
        VStack(spacing: 28) {
            HStack(spacing: 24) {
                GoogleLogo(size: 32)
                FacebookLogo(size: 32)
                LineLogo(size: 32)
            }
            HStack(spacing: 24) {
                GoogleLogo(size: 20)
                FacebookLogo(size: 20)
                LineLogo(size: 20)
            }
        }
        .padding(28)
        .background(Color(hex: "#111827"))
        .cornerRadius(16)
    }
}

#Preview("Feature icons") {
    ZStack {
        Color(hex: "#f4f3ff").ignoresSafeArea()
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4),
                  spacing: 18) {
            ForEach(Array(FeatureIconKind.allCases.enumerated()), id: \.offset) { _, kind in
                FeatureIcon(kind: kind)
            }
        }
        .padding(24)
    }
}
#endif
