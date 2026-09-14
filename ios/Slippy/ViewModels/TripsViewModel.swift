import SwiftUI
import Supabase

@MainActor
final class TripsViewModel: ObservableObject {
    @Published var trips: [Trip] = []
    @Published var settlement: [TripSettlement] = []
    @Published var payments: [TripPayment] = []
    @Published var itineraryDays: [TripItineraryDay] = []
    @Published var tripConversationId: String?
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    private static let tripSelect =
        "*, trip_participants(*), trip_expenses(*, expense_splits(*), trip_expense_items(*))"

    // MARK: – Load

    func load(orgId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // journey_type='trip' scopes this to actual bill-splitting trips —
            // without it, every plain Life Graph entry (event/experience/
            // milestone/business, created via the web app's /life/journey page)
            // shows up here too, with no participants/expenses. Mirrors the same
            // fix in web/src/app/api/trips/route.ts.
            trips = try await db
                .from("life_journeys")
                .select(Self.tripSelect)
                .eq("organization_id", value: orgId)
                .eq("journey_type", value: "trip")
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: – Create Trip

    func createTrip(
        orgId: String,
        userId: String,
        title: String,
        tripType: String,
        eventDate: String?,
        endDate: String? = nil,
        destination: String? = nil,
        venue: String?,
        notes: String?,
        baseCurrency: String = "THB",
        timezone: String = TimeZone.current.identifier
    ) async throws {
        struct Args: Encodable {
            let p_organization_id: String; let p_title: String; let p_trip_type: String
            let p_started_at: String?; let p_ended_at: String?; let p_destination: String?
            let p_venue: String?; let p_notes: String?; let p_base_currency: String; let p_timezone: String
        }
        struct Result: Decodable { let journey_id: String; let conversation_id: String }
        let rows: [Result] = try await db
            .rpc("create_trip_full", params: Args(
                p_organization_id: orgId, p_title: title, p_trip_type: tripType,
                p_started_at: eventDate, p_ended_at: endDate, p_destination: destination,
                p_venue: venue, p_notes: notes, p_base_currency: baseCurrency, p_timezone: timezone
            ))
            .execute()
            .value
        guard rows.first != nil else { throw NSError(domain: "Trip", code: 1, userInfo: [NSLocalizedDescriptionKey: "สร้างทริปไม่สำเร็จ"]) }
    }

    // MARK: – Itinerary

    func loadItinerary(journeyId: String) async {
        do {
            itineraryDays = try await db.from("trip_itinerary_days")
                .select("""
                    id, journey_id, day_number, date, title, city, summary,
                    trip_itinerary_items(
                        id, day_id, sort_order, type, title, subtitle, location, notes,
                        time_from, time_to, status, provider, confirmation_code,
                        lat, lng, end_location, end_lat, end_lng,
                        amount, currency, exchange_rate, amount_base_currency, expense_id,
                        details
                    )
                """)
                .eq("journey_id", value: journeyId).order("day_number", ascending: true)
                .execute().value
            itineraryDays = itineraryDays.map { day in
                var copy = day; copy.items = (day.items ?? []).sorted { $0.sortOrder < $1.sortOrder }; return copy
            }
        } catch { self.error = error.localizedDescription }
    }

    func addItineraryDay(journeyId: String, date: String?, title: String?) async throws {
        struct Row: Encodable { let journey_id: String; let day_number: Int; let date: String?; let title: String? }
        let next = (itineraryDays.map(\.dayNumber).max() ?? 0) + 1
        try await db.from("trip_itinerary_days").insert(Row(journey_id: journeyId, day_number: next, date: date, title: title)).execute()
        await loadItinerary(journeyId: journeyId)
    }

    func addItineraryItem(dayId: String, type: String, title: String, location: String?, timeFrom: String?, notes: String?) async throws {
        struct Row: Encodable { let day_id: String; let sort_order: Int; let type: String; let title: String; let location: String?; let time_from: String?; let notes: String? }
        let current = itineraryDays.first(where: { $0.id == dayId })?.items ?? []
        try await db.from("trip_itinerary_items").insert(Row(day_id: dayId, sort_order: (current.map(\.sortOrder).max() ?? -1) + 1, type: type, title: title, location: location, time_from: timeFrom, notes: notes)).execute()
        if let journeyId = itineraryDays.first(where: { $0.id == dayId })?.journeyId { await loadItinerary(journeyId: journeyId) }
    }

    func removeItineraryItem(_ itemId: String, journeyId: String) async throws {
        try await db.from("trip_itinerary_items").delete().eq("id", value: itemId).execute()
        await loadItinerary(journeyId: journeyId)
    }

    // MARK: – Trip conversation

    func loadTripConversation(journeyId: String) async {
        struct Args: Encodable { let p_journey_id: String }
        do {
            tripConversationId = try await db.rpc("ensure_trip_conversation", params: Args(p_journey_id: journeyId)).execute().value
        } catch { self.error = error.localizedDescription }
    }

    func addFriendToTrip(journeyId: String, friendId: String) async throws {
        struct Args: Encodable { let p_journey_id: String; let p_friend_id: String }
        let _: String = try await db.rpc("add_friend_to_trip", params: Args(p_journey_id: journeyId, p_friend_id: friendId)).execute().value
    }

    /// The travel-facing identity is intentionally stored on the trip member,
    /// not on the account profile: a traveller can use a different role,
    /// contact and photo for each private journey.
    func updateTripProfile(
        participantId: String,
        displayName: String,
        tripRole: String?,
        emergencyContact: String?,
        avatarUrl: String?,
        profileSharedWithTrip: Bool
    ) async throws {
        struct Row: Encodable {
            let display_name: String
            let trip_role: String?
            let emergency_contact: String?
            let avatar_url: String?
            let profile_shared_with_trip: Bool
        }
        struct RowWithoutAvatar: Encodable {
            let display_name: String
            let trip_role: String?
            let emergency_contact: String?
            let profile_shared_with_trip: Bool
        }
        if let avatarUrl {
            try await db.from("trip_participants")
                .update(Row(display_name: displayName, trip_role: tripRole,
                            emergency_contact: emergencyContact, avatar_url: avatarUrl,
                            profile_shared_with_trip: profileSharedWithTrip))
                .eq("id", value: participantId)
                .execute()
        } else {
            // An untouched photo is not a request to erase it.
            try await db.from("trip_participants")
                .update(RowWithoutAvatar(display_name: displayName, trip_role: tripRole,
                                         emergency_contact: emergencyContact,
                                         profile_shared_with_trip: profileSharedWithTrip))
                .eq("id", value: participantId)
                .execute()
        }
    }

    /// Reuses the current LIFF invitation route. Older trips get a token only
    /// after an active participant explicitly taps Share.
    func ensureShareToken(journeyId: String) async throws -> String {
        struct Args: Encodable { let p_journey_id: String }
        return try await db
            .rpc("ensure_trip_share_token", params: Args(p_journey_id: journeyId))
            .execute()
            .value
    }

    // MARK: – Add Expense (multi-payer, per-expense split method)

    /// Adds one expense with its own payer and its own split method —
    /// mirrors web/src/app/api/trips/[id]/expenses (POST) / trip-settlement.ts.
    /// `splitWith` defaults to everyone in `allParticipantIds` when empty.
    /// One line of an expense, as the sheet collects it.
    struct DraftExpenseItem {
        let description: String
        let quantity: Double?
        let unitPrice: Double?
        /// In the expense's currency — never converted. See the migration.
        let amount: Double
    }

    func addExpense(
        journeyId: String,
        paidById: String,
        title: String,
        amount: Double,
        category: String,
        splitMode: TripSplitMode,
        splitWith: [String],
        splitValues: [String: Double],
        allParticipantIds: [String],
        note: String? = nil,
        currency: String = "THB",
        exchangeRate: Double = 1,
        documentId: String? = nil,
        items: [DraftExpenseItem] = []
    ) async throws {
        let participantIds = splitWith.isEmpty ? allParticipantIds : splitWith
        // Splits settle in the trip's base currency (expense_splits feeds
        // trip_participants.amount_owed), so they resolve against the CONVERTED
        // total — not the figure printed on a foreign receipt.
        let baseTotal = (amount * exchangeRate).rounded(toPlaces: 2)
        let resolved = try TripSplitCalculator.resolve(
            totalAmount: baseTotal, participantIds: participantIds,
            splitMode: splitMode, splitValues: splitValues
        )

        struct NewExpense: Encodable {
            let journey_id: String
            let paid_by_id: String
            let title: String
            let amount: Double
            let category: String
            let split_mode: String
            let split_with: [String]
            let split_values: [String: Double]
            let expense_date: String
            let note: String?
            let document_id: String?
            // Migration 073 added these and made amount_base_currency NOT NULL
            // with no default. This insert omitted all three, so every attempt
            // to add an expense from the phone was rejected outright with
            // "null value in column amount_base_currency" — the feature has been
            // broken since that migration shipped, and the failure surfaced as a
            // save that did nothing.
            let currency: String
            let exchange_rate: Double
            let amount_base_currency: Double
        }

        let dateFmt = DateFormatter(); dateFmt.dateFormat = "yyyy-MM-dd"

        let inserted: TripExpense = try await db
            .from("trip_expenses")
            .insert(NewExpense(
                journey_id: journeyId, paid_by_id: paidById, title: title, amount: amount,
                category: category, split_mode: splitMode.rawValue, split_with: participantIds,
                split_values: splitMode == .equal ? [:] : splitValues,
                expense_date: dateFmt.string(from: Date()),
                note: note?.isEmpty == true ? nil : note,
                document_id: documentId,
                currency: currency,
                exchange_rate: exchangeRate,
                amount_base_currency: (amount * exchangeRate).rounded(toPlaces: 2)
            ))
            .select()
            .single()
            .execute()
            .value

        struct NewSplit: Encodable {
            let expense_id: String
            let participant_id: String
            let amount: Double
            let is_paid: Bool
        }

        try await db
            .from("expense_splits")
            .insert(resolved.map { r in
                NewSplit(expense_id: inserted.id, participant_id: r.participantId,
                         amount: r.amount, is_paid: r.participantId == paidById)
            })
            .execute()

        if !items.isEmpty {
            struct NewItem: Encodable {
                let expense_id: String
                let sort_order: Int
                let description: String
                let quantity: Double?
                let unit_price: Double?
                let amount: Double
            }
            // Checked, not fired and forgotten — an expense that silently lost
            // its breakdown looks identical to one that never had one.
            try await db.from("trip_expense_items")
                .insert(items.enumerated().map { index, item in
                    NewItem(expense_id: inserted.id, sort_order: index,
                            description: item.description, quantity: item.quantity,
                            unit_price: item.unitPrice, amount: item.amount)
                })
                .execute()
        }

        await recalculateOwed(journeyId: journeyId)
    }

    /// Recomputes trip_participants.amount_owed/amount_paid from the current
    /// expense_splits rows — same logic as recalculateTripOwed() on web.
    private func recalculateOwed(journeyId: String) async {
        struct SplitRow: Decodable {
            let participant_id: String
            let amount: Double
            let is_paid: Bool
        }
        do {
            let splits: [SplitRow] = try await db
                .from("expense_splits")
                .select("participant_id, amount, is_paid, trip_expenses!inner(journey_id)")
                .eq("trip_expenses.journey_id", value: journeyId)
                .execute()
                .value

            var owed: [String: Double] = [:]
            var paid: [String: Double] = [:]
            for s in splits {
                owed[s.participant_id, default: 0] += s.amount
                if s.is_paid { paid[s.participant_id, default: 0] += s.amount }
            }

            struct OwedPatch: Encodable { let amount_owed: Double; let amount_paid: Double }
            for (pid, amt) in owed {
                try await db.from("trip_participants")
                    .update(OwedPatch(amount_owed: amt, amount_paid: paid[pid] ?? 0))
                    .eq("id", value: pid)
                    .execute()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: – Settlement (net balances, minimal transfers)

    /// Calls the same `calculate_trip_settlement` Postgres function the web
    /// dashboard/LIFF use — one shared source of truth for the settlement math.
    func loadSettlement(journeyId: String) async {
        struct Args: Encodable { let p_journey_id: String }
        do {
            settlement = try await db
                .rpc("calculate_trip_settlement", params: Args(p_journey_id: journeyId))
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadPayments(journeyId: String) async {
        do {
            payments = try await db
                .from("trip_payments")
                .select()
                .eq("journey_id", value: journeyId)
                .order("paid_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func recordPayment(journeyId: String, from: String, to: String, amount: Double, note: String?) async throws {
        struct NewPayment: Encodable {
            let journey_id: String
            let from_participant: String
            let to_participant: String
            let amount: Double
            let note: String?
            let status: String
        }
        try await db.from("trip_payments")
            .insert(NewPayment(journey_id: journeyId, from_participant: from, to_participant: to,
                                amount: amount, note: note, status: "pending"))
            .execute()
        await loadPayments(journeyId: journeyId)
    }

    /// Receiver confirms a pending transfer — bumps the payer's amount_paid.
    func confirmPayment(paymentId: String, fromParticipantId: String, amount: Double, journeyId: String) async throws {
        struct StatusPatch: Encodable { let status: String; let confirmed_at: String }
        let iso = ISO8601DateFormatter()
        try await db.from("trip_payments")
            .update(StatusPatch(status: "confirmed", confirmed_at: iso.string(from: Date())))
            .eq("id", value: paymentId)
            .execute()

        struct PaidRow: Decodable { let amount_paid: Double }
        let row: PaidRow = try await db.from("trip_participants")
            .select("amount_paid").eq("id", value: fromParticipantId).single().execute().value

        struct PaidPatch: Encodable { let amount_paid: Double; let paid_at: String }
        try await db.from("trip_participants")
            .update(PaidPatch(amount_paid: row.amount_paid + amount, paid_at: iso.string(from: Date())))
            .eq("id", value: fromParticipantId)
            .execute()

        await loadPayments(journeyId: journeyId)
        await loadSettlement(journeyId: journeyId)
    }

    // MARK: – Add Participant (host manually rosters someone, no LINE/account needed)

    func addParticipant(journeyId: String, displayName: String, amountOwed: Double) async throws {
        struct NewParticipant: Encodable {
            let journey_id: String
            let display_name: String
            let is_host: Bool
            let amount_owed: Double
            let amount_paid: Double
        }

        try await db
            .from("trip_participants")
            .insert(NewParticipant(
                journey_id: journeyId,
                display_name: displayName,
                is_host: false,
                amount_owed: amountOwed,
                amount_paid: 0
            ))
            .execute()
    }

    // MARK: – Mark Paid (legacy single-bill flow — kept for the old "ยังไม่หารแบบ per-expense" path)

    func markPaid(participantId: String) async throws {
        struct PaidPatch: Encodable {
            let paid_at: String
        }

        let formatter = ISO8601DateFormatter()
        let now = formatter.string(from: Date())

        try await db
            .from("trip_participants")
            .update(PaidPatch(paid_at: now))
            .eq("id", value: participantId)
            .execute()
    }

    // MARK: – Reload single trip

    func reloadTrip(tripId: String, in trips: inout [Trip]) async {
        do {
            let updated: Trip = try await db
                .from("life_journeys")
                .select(Self.tripSelect)
                .eq("id", value: tripId)
                .single()
                .execute()
                .value
            if let idx = trips.firstIndex(where: { $0.id == tripId }) {
                trips[idx] = updated
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
