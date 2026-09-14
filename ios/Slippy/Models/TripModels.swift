import Foundation
import Supabase

struct Trip: Codable, Identifiable {
    let id: String
    let organizationId: String
    let creatorId: String?
    let title: String
    let description: String?
    let tripType: String?
    let eventDate: String?
    let venue: String?
    let status: String
    let totalAmount: Double?
    let notes: String?
    let shareToken: String?
    let createdAt: String
    var startedAt: String? = nil
    var endedAt: String? = nil
    var destination: String? = nil
    var baseCurrency: String? = nil
    var participants: [TripParticipant]?
    var expenses: [TripExpense]?

    enum CodingKeys: String, CodingKey {
        case id, title, description, venue, status, notes
        case organizationId = "organization_id"
        case creatorId = "creator_id"
        case tripType = "trip_type"
        case eventDate = "event_date"
        case totalAmount = "total_amount"
        case shareToken = "share_token"
        case createdAt = "created_at"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case destination
        case baseCurrency = "base_currency"
        case participants = "trip_participants"
        case expenses = "trip_expenses"
    }

    var tripTypeLabel: String {
        switch tripType {
        case "travel":     return "✈️ ท่องเที่ยว"
        case "sport":      return "🏟️ กีฬา"
        case "food_order": return "🍽️ อาหาร"
        default:           return "📌 ทั่วไป"
        }
    }

    var tripTypeEmoji: String {
        switch tripType {
        case "travel":     return "✈️"
        case "sport":      return "🏟️"
        case "food_order": return "🍽️"
        default:           return "📌"
        }
    }

    var statusLabel: String {
        switch status {
        case "settled":   return "เสร็จสิ้น"
        case "cancelled": return "ยกเลิก"
        default:          return "กำลังดำเนินการ"
        }
    }

    /// Total spend, in the trip's base currency.
    ///
    /// Sums `baseAmount`, never `amount`. Since migration 073 an expense stores
    /// what was actually charged in `amount` and the converted figure in
    /// `amount_base_currency`, so this used to add ¥35,600 to ฿8,544 and print
    /// the result with a ฿ in front of it. Mixed-currency arithmetic produces a
    /// number, which is exactly why it survived — nothing about the output
    /// looked wrong.
    var computedTotal: Double {
        expenses?.reduce(0) { $0 + $1.baseAmount } ?? totalAmount ?? 0
    }

    var totalPaid: Double {
        participants?.reduce(0) { $0 + $1.amountPaid } ?? 0
    }

    var totalRemaining: Double {
        max(0, computedTotal - totalPaid)
    }
}

struct TripItineraryDay: Codable, Identifiable {
    let id: String
    let journeyId: String?
    let dayNumber: Int
    let date: String?
    let title: String?
    /// Where the day happens. Added alongside the Journey schema so the day
    /// strip can print "Day 3 · 22 พ.ย. · Hiroshima" instead of parsing the
    /// city back out of `title`.
    let city: String?
    let summary: String?
    var items: [TripItineraryItem]?
    enum CodingKeys: String, CodingKey {
        case id, date, title, city, summary
        case journeyId = "journey_id"
        case dayNumber = "day_number"
        case items = "trip_itinerary_items"
    }

    /// Day total in the trip's base currency.
    var total: Double { (items ?? []).reduce(0) { $0 + $1.baseAmount } }
}

/// One stop on the timeline.
///
/// Mirrors supabase/migrations/20260822120000_trip_journey_structure.sql: the
/// table gained concrete transport types, coordinates for both ends of a leg,
/// booking fields, and the same multi-currency columns trip_expenses uses.
/// Everything added there is optional here so the app keeps decoding rows
/// written before it.
struct TripItineraryItem: Codable, Identifiable {
    let id: String
    let dayId: String
    let sortOrder: Int
    let type: String
    let title: String
    let subtitle: String?
    let location: String?
    let notes: String?
    let timeFrom: String?
    let timeTo: String?

    // Booking
    /// planned · confirmed · optional · cancelled
    let status: String?
    let provider: String?
    let confirmationCode: String?

