import Foundation
import Supabase

/// Sends a "รายงานปัญหา" report to `document_reports` with the user's own session (RLS: a member of the document's
/// organization, as themselves, status `open`). See supabase/migrations/20261112100000_document_reports.sql.
enum DocumentReportService {
    enum Outcome: Equatable {
        case sent
        /// This reporter already has an open report of this category for this document.
        case alreadyReported
    }

    static func submit(_ report: DocumentReport.Insert) async throws -> Outcome {
        do {
            try await SupabaseManager.shared.client
                .from("document_reports")
                .insert(report)
                .execute()
            return .sent
        } catch let error as PostgrestError where DocumentReport.isAlreadyReported(code: error.code) {
            return .alreadyReported
        }
    }
}
