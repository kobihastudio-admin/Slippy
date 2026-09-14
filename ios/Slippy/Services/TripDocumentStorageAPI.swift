import Foundation
import Supabase

/// The trip's document library — itinerary scans, passport, visa, insurance,
/// tickets, hotel confirmations. Store-and-view only, uploaded straight to
/// Supabase from the device — participant-scoped RLS (migration
/// 20260824160000_trip_documents_photos_checkin.sql) authorizes it the same
/// way TripItineraryAPI's writes already are.
///
/// Uploaded into the PRIVATE trip-documents bucket, unlike TripPhotoAPI's
/// public one — a passport scan is not a casual photo. Viewing one means
/// minting a signed URL, not a public one.
@MainActor
enum TripDocumentStorageAPI {

    private static var db: SupabaseClient { SupabaseManager.shared.client }
    private static let bucket = "trip-documents"

    static let columns = "id, kind, title, file_path, file_type, file_size, created_at"

    private static let extType: [String: String] = [
        "pdf": "pdf", "jpg": "jpg", "jpeg": "jpg", "png": "png", "heic": "heic",
    ]

    static func list(journeyId: String) async throws -> [TripDocument] {
        try await db.from("trip_documents")
            .select(columns)
            .eq("journey_id", value: journeyId)
            .order("created_at", ascending: false)
            .execute()
            .value
    }

    /// `fileName` supplies the extension, which decides `file_type` — the
    /// same rule the web upload route enforces, so a row from either side
    /// always has a `file_type` the other can render an icon for.
    static func upload(
        journeyId: String,
        data: Data,
        fileName: String,
        contentType: String,
        kind: TripDocumentKind,
        title: String
    ) async throws -> TripDocument {
        let ext = (fileName as NSString).pathExtension.lowercased()
        guard let fileType = extType[ext] else {
            throw NSError(domain: "TripDocumentStorageAPI", code: 1,
                           userInfo: [NSLocalizedDescriptionKey: "รองรับเฉพาะไฟล์ PDF, JPG, PNG, HEIC"])
        }
        let path = "\(journeyId)/\(UUID().uuidString).\(ext)"

        try await db.storage.from(bucket)
            .upload(path, data: data, options: .init(contentType: contentType))

        let userId = try? await db.auth.session.user.id.uuidString
        struct NewDoc: Encodable {
            let journey_id: String
            let uploaded_by: String?
            let kind: String
            let title: String
            let file_path: String
            let file_type: String
            let file_size: Int
        }
        do {
            return try await db.from("trip_documents")
                .insert(NewDoc(
                    journey_id: journeyId, uploaded_by: userId, kind: kind.rawValue,
                    title: title, file_path: path, file_type: fileType, file_size: data.count
                ))
                .select(columns)
                .single()
                .execute()
                .value
        } catch {
            // The row write failed — don't leave an orphaned file nobody can
            // ever list or delete through the app.
            _ = try? await db.storage.from(bucket).remove(paths: [path])
            throw error
        }
    }

    /// A view link — the bucket is private, so this must be minted per view
    /// rather than stored once. One hour, matching the web route.
    static func signedURL(filePath: String) async throws -> URL {
        try await db.storage.from(bucket).createSignedURL(path: filePath, expiresIn: 3600)
    }

    /// Downloads a document to a local file QuickLook can actually open.
    ///
    /// `.quickLookPreview()` (QLPreviewController underneath) previews a
    /// *local* file — handing it the remote signed URL directly, as this
    /// used to do, does not work: QuickLook does not fetch remote URLs
    /// itself, so the preview came up blank/"cannot be viewed" for every
    /// document. Same fetch-then-write-to-temp pattern already used by
    /// TripDocumentAPI.exportPDF/exportKML for exactly this reason — those
    /// two also hand a local URL to something (a share sheet) that only
    /// works with one.
    static func downloadForPreview(_ document: TripDocument) async throws -> URL {
        let remote = try await signedURL(filePath: document.filePath)
        let (data, response) = try await URLSession.shared.data(from: remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "TripDocumentStorageAPI", code: 2,
                           userInfo: [NSLocalizedDescriptionKey: "ดาวน์โหลดเอกสารไม่สำเร็จ"])
        }
        let safeTitle = document.title.components(separatedBy: CharacterSet(charactersIn: "/\\?%*:|\"<>"))
            .joined(separator: "-")
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeTitle).\(document.fileType)")
        try data.write(to: dest, options: .atomic)
        return dest
    }

    static func remove(document: TripDocument) async throws {
        _ = try? await db.storage.from(bucket).remove(paths: [document.filePath])
        try await db.from("trip_documents").delete().eq("id", value: document.id).execute()
    }
}
