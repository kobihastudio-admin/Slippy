import Foundation

/// Recurring sport-group template (`sport_groups` table). Sessions generated
/// from it are plain `SplitBill` rows with `category == "sport"` and
/// `sportGroupId` set — mirrors web's `/liff/sport` data model exactly.
struct SportGroup: Codable, Identifiable {
    let id: String
    let organizationId: String
    let creatorId: String
    let title: String
    let sportType: String?
    let recurringDays: [Int]
    let defaultStartTime: String?
    let defaultEndTime: String?
    let defaultVenue: String?
    let defaultCourtNo: String?
    let defaultMapUrl: String?
    let maxPlayers: Int?
    let shareToken: String?
    let lineGroupId: String?
    let status: String
    let conceptText: String?
    let promptpayId: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case organizationId    = "organization_id"
        case creatorId         = "creator_id"
        case sportType         = "sport_type"
        case recurringDays     = "recurring_days"
        case defaultStartTime  = "default_start_time"
        case defaultEndTime    = "default_end_time"
        case defaultVenue      = "default_venue"
        case defaultCourtNo    = "default_court_no"
        case defaultMapUrl     = "default_map_url"
        case maxPlayers        = "max_players"
        case shareToken        = "share_token"
        case lineGroupId       = "line_group_id"
        case conceptText       = "concept_text"
        case promptpayId       = "promptpay_id"
        case createdAt         = "created_at"
    }
}

/// Itemized per-session cost (`session_expenses` table) — sum drives the
/// session's even-split fee, same as web's expense-add form.
struct SessionExpense: Codable, Identifiable {
    let id: String
    let splitBillId: String
    let category: String
    let label: String?
    let amount: Double
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, category, label, amount
        case splitBillId = "split_bill_id"
        case createdAt   = "created_at"
    }
}

// MARK: – Sport type picker options (mirrors web's SPORT_OPTIONS)

struct SportOption { let label: String; let emoji: String }

let sportOptions: [SportOption] = [
    SportOption(label: "แบดมินตัน",  emoji: "🏸"),
    SportOption(label: "ฟุตบอล",     emoji: "⚽"),
    SportOption(label: "บาสเกตบอล",  emoji: "🏀"),
    SportOption(label: "เทนนิส",     emoji: "🎾"),
    SportOption(label: "วอลเลย์บอล", emoji: "🏐"),
    SportOption(label: "ปิงปอง",     emoji: "🏓"),
]

func sportEmoji(for sportType: String?) -> String {
    guard let sportType else { return "🏟️" }
    return sportOptions.first { sportType.contains($0.label) }?.emoji ?? "🏟️"
}

// MARK: – Expense categories (mirrors web's EXPENSE_CATEGORIES)

struct ExpenseCategory { let value: String; let label: String; let emoji: String }

let expenseCategories: [ExpenseCategory] = [
    ExpenseCategory(value: "court",       label: "ค่าเล่น/ค่าคอร์ด", emoji: "🏟️"),
    ExpenseCategory(value: "shuttlecock", label: "ค่าลูกแบด",        emoji: "🪶"),
    ExpenseCategory(value: "drinks",      label: "ค่าเครื่องดื่ม",     emoji: "🥤"),
    ExpenseCategory(value: "snacks",      label: "ค่าขนม",            emoji: "🍿"),
    ExpenseCategory(value: "other",       label: "อื่นๆ",              emoji: "💸"),
]

func expenseCategoryInfo(_ value: String) -> ExpenseCategory {
    expenseCategories.first { $0.value == value }
        ?? ExpenseCategory(value: value, label: value, emoji: "💸")
}

// MARK: – Recurring-days label helper (mirrors web's recurringDaysLabel)

private let thaiWeekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
private let dayLabels    = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]

func recurringDaysLabel(_ days: [Int]) -> String {
    guard !days.isEmpty else { return "ไม่มีกำหนดประจำ" }
    return "ทุกวัน " + days.map { thaiWeekdays[$0] }.joined(separator: ", ")
}

func dayLabel(_ index: Int) -> String { dayLabels[index] }

func timeRangeLabel(_ start: String?, _ end: String?) -> String {
    let s = start?.prefix(5)
    let e = end?.prefix(5)
    if let s, let e { return "\(s) - \(e) น." }
    if let s { return "\(s) น." }
    return ""
}