    // Geography. `lat`/`lng` are where it starts; the `end*` pair is where a
    // transport leg arrives, and is nil for anything that happens in one place.
    let lat: Double?
    let lng: Double?
    let endLocation: String?
    let endLat: Double?
    let endLng: Double?

    // Money — same convention as TripExpense. See `baseAmount`.
    let amount: Double?
    let currency: String?
    let exchangeRate: Double?
    let amountBaseCurrency: Double?

    /// The trip_expenses row that paid for this, when one exists.
    let expenseId: String?

    /// When this stop was checked into, and by whom — see 20260824160000_trip_documents_photos_checkin.sql.
    let checkedInAt: String?
    let checkedInBy: String?

    /// Mode-specific fields — flight_number, seat, or (for a stop added from a
    /// map place) phone/website/address. Read defensively: nothing enforces
    /// its shape, see 20260822120000's own comment on this column.
    let details: [String: AnyJSON]?

    enum CodingKeys: String, CodingKey {
        case id, type, title, subtitle, location, notes, amount, currency, status, provider, lat, lng, details
        case dayId = "day_id"
        case sortOrder = "sort_order"
        case timeFrom = "time_from"
        case timeTo = "time_to"
        case confirmationCode = "confirmation_code"
        case endLocation = "end_location"
        case endLat = "end_lat"
        case endLng = "end_lng"
        case exchangeRate = "exchange_rate"
        case amountBaseCurrency = "amount_base_currency"
        case expenseId = "expense_id"
        case checkedInAt = "checked_in_at"
        case checkedInBy = "checked_in_by"
    }

    /// A string field out of `details` — nil if absent or not a string.
    private func detailString(_ key: String) -> String? {
        if case .string(let s) = details?[key] { return s }
        return nil
    }
    var placePhone: String? { detailString("phone") }
    var placeWebsite: String? { detailString("website") }
    var placeAddress: String? { detailString("address") }
    var placeGooglePlaceId: String? { detailString("google_place_id") }
    var placePhotoURL: String? { detailString("photo_url") }

    /// Trip-currency figure — the only one safe to show with a ฿ or to total.
    var baseAmount: Double { amountBaseCurrency ?? amount ?? 0 }

    /// "¥35,600" when the item was paid in another currency, else nil.
    func originalAmount(tripCurrency: String) -> String? {
        guard let currency, currency != tripCurrency, let amount, amount > 0 else { return nil }
        let n = amount.formatted(.number.precision(.fractionLength(0)))
        return currency == "JPY" ? "¥\(n)" : "\(n) \(currency)"
    }

    /// True when this leg has both ends, and so can be drawn as a line.
    var isLeg: Bool { endLat != nil && endLng != nil }

    var coordinate: (lat: Double, lng: Double)? {
        guard let lat, let lng else { return nil }
        return (lat, lng)
    }
}

struct TripParticipant: Codable, Identifiable {
    let id: String
    let journeyId: String
    let userId: String?
    let displayName: String
    let avatarUrl: String?
    let tripRole: String?
    let emergencyContact: String?
    let profileSharedWithTrip: Bool
    let isHost: Bool
    let amountOwed: Double
    let amountPaid: Double
    let paidAt: String?
    let promptpayValue: String?
    let qrImageUrl: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case journeyId = "journey_id"
        case userId = "user_id"
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case tripRole = "trip_role"
        case emergencyContact = "emergency_contact"
        case profileSharedWithTrip = "profile_shared_with_trip"
        case isHost = "is_host"
        case amountOwed = "amount_owed"
        case amountPaid = "amount_paid"
        case paidAt = "paid_at"
        case promptpayValue = "promptpay_value"
        case qrImageUrl = "qr_image_url"
        case createdAt = "created_at"
    }

    /// The profile fields were introduced after trips had already been created.
    /// Decode older participant rows safely until the database migration is live,
    /// so a missing optional profile column can never prevent a Journey opening.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        journeyId = try container.decode(String.self, forKey: .journeyId)
        userId = try container.decodeIfPresent(String.self, forKey: .userId)
        displayName = try container.decode(String.self, forKey: .displayName)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        tripRole = try container.decodeIfPresent(String.self, forKey: .tripRole)
        emergencyContact = try container.decodeIfPresent(String.self, forKey: .emergencyContact)
        profileSharedWithTrip = try container.decodeIfPresent(Bool.self, forKey: .profileSharedWithTrip) ?? false
        isHost = try container.decode(Bool.self, forKey: .isHost)
        amountOwed = try container.decode(Double.self, forKey: .amountOwed)
        amountPaid = try container.decode(Double.self, forKey: .amountPaid)
        paidAt = try container.decodeIfPresent(String.self, forKey: .paidAt)
        promptpayValue = try container.decodeIfPresent(String.self, forKey: .promptpayValue)
        qrImageUrl = try container.decodeIfPresent(String.self, forKey: .qrImageUrl)
        createdAt = try container.decode(String.self, forKey: .createdAt)
    }

    var isPaid: Bool { paidAt != nil || amountPaid >= amountOwed }
    var remaining: Double { max(0, amountOwed - amountPaid) }
}

