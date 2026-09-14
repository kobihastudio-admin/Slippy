import UIKit
import CoreImage.CIFilterBuiltins

/// Builds a Thai QR Payment (PromptPay) payload per the EMVCo-based spec
/// published by the Bank of Thailand. Direct Swift port of
/// `web/src/lib/promptpay.ts` — same TLV/CRC16 algorithm, same output string,
/// so QR codes generated here scan identically to the web app's.
enum PromptPayQR {

    private static func tlv(_ id: String, _ value: String) -> String {
        let len = String(format: "%02d", value.count)
        return "\(id)\(len)\(value)"
    }

    private static func crc16(_ payload: String) -> String {
        var crc: UInt16 = 0xFFFF
        for byte in payload.utf8 {
            crc ^= UInt16(byte) << 8
            for _ in 0..<8 {
                if crc & 0x8000 != 0 {
                    crc = (crc << 1) ^ 0x1021
                } else {
                    crc = crc << 1
                }
            }
        }
        return String(format: "%04X", crc)
    }

    private static func normalizeTarget(_ target: String) -> (id: String, value: String) {
        let digits = target.filter(\.isNumber)
        if digits.count == 13 { return ("02", digits) }
        if digits.count == 10 && digits.hasPrefix("0") {
            return ("01", "0066" + digits.dropFirst())
        }
        if digits.count == 15 && digits.hasPrefix("0066") {
            return ("01", digits)
        }
        return ("03", digits)
    }

    /// - Parameters:
    ///   - target: PromptPay ID — mobile number (08xxxxxxxx) or national ID (13 digits)
    ///   - amount: Optional amount in THB. When set, produces a "dynamic" QR.
    static func buildPayload(target: String, amount: Double? = nil) -> String {
        let (id, value) = normalizeTarget(target)

        var payload = ""
        payload += tlv("00", "01")
        payload += tlv("01", amount != nil ? "12" : "11")
        payload += tlv("29", tlv("00", "A000000677010111") + tlv(id, value))
        payload += tlv("53", "764")
        if let amount {
            payload += tlv("54", String(format: "%.2f", amount))
        }
        payload += tlv("58", "TH")

        payload += "6304"
        return payload + crc16(payload)
    }

    static func isValid(_ target: String) -> Bool {
        let digits = target.filter(\.isNumber)
        return digits.count == 10 || digits.count == 13
    }

    /// Renders the payload as a `UIImage` QR code at the given pixel size.
    static func image(target: String, amount: Double? = nil, size: CGFloat = 240) -> UIImage? {
        let payload = buildPayload(target: target, amount: amount)
        guard let data = payload.data(using: .ascii) else { return nil }

        let filter = CIFilter.qrCodeGenerator()
        filter.message = data
        filter.correctionLevel = "M"
        guard let outputImage = filter.outputImage else { return nil }

        let scale = size / outputImage.extent.width
        let transformed = outputImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let context = CIContext()
        guard let cgImage = context.createCGImage(transformed, from: transformed.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
