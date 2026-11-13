import Foundation

/// Foundation-only rules for files sent in a chat (host-tested by `node ios/scripts/verify-chat-attachment-rules.mjs`).
/// They mirror what the web chat does (`web/src/app/(app)/messages/[id]/ChatRoom.tsx`): the public `chat-attachments`
/// bucket (50 MB, migration 077), objects at `chat/<conversationId>/<millis>.<ext>`, and a message of type
/// `image` / `video` / `file` whose body is the file name and whose `meta` is `{fileName, fileSize}`.
enum ChatAttachmentRules {
    static let bucket = "chat-attachments"
    static let maxBytes = 50 * 1024 * 1024
    private static let maxMegabytesLabel = 50

    /// JPEG qualities tried in turn when a photo is over the limit, best first.
    static let jpegQualitySteps: [Double] = [0.85, 0.6, 0.4]

    /// `nil` when the size is acceptable, else the Thai message to show.
    static func sizeProblem(bytes: Int) -> String? {
        if bytes <= 0 { return "ไฟล์ว่างเปล่า" }
        if bytes > maxBytes {
            return "ไฟล์ใหญ่เกินไป (\(sizeLabel(bytes: bytes))) — จำกัดที่ \(maxMegabytesLabel) MB"
        }
        return nil
    }

    /// `msg_type` for a file, from its MIME type (the same split the web uses).
    static func messageType(mime: String) -> String {
        let lower = mime.lowercased()
        if lower.hasPrefix("image/") { return "image" }
        if lower.hasPrefix("video/") { return "video" }
        return "file"
    }

    /// `1.5 MB` / `320 KB` / `12 B`.
    static func sizeLabel(bytes: Int) -> String {
        let value = Double(max(bytes, 0))
        if value >= 1024 * 1024 { return String(format: "%.1f MB", value / (1024 * 1024)) }
        if value >= 1024 { return String(format: "%.0f KB", value / 1024) }
        return "\(max(bytes, 0)) B"
    }

    /// The extension kept in the storage path: lower-case ASCII letters and digits, at most 8 of them; anything else
    /// (empty, hostile, `../`) becomes `bin`.
    static func safeExtension(_ raw: String) -> String {
        let lower = raw.lowercased()
        let allowed = lower.unicodeScalars.allSatisfy { ($0.value >= 97 && $0.value <= 122) || ($0.value >= 48 && $0.value <= 57) }
        return (!lower.isEmpty && lower.count <= 8 && allowed) ? lower : "bin"
    }

    /// `chat/<conversationId>/<millis>.<ext>`. The conversation id is lower-cased (it is a UUID).
    static func storagePath(conversationId: String, date: Date, fileName: String) -> String {
        let millis = Int((date.timeIntervalSince1970 * 1000).rounded())
        let ext = safeExtension((fileName as NSString).pathExtension)
        return "chat/\(conversationId.lowercased())/\(millis).\(ext)"
    }

    /// `รูปภาพ-yyyyMMdd-HHmmss.<ext>` / `วิดีโอ-…` for something taken or picked from the library (Gregorian digits
    /// whatever calendar the phone uses).
    static func capturedFileName(kind: String, date: Date, ext: String, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let prefix = kind == "video" ? "วิดีโอ" : "รูปภาพ"
        return "\(prefix)-\(formatter.string(from: date)).\(safeExtension(ext))"
    }

    /// Message types that can be sent on to another chat. Payment requests, slips and system lines belong to one bill
    /// or one trip and are not forwarded.
    static func isForwardable(msgType: String) -> Bool {
        ["text", "image", "video", "file"].contains(msgType)
    }

    /// Whether the message is a file the share sheet can take (a URL to download).
    static func isShareableFile(msgType: String, attachmentUrl: String?) -> Bool {
        guard ["image", "video", "file"].contains(msgType),
              let attachmentUrl, let url = URL(string: attachmentUrl),
              let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "https" || scheme == "http"
    }

    /// A name safe to use as a temporary file name (no path separators or characters filesystems reject); falls back
    /// to `fallback` when nothing is left.
    static func safeLocalFileName(_ raw: String, fallback: String) -> String {
        let cleaned = raw.components(separatedBy: CharacterSet(charactersIn: "/\\?%*:|\"<>\u{0}"))
            .joined(separator: "-")
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        return cleaned.isEmpty ? fallback : String(cleaned.prefix(120))
    }

    /// SF Symbol for a file card, by extension.
    static func iconName(forFileName name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "pdf": return "doc.richtext"
        case "doc", "docx", "rtf", "txt", "pages": return "doc.text"
        case "xls", "xlsx", "csv", "numbers": return "tablecells"
        case "ppt", "pptx", "key": return "rectangle.on.rectangle"
        case "zip", "rar", "7z", "gz", "tar": return "doc.zipper"
        case "mp3", "m4a", "wav", "aac": return "waveform"
        case "mp4", "mov", "m4v", "avi": return "film"
        case "jpg", "jpeg", "png", "heic", "gif", "webp": return "photo"
        default: return "doc"
        }
    }

    /// Thai wording for what storage, the table or the network says when sending a file fails. A message that is
    /// already Thai is shown as it is; an unknown one keeps its original text after a Thai prefix.
    static func friendlyError(_ raw: String) -> String {
        if raw.unicodeScalars.contains(where: { (0x0E00...0x0E7F).contains($0.value) }) { return raw }
        let text = raw.lowercased()
        func has(_ needles: String...) -> Bool { needles.contains { text.contains($0) } }
        if has("exceeded the maximum", "payload too large", "too large", "413") {
            return "ไฟล์ใหญ่เกินไป — จำกัดที่ \(maxMegabytesLabel) MB"
        }
        if has("row-level security", "violates", "unauthorized", "not authorized", "403", "42501", "jwt") {
            return "ไม่มีสิทธิ์ส่งไฟล์ในแชทนี้ ลองออกจากระบบแล้วเข้าใหม่"
        }
        if has("offline", "not connected", "timed out", "network", "internet", "connection") {
            return "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง"
        }
        return "ส่งไฟล์ไม่สำเร็จ: \(raw)"
    }
}
