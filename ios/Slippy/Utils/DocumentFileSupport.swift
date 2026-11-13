import Foundation

/// Foundation-only rules for the file the document screen downloads and shares (host-tested by
/// `node ios/scripts/verify-document-actions.mjs`).
///
/// The stored `file_path` is whatever the uploader produced; the share sheet decides what it can do with a file from its
/// extension, so the downloaded copy must always end in a real one, and its name must never be able to leave the
/// temporary folder it is written to.
enum DocumentFileSupport {
    private static let extensionForMime: [String: String] = [
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic",
        "image/heif": "heif", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
    ]
    private static let knownExtensions: Set<String> = ["jpg", "png", "heic", "heif", "webp", "gif", "pdf"]
    private static let maxStemLength = 60
    /// Documents are scanned photos, so a file with no usable hint is treated as a jpg.
    private static let defaultExtension = "jpg"

    /// The extension for a response's `Content-Type` (parameters and case ignored), or `nil` if it is not a document type.
    static func fileExtension(forMimeType mimeType: String?) -> String? {
        guard let mimeType else { return nil }
        let base = mimeType.split(separator: ";").first.map(String.init) ?? mimeType
        return extensionForMime[base.trimmingCharacters(in: .whitespaces).lowercased()]
    }

    /// `false` for an error body (html/json) that storage or a proxy answered instead of the file. An unknown or generic
    /// type gets the benefit of the doubt: the HTTP status is what decides success, this only catches the obvious mistake.
    static func isDocumentMimeType(_ mimeType: String?) -> Bool {
        guard let mimeType else { return true }
        let base = (mimeType.split(separator: ";").first.map(String.init) ?? mimeType)
            .trimmingCharacters(in: .whitespaces).lowercased()
        return base.hasPrefix("image/") || base == "application/pdf" || base == "application/octet-stream"
    }

    /// `<safe stem>.<extension>` for the downloaded copy. Keeps the stored name where it is usable, replaces anything that is
    /// unsafe in a file name with `_` (Thai letters are kept), cuts a long name, and falls back to `document-<id prefix>`.
    static func fileName(filePath: String, mimeType: String?, fallbackId: String) -> String {
        let last = filePath.components(separatedBy: "/").last ?? ""
        let ns = last as NSString
        var ext = ns.pathExtension.lowercased()
        if ext == "jpeg" { ext = "jpg" }
        let resolvedExtension = knownExtensions.contains(ext)
            ? ext
            : (fileExtension(forMimeType: mimeType) ?? defaultExtension)

        var stem = sanitize(ns.deletingPathExtension)
        stem = String(stem.prefix(maxStemLength)).trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if stem.isEmpty { stem = "document-\(fallbackId.prefix(8))" }
        return "\(stem).\(resolvedExtension)"
    }

    private static func sanitize(_ raw: String) -> String {
        let kept = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        var out = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars { out.append(kept.contains(scalar) ? scalar : "_") }
        return String(out).trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
}
