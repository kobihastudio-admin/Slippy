import Foundation

/// What the user can say is wrong with a document. The raw values are exactly the list in the
/// `document_reports.category` CHECK (supabase/migrations/20261112100000_document_reports.sql); a test keeps the two in step.
enum DocumentReportCategory: String, CaseIterable, Identifiable {
    case wrongAmount = "wrong_amount"
    case wrongVendor = "wrong_vendor"
    case wrongDate = "wrong_date"
    case wrongTax = "wrong_tax"
    case unreadable = "unreadable"
    case duplicate = "duplicate"
    case other = "other"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .wrongAmount: return "ยอดเงินไม่ถูกต้อง"
        case .wrongVendor: return "ชื่อร้านไม่ถูกต้อง"
        case .wrongDate:   return "วันที่ไม่ถูกต้อง"
        case .wrongTax:    return "ภาษี (VAT / หัก ณ ที่จ่าย) ไม่ถูกต้อง"
        case .unreadable:  return "อ่านเอกสารไม่ออก / ภาพไม่ชัด"
        case .duplicate:   return "เอกสารซ้ำ"
        case .other:       return "อื่น ๆ"
        }
    }

    /// Only "other" means nothing without a description (the table has the same rule as a CHECK).
    var requiresNote: Bool { self == .other }
}

/// Foundation-only rules for the "รายงานปัญหา" report (host-tested by `node ios/scripts/verify-document-actions.mjs`).
enum DocumentReport {
    /// `document_reports.note` allows 1...1000 characters (Postgres counts code points, so does this).
    static let maxNoteLength = 1000
    private static let maxContextValueLength = 200
    private static let uniqueViolation = "23505"

    enum ValidationError: Equatable {
        case noteRequired
        case noteTooLong
    }

    /// The row sent to `document_reports`. `status` is not here: the database defaults it to `open`, and the insert policy
    /// refuses anything else.
    struct Insert: Encodable, Equatable {
        let documentId: String
        let organizationId: String
        let reporterId: String
        let category: String
        let note: String?
        let appVersion: String?
        let context: [String: String]

        enum CodingKeys: String, CodingKey {
            case documentId = "document_id"
            case organizationId = "organization_id"
            case reporterId = "reporter_id"
            case category, note
            case appVersion = "app_version"
            case context
        }
    }

    /// The note trimmed, or `nil` if there is nothing left (a blank note must not be sent: the column's CHECK wants 1...1000).
    static func cleanNote(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func validate(category: DocumentReportCategory, note: String) -> ValidationError? {
        let cleaned = cleanNote(note)
        if category.requiresNote && cleaned == nil { return .noteRequired }
        if let cleaned, cleaned.unicodeScalars.count > maxNoteLength { return .noteTooLong }
        return nil
    }

    /// `nil` when the report is not valid (see `validate`).
    static func makeInsert(
        documentId: String, organizationId: String, reporterId: String,
        category: DocumentReportCategory, note: String, appVersion: String?, context: [String: String]
    ) -> Insert? {
        guard validate(category: category, note: note) == nil else { return nil }
        return Insert(
            documentId: documentId, organizationId: organizationId, reporterId: reporterId,
            category: category.rawValue, note: cleanNote(note), appVersion: appVersion, context: context)
    }

    /// What the team needs to find the problem without opening the app: the values as shown, the state, and the
    /// validator's own warning codes. Blank values are left out.
    static func makeContext(
        vendorName: String?, totalAmount: Double?, status: String?, source: String?, docType: String?,
        validationIssues: [String]
    ) -> [String: String] {
        var out: [String: String] = [:]
        func put(_ key: String, _ value: String?) {
            guard let value else { return }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { out[key] = String(trimmed.prefix(maxContextValueLength)) }
        }
        put("vendor_name", vendorName)
        put("total_amount", totalAmount.map { String(format: "%.2f", $0) })
        put("status", status)
        put("source", source)
        put("doc_type", docType)
        if !validationIssues.isEmpty { put("validation_issues", validationIssues.joined(separator: ",")) }
        return out
    }

    /// A unique violation means this reporter already has an open report of this category for this document: the user's
    /// intent is satisfied, so the screen says "already reported" instead of failing.
    static func isAlreadyReported(code: String?) -> Bool { code == uniqueViolation }
}
