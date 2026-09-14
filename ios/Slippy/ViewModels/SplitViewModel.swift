import SwiftUI
import Supabase

@MainActor
final class SplitViewModel: ObservableObject {
    @Published var bills: [SplitBill] = []
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    func load(orgId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            bills = try await db
                .from("split_bills")
                .select("*, split_participants(*), split_bill_receipts(*)")
                .eq("organization_id", value: orgId)
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createBill(
        orgId: String,
        userId: String,
        title: String,
        totalAmount: Double,
        note: String?,
        participants: [(name: String, amount: Double)]
    ) async throws -> String? {
        struct BillInsert: Encodable {
            let organization_id: String
            let creator_id: String
            let title: String
            let total_amount: Double
            let note: String?
        }

        struct BillRow: Decodable {
            let id: String
            let share_token: String?
        }

        let inserted: [BillRow] = try await db
            .from("split_bills")
            .insert(BillInsert(
                organization_id: orgId,
                creator_id: userId,
                title: title,
                total_amount: totalAmount,
                note: note?.isEmpty == true ? nil : note
            ))
            .select("id, share_token")
            .execute()
            .value

        guard let row = inserted.first else { return nil }

        struct ParticipantInsert: Encodable {
            let split_bill_id: String
            let name: String
            let amount: Double
        }

        let participantRows = participants.map {
            ParticipantInsert(split_bill_id: row.id, name: $0.name, amount: $0.amount)
        }

        try await db
            .from("split_participants")
            .insert(participantRows)
            .execute()

        return row.share_token
    }

    func markPaid(participantId: String) async throws {
        struct Patch: Encodable {
            let paid_at: String
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let patch = Patch(paid_at: iso.string(from: Date()))

        try await db
            .from("split_participants")
            .update(patch)
            .eq("id", value: participantId)
            .execute()
    }

    func deleteBill(id: String) async throws {
        try await db
            .from("split_bills")
            .delete()
            .eq("id", value: id)
            .execute()
    }
}
