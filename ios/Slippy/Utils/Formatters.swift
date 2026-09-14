import Foundation

// MARK: – Thai Baht Formatter
/// Formats an amount as Thai Baht.
///
/// `decimals: nil` (the default) adapts to the value: satang are shown only when
/// they exist, so ฿1,119.22 keeps its 22 while ฿259 stays clean. It used to
/// default to 0 decimals, which silently ROUNDED — a ฿1,119.22 bill was
/// displayed as ฿1,119 and the VAT of ฿73.22 as ฿73, so the figures on screen
/// no longer added up and looked like extraction errors.
func fmtTHB(_ amount: Double, decimals: Int? = nil) -> String {
    // Round to satang first: 73.2199999 is 73.22, not a value "with decimals"
    // that needs displaying to more places.
    let rounded = (amount * 100).rounded() / 100
    let places  = decimals ?? (rounded == rounded.rounded() ? 0 : 2)

    let fmt = NumberFormatter()
    fmt.numberStyle          = .decimal
    fmt.minimumFractionDigits = places
    fmt.maximumFractionDigits = places
    fmt.groupingSeparator    = ","
    let formatted = fmt.string(from: NSNumber(value: rounded)) ?? "0"
    return "฿\(formatted)"
}

// MARK: – Relative Time (Thai)
func relTime(_ isoString: String) -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = fmt.date(from: isoString) else { return "" }
    let diff = Date().timeIntervalSince(date)
    switch diff {
    case ..<60:          return "เมื่อกี้"
    case ..<3600:        return "\(Int(diff/60)) นาทีที่แล้ว"
    case ..<86400:       return "\(Int(diff/3600)) ชม.ที่แล้ว"
    case ..<604800:      return "\(Int(diff/86400)) วันที่แล้ว"
    default:             return fmtDate(isoString)
    }
}

// MARK: – Thai Date Formatter
func fmtDate(_ isoString: String) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = iso.date(from: isoString) else { return isoString }
    let fmt = DateFormatter()
    fmt.locale     = Locale(identifier: "th_TH")
    fmt.dateStyle  = .medium
    fmt.timeStyle  = .none
    return fmt.string(from: date)
}

// MARK: – VAT Calculation (Thai 7% inclusive)
struct VATResult {
    let vat: Double
    let net: Double
}

func calcVAT(_ total: Double) -> VATResult {
    let vat = (total * 700.0 / 107.0).rounded() / 100.0
    let net = (total * 100.0).rounded() / 100.0 - vat
    return VATResult(vat: vat, net: net)
}