/// Per-expense split method — each `trip_expenses` row picks its own, so one
/// trip can have an "equal" hotel split and a "shares" boat-trip split.
/// Mirrors web/src/lib/trip-settlement.ts's `SplitMode`.
enum TripSplitMode: String, Codable, CaseIterable {
    case equal, individual, percent, shares

    var label: String {
        switch self {
        case .equal:      return "หารเท่ากัน"
        case .individual: return "ระบุจำนวนเอง"
        case .percent:    return "ระบุเปอร์เซ็นต์"
        case .shares:     return "ตามจำนวนหุ้น"
        }
    }
}

struct ExpenseSplit: Codable, Identifiable {
    var id: String { participantId }
    let participantId: String
    let amount: Double
    let isPaid: Bool

    enum CodingKeys: String, CodingKey {
        case participantId = "participant_id"
        case amount
        case isPaid = "is_paid"
    }
}

struct TripExpense: Codable, Identifiable {
    let id: String
    let journeyId: String
    let title: String
    /// What was actually charged, in `currency` — NOT necessarily the trip's
    /// currency. Never render this with a ฿ in front of it; use `baseAmount`.
    let amount: Double
    /// Currency of `amount` (migration 073). Absent on rows written before it.
    let currency: String?
    /// 1 unit of `currency` = this many units of the trip's base currency.
    let exchangeRate: Double?
    /// `amount * exchangeRate` — the trip-currency figure. The only one that is
    /// safe to total, and the only one safe to show with a ฿.
    let amountBaseCurrency: Double?
    let category: String?
    let paidById: String?
    let splitMode: String?
    /// Raw per-participant input (exact amount / percent / share count) —
    /// resolved per-person amounts actually owed live in `expenseSplits`.
    let splitValues: [String: Double]?
    let createdAt: String
    var expenseSplits: [ExpenseSplit]?
    /// Per-item breakdown, when one was entered or scanned.
    var items: [TripExpenseItem]?

    enum CodingKeys: String, CodingKey {
        case id, title, amount, category, currency
        case journeyId = "journey_id"
        case exchangeRate = "exchange_rate"
        case amountBaseCurrency = "amount_base_currency"
        case paidById = "paid_by_id"
        case splitMode = "split_mode"
        case splitValues = "split_values"
        case createdAt = "created_at"
        case expenseSplits = "expense_splits"
        case items = "trip_expense_items"
    }

    var splitModeLabel: String {
        TripSplitMode(rawValue: splitMode ?? "equal")?.label ?? (splitMode ?? "equal")
    }

    /// The figure to display and to total, in the trip's base currency.
    ///
    /// Falls back to `amount` only for rows written before migration 073, where
    /// the two were the same thing by definition. For anything newer, `amount`
    /// can be yen and this is baht — the iOS app was showing "฿35,600" for a
    /// ¥35,600 shinkansen ticket because it rendered `amount` directly.
    var baseAmount: Double { amountBaseCurrency ?? amount }

    /// "¥35,600" when the receipt was in another currency, nil when it was not —
    /// so callers can print it alongside the baht figure or skip the line.
    func originalAmount(tripCurrency: String) -> String? {
        guard let currency, currency != tripCurrency, amount > 0 else { return nil }
        let n = amount.formatted(.number.precision(.fractionLength(0)))
        return currency == "JPY" ? "¥\(n)" : "\(n) \(currency)"
    }
}

