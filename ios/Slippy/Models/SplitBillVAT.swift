import Foundation

enum SplitVATMode: String, CaseIterable, Identifiable {
    case receiptTotal, none, included, excluded
    var id: String { rawValue }
    var title: String {
        switch self {
        case .receiptTotal: return "ใช้ยอดสุทธิที่ระบุ"
        case .none: return "ไม่มี VAT"
        case .included: return "ราคารวม VAT แล้ว"
        case .excluded: return "ราคายังไม่รวม VAT"
        }
    }
    var needsRate: Bool { self == .included || self == .excluded }
}

struct SplitVATCalculation {
    let net: Double?
    let vat: Double?
    let total: Double
}

enum SplitBillVAT {
    static func rate(from text: String) -> Double? {
        Double(text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: "."))
    }

    static func calculate(base: Double, mode: SplitVATMode, rate: Double? = nil,
                          referenceTotal: Double? = nil, referenceBase: Double? = nil) -> SplitVATCalculation? {
        guard base.isFinite, base >= 0, base < 9_000_000_000_000 else { return nil }
        func cents(_ value: Double) -> Double { (value * 100).rounded() / 100 }
        if mode == .receiptTotal {
            guard let total = referenceTotal, total.isFinite, total >= 0 else { return nil }
            let fraction: Double
            if let source = referenceBase, source > 0 {
                guard source.isFinite, base <= source + 0.000001 else { return nil }
                fraction = base / source
            } else { fraction = 1 }
            return .init(net: nil, vat: nil, total: cents(total * fraction))
        }
        if mode == .none {
            let total = cents(base)
            return .init(net: total, vat: 0, total: total)
        }
        guard let rate, rate.isFinite, (0...100).contains(rate) else { return nil }
        let amount = cents(base)
        if mode == .included {
            let tax = cents(amount * rate / (100 + rate))
            return .init(net: cents(amount - tax), vat: tax, total: amount)
        }
        let tax = cents(amount * rate / 100)
        return .init(net: amount, vat: tax, total: cents(amount + tax))
    }
}
