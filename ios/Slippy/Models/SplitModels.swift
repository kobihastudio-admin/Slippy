import Foundation

struct SplitBill: Codable, Identifiable {
    let id: String
    let organizationId: String
    let creatorId: String
    let title: String
    let totalAmount: Double
    let note: String?
    let shareToken: String?
    let lineGroupId: String?
    var status: String?
    let createdAt: String
    var participants: [SplitParticipant]?
    var receipts: [SplitBillReceipt]? = nil

    // ── Sport-group fields (category="sport") — same split_bills table,
    // populated for bookings created via "นัดกีฬา" / LINE /sportgroup.
    // All optional + additive so regular (non-sport) bills decode unaffected.
    var category: String?
    var sportType: String?
    var venue: String?
    var bookingDate: String?
    var startTime: String?
    var endTime: String?
    var courtNo: String?
    var mapUrl: String?
    var maxPlayers: Int?
    var promptpayId: String?
    var extraNotes: String?
    var sportGroupId: String?

    enum CodingKeys: String, CodingKey {
        case id, title, note, status
        case organizationId = "organization_id"
        case creatorId = "creator_id"
        case totalAmount = "total_amount"
        case shareToken  = "share_token"
        case lineGroupId = "line_group_id"
        case createdAt = "created_at"
        case participants = "split_participants"
        case receipts = "split_bill_receipts"
        case category, venue
        case sportType    = "sport_type"
        case bookingDate  = "booking_date"
        case startTime    = "start_time"
        case endTime      = "end_time"
        case courtNo      = "court_no"
        case mapUrl       = "map_url"
        case maxPlayers   = "max_players"
        case promptpayId  = "promptpay_id"
        case extraNotes   = "extra_notes"
        case sportGroupId = "sport_group_id"
    }

    var paidCount: Int { participants?.filter { $0.isPaid }.count ?? 0 }
    var totalCount: Int { participants?.count ?? 0 }
    var isSettled: Bool { totalCount > 0 && paidCount == totalCount }
    var isSportSession: Bool { category == "sport" }
}

struct SplitParticipant: Codable, Identifiable {
    let id: String
    let splitBillId: String
    let name: String
    let email: String?
    let amount: Double
    let paidAt: String?
    let createdAt: String

    // ── Sport-booking extras ───────────────────────────────────────────────
    var guestCount: Int?
    var paymentProofUrl: String?

    /// The participant who added this person via "เพิ่มเพื่อน" — nil for
    /// participants who joined directly (e.g. via the share link). Used to
    /// render the roster as a tree (added friends nested under their adder).
    var addedByParticipantId: String?
    var linePictureUrl: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, name, email, amount
        case splitBillId = "split_bill_id"
        case paidAt = "paid_at"
        case createdAt = "created_at"
        case guestCount = "guest_count"
        case paymentProofUrl = "payment_proof_url"
        case addedByParticipantId = "added_by_participant_id"
        case linePictureUrl = "line_picture_url"
    }

    var isPaid: Bool { paidAt != nil }
    var effectiveGuestCount: Int { guestCount ?? 0 }
    var pendingReview: Bool { paymentProofUrl != nil && !isPaid }
}

struct SplitBillReceipt: Codable, Identifiable {
    let id: String
    let splitBillId: String
    let documentId: String?
    let paidByParticipantId: String?
    let receiptUrl: String?
    let title: String?
    let amount: Double
    let expenseDate: String
    let mealType: String?
    let source: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, amount, source
        case splitBillId = "split_bill_id"
        case documentId = "document_id"
        case paidByParticipantId = "paid_by_participant_id"
        case receiptUrl = "receipt_url"
        case expenseDate = "expense_date"
        case mealType = "meal_type"
        case createdAt = "created_at"
    }

    var mealLabel: String {
        switch mealType {
        case "breakfast": return "มื้อเช้า"
        case "lunch": return "มื้อกลางวัน"
        case "dinner": return "มื้อเย็น"
        case "snack": return "ของว่าง"
        default: return "ค่าใช้จ่ายอื่น"
        }
    }
}
