import Foundation

/// Downloads a document's stored file to a temporary copy that the share sheet can hand to "Save to Files", "Save Image",
/// LINE, Mail and so on. The name and extension come from `DocumentFileSupport` (host-tested).
enum DocumentFileDownloader {
    enum DownloadError: LocalizedError {
        case badStatus(Int)
        case notADocument
        case empty

        var errorDescription: String? {
            switch self {
            case .badStatus(let code): return "ดาวน์โหลดไฟล์ไม่สำเร็จ (รหัส \(code))"
            case .notADocument:        return "ไฟล์ที่ได้รับไม่ใช่เอกสาร กรุณาลองใหม่อีกครั้ง"
            case .empty:               return "ไฟล์ที่ได้รับว่างเปล่า"
            }
        }
    }

    private static var root: URL { FileManager.default.temporaryDirectory.appendingPathComponent("slippy-share", isDirectory: true) }

    /// Downloads `signedURL` into `<tmp>/slippy-share/<uuid>/<name>` and returns that file. Anything left over from an earlier
    /// download is removed first, so temporary copies of documents never pile up.
    static func download(from signedURL: URL, filePath: String, documentId: String) async throws -> URL {
        let (temporary, response) = try await URLSession.shared.download(from: signedURL)
        defer { try? FileManager.default.removeItem(at: temporary) }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DownloadError.badStatus(http.statusCode)
        }
        let mimeType = response.mimeType
        guard DocumentFileSupport.isDocumentMimeType(mimeType) else { throw DownloadError.notADocument }
        let size = (try? FileManager.default.attributesOfItem(atPath: temporary.path)[.size] as? Int) ?? 0
        guard size > 0 else { throw DownloadError.empty }

        purge()
        let folder = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = DocumentFileSupport.fileName(filePath: filePath, mimeType: mimeType, fallbackId: documentId)
        let destination = folder.appendingPathComponent(name)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    /// Removes one downloaded copy (its own folder), after the share sheet is dismissed.
    static func discard(_ file: URL) {
        let folder = file.deletingLastPathComponent()
        guard folder.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: folder)
    }

    private static func purge() {
        try? FileManager.default.removeItem(at: root)
    }
}
