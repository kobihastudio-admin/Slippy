import Foundation

/// Foundation-only rules for uploading a trip document from the device (host-tested by
/// `node ios/scripts/verify-trip-document-upload.mjs`). The limits are the ones the `trip-documents` bucket and
/// the web route enforce (15 MB; pdf / jpg / png / heic), checked here first so the user gets a Thai message before
/// the upload instead of an English storage error after it.
enum TripDocumentUploadRules {
    static let maxBytes = 15 * 1024 * 1024
    private static let maxMegabytesLabel = 15

    /// JPEG qualities tried in turn when a photo is over the limit, best first.
    static let jpegQualitySteps: [Double] = [0.85, 0.6, 0.4]

    /// `nil` when the size is acceptable, else the Thai message to show.
    static func sizeProblem(bytes: Int) -> String? {
        if bytes <= 0 { return "ไฟล์ว่างเปล่า" }
        if bytes > maxBytes {
            let size = String(format: "%.1f MB", Double(bytes) / Double(1024 * 1024))
            return "ไฟล์ใหญ่เกินไป (\(size)) — จำกัดที่ \(maxMegabytesLabel) MB"
        }
        return nil
    }

    /// How a picked or taken photo is stored. HEIC, PNG and JPEG originals are kept as they are; anything else the
    /// table does not allow (GIF, TIFF, HEIF, unknown) is converted to JPEG.
    enum PhotoFormat: Equatable {
        case heic, png, jpeg, convertToJPEG

        var ext: String {
            switch self {
            case .heic: return "heic"
            case .png:  return "png"
            case .jpeg, .convertToJPEG: return "jpg"
            }
        }
        var mime: String {
            switch self {
            case .heic: return "image/heic"
            case .png:  return "image/png"
            case .jpeg, .convertToJPEG: return "image/jpeg"
            }
        }
    }

    /// `typeIdentifiers` are the picked item's UTType identifiers, best match first.
    static func storedPhotoFormat(typeIdentifiers: [String]) -> PhotoFormat {
        for id in typeIdentifiers {
            switch id {
            case "public.heic": return .heic
            case "public.png":  return .png
            case "public.jpeg": return .jpeg
            default: continue
            }
        }
        return .convertToJPEG
    }

    /// `รูปภาพ-yyyyMMdd-HHmmss.<ext>` (Gregorian digits whatever the phone's calendar is; an unknown or hostile
    /// extension becomes jpg).
    static func photoFileName(date: Date, ext: String, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        var clean = ext.lowercased()
        if clean == "jpeg" { clean = "jpg" }
        if !["jpg", "png", "heic"].contains(clean) { clean = "jpg" }
        return "รูปภาพ-\(formatter.string(from: date)).\(clean)"
    }

    /// Thai wording for what storage, the table or the network says when an upload fails. A message that is already
    /// Thai is shown as it is; an unknown one keeps its original text after a Thai prefix.
    static func friendlyError(_ raw: String) -> String {
        if raw.unicodeScalars.contains(where: { (0x0E00...0x0E7F).contains($0.value) }) { return raw }
        let text = raw.lowercased()
        func has(_ needles: String...) -> Bool { needles.contains { text.contains($0) } }
        if has("exceeded the maximum", "payload too large", "too large", "413") {
            return "ไฟล์ใหญ่เกินไป — จำกัดที่ \(maxMegabytesLabel) MB"
        }
        if has("row-level security") { return "ไม่มีสิทธิ์อัปโหลดเอกสารของทริปนี้ (เฉพาะผู้ร่วมทริป)" }
        if has("permission denied") { return "ไม่มีสิทธิ์เข้าถึง กรุณาล็อกอินใหม่แล้วลองอีกครั้ง" }
        if has("offline", "connection was lost", "timed out", "internet connection", "network connection") {
            return "การเชื่อมต่ออินเทอร์เน็ตมีปัญหา ลองใหม่อีกครั้ง"
        }
        return raw.isEmpty ? "อัปโหลดไม่สำเร็จ" : "อัปโหลดไม่สำเร็จ: \(raw)"
    }
}