/// One leg of the net settlement plan — "from pays to, this much" — computed
/// server-side by the `calculate_trip_settlement` Postgres function (a
/// greedy min-cash-flow sweep over everyone's net paid-vs-owed balance).
struct TripSettlement: Codable, Identifiable {
    var id: String { "\(fromId)-\(toId)" }
    let fromId: String
    let fromName: String
    let toId: String
    let toName: String
    let amount: Double

    enum CodingKeys: String, CodingKey {
        case fromId = "from_id"
        case fromName = "from_name"
        case toId = "to_id"
        case toName = "to_name"
        case amount
    }
}

struct TripPayment: Codable, Identifiable {
    let id: String
    let journeyId: String
    let fromParticipant: String
    let toParticipant: String
    let amount: Double
    let status: String
    let note: String?
    let paidAt: String

    enum CodingKeys: String, CodingKey {
        case id, amount, status, note
        case journeyId = "journey_id"
        case fromParticipant = "from_participant"
        case toParticipant = "to_participant"
        case paidAt = "paid_at"
    }
}

/// A trip checklist entry — supabase/migrations/20260822120000_trip_journey_structure.sql.
struct TripChecklistItem: Codable, Identifiable {
    let id: String
    let journeyId: String?
    let title: String
    let category: String?
    var isDone: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id, title, category
        case journeyId = "journey_id"
        case isDone = "is_done"
        case sortOrder = "sort_order"
    }
}

/// A free-text note attached to a trip.
struct TripNote: Codable, Identifiable {
    let id: String
    let journeyId: String?
    let title: String
    let body: String?
    let tag: String?
    let isPinned: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, body, tag
        case journeyId = "journey_id"
        case isPinned = "is_pinned"
    }
}

/// One line of a trip expense — supabase/migrations/20260824090000_trip_expense_items.sql.
///
/// `amount` is in the PARENT EXPENSE's currency, never the trip base. There is
/// one conversion per expense and it lives on the expense row.
struct TripExpenseItem: Codable, Identifiable {
    let id: String
    let sortOrder: Int
    let description: String
    let quantity: Double?
    let unitPrice: Double?
    let amount: Double

    enum CodingKeys: String, CodingKey {
        case id, description, quantity, amount
        case sortOrder = "sort_order"
        case unitPrice = "unit_price"
    }
}

/// A trip document — itinerary scan, passport, insurance, ticket, hotel
/// confirmation. Store-and-view only, no extraction — see
/// 20260824160000_trip_documents_photos_checkin.sql. Lives in the PRIVATE
/// trip-documents bucket, unlike TripPhoto's public one.
enum TripDocumentKind: String, Codable, CaseIterable {
    case itinerary, passport, visa, insurance, ticket, hotel, other

    var label: String {
        switch self {
        case .itinerary:  return "ตั๋ว/ใบจอง"
        case .passport:   return "พาสปอร์ต"
        case .visa:       return "วีซ่า"
        case .insurance:  return "ประกันเดินทาง"
        case .ticket:     return "ตั๋ว"
        case .hotel:      return "ที่พัก"
        case .other:      return "อื่นๆ"
        }
    }
}

struct TripDocument: Codable, Identifiable {
    let id: String
    let kind: TripDocumentKind
    let title: String
    let filePath: String
    let fileType: String
    let fileSize: Int?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title
        case filePath = "file_path"
        case fileType = "file_type"
        case fileSize = "file_size"
        case createdAt = "created_at"
    }
}

/// A check-in photo — 20260824160000_trip_documents_photos_checkin.sql.
/// `itemId` nil means a general trip photo, not tied to one stop.
struct TripPhoto: Codable, Identifiable {
    let id: String
    let itemId: String?
    let storagePath: String
    let caption: String?
    let takenAt: String

    enum CodingKeys: String, CodingKey {
        case id, caption
        case itemId = "item_id"
        case storagePath = "storage_path"
        case takenAt = "taken_at"
    }
}
