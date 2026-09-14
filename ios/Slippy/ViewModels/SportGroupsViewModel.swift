import SwiftUI
import Supabase

/// Mirrors `web/src/app/liff/sport/page.tsx`'s data flow — recurring
/// `sport_groups` template → auto-generated `split_bills` sessions
/// (category="sport") → roster/payment via `split_participants` →
/// itemized `session_expenses`. Native Supabase calls replace the LIFF
/// page's `/api/liff/sport-groups/*` routes since mobile users are already
/// Supabase-authenticated (no LINE userId matching needed).
@MainActor
final class SportGroupsViewModel: ObservableObject {
    @Published var groups: [SportGroup] = []
    @Published var standaloneSessions: [SplitBill] = []
    @Published var groupSessions: [SplitBill] = []
    @Published var sessionExpenses: [SessionExpense] = []
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    // MARK: – Groups list

    func load(orgId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            groups = try await db
                .from("sport_groups")
                .select()
                .eq("organization_id", value: orgId)
                .eq("status", value: "active")
                .order("created_at", ascending: false)
                .execute()
                .value

            standaloneSessions = try await db
                .from("split_bills")
                .select("*, split_participants(*)")
                .eq("organization_id", value: orgId)
                .eq("category", value: "sport")
                .filter("sport_group_id", operator: "is", value: "null")
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createGroup(
        orgId: String, userId: String, title: String, sportType: String,
        venue: String?, mapUrl: String?, recurringDays: [Int],
        startTime: String?, endTime: String?, courtNo: String?,
        maxPlayers: Int?, promptpayId: String?
    ) async -> SportGroup? {
        struct GroupInsert: Encodable {
            let organization_id: String
            let creator_id: String
            let title: String
            let sport_type: String
            let default_venue: String?
            let default_map_url: String?
            let recurring_days: [Int]
            let default_start_time: String?
            let default_end_time: String?
            let default_court_no: String?
            let max_players: Int?
            let promptpay_id: String?
        }
        do {
            let inserted: [SportGroup] = try await db
                .from("sport_groups")
                .insert(GroupInsert(
                    organization_id: orgId, creator_id: userId, title: title,
                    sport_type: sportType, default_venue: venue, default_map_url: mapUrl,
                    recurring_days: recurringDays, default_start_time: startTime,
                    default_end_time: endTime, default_court_no: courtNo,
                    max_players: maxPlayers, promptpay_id: promptpayId
                ))
                .select()
                .execute()
                .value
            guard let group = inserted.first else { return nil }

            if !recurringDays.isEmpty {
                await generateUpcomingSessions(for: group, weeksAhead: 4)
            }
            return group
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    /// Auto-generates dated `split_bills` sessions for each recurring weekday
    /// over the next N weeks — same behaviour as the LIFF create-group flow.
    private func generateUpcomingSessions(for group: SportGroup, weeksAhead: Int) async {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        var dates: [Date] = []
        for offset in 0..<(weeksAhead * 7) {
            guard let date = cal.date(byAdding: .day, value: offset, to: today) else { continue }
            let weekday = cal.component(.weekday, from: date) - 1 // 0=Sunday, matches recurring_days
            if group.recurringDays.contains(weekday) { dates.append(date) }
        }
        guard !dates.isEmpty else { return }

        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        struct SessionInsert: Encodable {
            let organization_id: String
            let creator_id: String
            let title: String
            let category: String
            let sport_type: String?
            let venue: String?
            let map_url: String?
            let sport_group_id: String
            let booking_date: String
            let start_time: String?
            let end_time: String?
            let court_no: String?
            let max_players: Int?
            let promptpay_id: String?
            let total_amount: Double
        }
        let records = dates.map { date in
            SessionInsert(
                organization_id: group.organizationId, creator_id: group.creatorId,
                title: group.title, category: "sport", sport_type: group.sportType,
                venue: group.defaultVenue, map_url: group.defaultMapUrl,
                sport_group_id: group.id, booking_date: fmt.string(from: date),
                start_time: group.defaultStartTime, end_time: group.defaultEndTime,
                court_no: group.defaultCourtNo, max_players: group.maxPlayers,
                promptpay_id: group.promptpayId, total_amount: 0
            )
        }
        _ = try? await db.from("split_bills").insert(records).execute()
    }

    func deleteGroup(id: String) async -> Bool {
        do {
            try await db.from("sport_groups").delete().eq("id", value: id).execute()
            groups.removeAll { $0.id == id }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteSession(id: String) async -> Bool {
        do {
            try await db.from("split_bills").delete().eq("id", value: id).execute()
            groupSessions.removeAll { $0.id == id }
            standaloneSessions.removeAll { $0.id == id }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: – Group-detail: sessions list

    func loadGroupSessions(groupId: String) async {
        do {
            groupSessions = try await db
                .from("split_bills")
                .select("*, split_participants(*)")
                .eq("sport_group_id", value: groupId)
                .order("booking_date", ascending: true)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// - Parameter userId: the *current* user creating the session — must match
    ///   `auth.uid()` for the `split_bills_insert` RLS policy (`creator_id = auth.uid()`).
    ///   Using the recurring group's original creator here would fail whenever
    ///   any other org member adds a one-off session.
    func addSession(group: SportGroup, userId: String, bookingDate: String) async -> SplitBill? {
        struct SessionInsert: Encodable {
            let organization_id: String
            let creator_id: String
            let title: String
            let category: String
            let sport_type: String?
            let venue: String?
            let map_url: String?
            let sport_group_id: String
            let booking_date: String
            let start_time: String?
            let end_time: String?
            let court_no: String?
            let max_players: Int?
            let promptpay_id: String?
            let total_amount: Double
        }
        do {
            let inserted: [SplitBill] = try await db
                .from("split_bills")
                .insert(SessionInsert(
                    organization_id: group.organizationId, creator_id: userId,
                    title: group.title, category: "sport", sport_type: group.sportType,
                    venue: group.defaultVenue, map_url: group.defaultMapUrl,
                    sport_group_id: group.id, booking_date: bookingDate,
                    start_time: group.defaultStartTime, end_time: group.defaultEndTime,
                    court_no: group.defaultCourtNo, max_players: group.maxPlayers,
                    promptpay_id: group.promptpayId, total_amount: 0
                ))
                .select("*, split_participants(*)")
                .execute()
                .value
            guard let session = inserted.first else { return nil }
            groupSessions.append(session)
            return session
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    // MARK: – Session-detail: roster / payment

    /// Re-splits `bill.totalAmount` evenly across participants, weighted by
    /// `1 + guestCount` per person (the "+1" guest pattern) — same algorithm
    /// as the LIFF page recomputes after every join/leave/guest-count change.
    func recomputeEvenSplit(bill: SplitBill) async -> SplitBill {
        guard let participants = bill.participants, !participants.isEmpty else { return bill }
        let totalWeight = participants.reduce(0.0) { $0 + Double(1 + $1.effectiveGuestCount) }
        guard totalWeight > 0 else { return bill }
        let perWeight = bill.totalAmount / totalWeight

        var updated = bill
        var newParticipants: [SplitParticipant] = []
        for p in participants {
            let amount = (perWeight * Double(1 + p.effectiveGuestCount) * 100).rounded() / 100
            do {
                try await db.from("split_participants")
                    .update(["amount": amount])
                    .eq("id", value: p.id)
                    .execute()
            } catch { /* best-effort — UI still reflects locally */ }
            var np = p
            np = SplitParticipant(
                id: p.id, splitBillId: p.splitBillId, name: p.name, email: p.email,
                amount: amount, paidAt: p.paidAt, createdAt: p.createdAt,
                guestCount: p.guestCount, paymentProofUrl: p.paymentProofUrl,
                addedByParticipantId: p.addedByParticipantId
            )
            newParticipants.append(np)
        }
        updated.participants = newParticipants
        return updated
    }

    func join(bill: SplitBill, name: String, email: String) async -> SplitBill? {
        if bill.participants?.first(where: { $0.email?.lowercased() == email.lowercased() }) != nil {
            return bill
        }
        return await addParticipant(bill: bill, name: name, email: email)
    }

    /// Host-driven add — from an in-app friend, a manual guest name (no
    /// account yet), or the system/org-member picker. `email` is optional
    /// since manually-typed guests have none. `addedBy` is the inviting
    /// participant's row id — when set, the new row is nested under them
    /// in the roster tree (058's `added_by_participant_id`).
    func addParticipant(bill: SplitBill, name: String, email: String?, addedBy: String? = nil) async -> SplitBill? {
        struct ParticipantInsert: Encodable {
            let split_bill_id: String
            let name: String
            let email: String?
            let amount: Double
            let added_by_participant_id: String?
        }
        do {
            let inserted: [SplitParticipant] = try await db
                .from("split_participants")
                .insert(ParticipantInsert(split_bill_id: bill.id, name: name, email: email, amount: 0, added_by_participant_id: addedBy))
                .select()
                .execute()
                .value
            var updated = bill
            updated.participants = (bill.participants ?? []) + inserted
            updated = await recomputeEvenSplit(bill: updated)
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func setGuestCount(bill: SplitBill, participantId: String, count: Int) async -> SplitBill? {
        do {
            try await db.from("split_participants")
                .update(["guest_count": count])
                .eq("id", value: participantId)
                .execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: p.amount, paidAt: p.paidAt,
                                         createdAt: p.createdAt, guestCount: count,
                                         paymentProofUrl: p.paymentProofUrl,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return await recomputeEvenSplit(bill: updated)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func setAmount(bill: SplitBill, participantId: String, amount: Double) async -> SplitBill? {
        do {
            try await db.from("split_participants")
                .update(["amount": amount])
                .eq("id", value: participantId)
                .execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: amount, paidAt: p.paidAt,
                                         createdAt: p.createdAt, guestCount: p.guestCount,
                                         paymentProofUrl: p.paymentProofUrl,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func markPaid(bill: SplitBill, participantId: String) async -> SplitBill? {
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let now = iso.string(from: Date())
        do {
            try await db.from("split_participants").update(["paid_at": now])
                .eq("id", value: participantId).execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: p.amount, paidAt: now,
                                         createdAt: p.createdAt, guestCount: p.guestCount,
                                         paymentProofUrl: p.paymentProofUrl,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func unpay(bill: SplitBill, participantId: String) async -> SplitBill? {
        do {
            try await db.from("split_participants")
                .update(["paid_at": Optional<String>.none])
                .eq("id", value: participantId).execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: p.amount, paidAt: nil,
                                         createdAt: p.createdAt, guestCount: p.guestCount,
                                         paymentProofUrl: p.paymentProofUrl,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func uploadProof(bill: SplitBill, participantId: String, imageData: Data) async -> SplitBill? {
        let path = "\(bill.id)/\(participantId).jpg"
        do {
            try await db.storage.from("payment-proofs")
                .upload(path, data: imageData, options: .init(contentType: "image/jpeg", upsert: true))
            let url = try db.storage.from("payment-proofs").getPublicURL(path: path).absoluteString
            try await db.from("split_participants")
                .update(["payment_proof_url": url])
                .eq("id", value: participantId).execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: p.amount, paidAt: p.paidAt,
                                         createdAt: p.createdAt, guestCount: p.guestCount,
                                         paymentProofUrl: url,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func reviewPayment(bill: SplitBill, participantId: String, approve: Bool) async -> SplitBill? {
        if approve { return await markPaid(bill: bill, participantId: participantId) }
        do {
            try await db.from("split_participants")
                .update(["payment_proof_url": Optional<String>.none])
                .eq("id", value: participantId).execute()
            var updated = bill
            updated.participants = bill.participants?.map { p in
                guard p.id == participantId else { return p }
                return SplitParticipant(id: p.id, splitBillId: p.splitBillId, name: p.name,
                                         email: p.email, amount: p.amount, paidAt: nil,
                                         createdAt: p.createdAt, guestCount: p.guestCount,
                                         paymentProofUrl: nil,
                                         addedByParticipantId: p.addedByParticipantId)
            }
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    /// Removes a participant from the roster — used for the "ลบเพื่อน" action
    /// on the tree view. Any friends *they* added keep their row (058's
    /// `added_by_participant_id` is ON DELETE SET NULL) and simply resurface
    /// as top-level roster entries instead of being deleted in turn.
    func removeParticipant(bill: SplitBill, participantId: String) async -> SplitBill? {
        do {
            try await db.from("split_participants").delete().eq("id", value: participantId).execute()
            var updated = bill
            updated.participants = bill.participants?.filter { $0.id != participantId }.map { p in
                guard p.addedByParticipantId == participantId else { return p }
                var np = p
                np.addedByParticipantId = nil
                return np
            }
            return await recomputeEvenSplit(bill: updated)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    /// Marks the session "finalized" (closed) — same status the LINE bot's
    /// `/sportdone` flow sets. Once finalized, the LIFF/LINE flows treat the
    /// roster and amounts as locked (no more joins/payment edits).
    func closeSession(bill: SplitBill) async -> SplitBill? {
        do {
            try await db.from("split_bills").update(["status": "finalized"]).eq("id", value: bill.id).execute()
            var updated = bill
            updated.status = "finalized"
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func setPromptPay(billId: String, value: String) async -> Bool {
        do {
            try await db.from("split_bills")
                .update(["promptpay_id": value])
                .eq("id", value: billId).execute()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: – Expenses

    func loadExpenses(billId: String) async {
        do {
            sessionExpenses = try await db
                .from("session_expenses")
                .select()
                .eq("split_bill_id", value: billId)
                .order("created_at", ascending: true)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Adds an expense, recomputes the session's total fee as the sum of all
    /// expenses, then re-splits it evenly across the roster.
    func addExpense(bill: SplitBill, category: String, label: String?, amount: Double) async -> SplitBill? {
        struct ExpenseInsert: Encodable { let split_bill_id: String; let category: String; let label: String?; let amount: Double }
        do {
            try await db.from("session_expenses")
                .insert(ExpenseInsert(split_bill_id: bill.id, category: category, label: label, amount: amount))
                .execute()
            await loadExpenses(billId: bill.id)
            return await applyExpensesTotal(bill: bill)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func deleteExpense(bill: SplitBill, expenseId: String) async -> SplitBill? {
        do {
            try await db.from("session_expenses").delete().eq("id", value: expenseId).execute()
            await loadExpenses(billId: bill.id)
            return await applyExpensesTotal(bill: bill)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    private func applyExpensesTotal(bill: SplitBill) async -> SplitBill {
        let total = sessionExpenses.reduce(0.0) { $0 + $1.amount }
        do {
            try await db.from("split_bills").update(["total_amount": total]).eq("id", value: bill.id).execute()
        } catch { /* best-effort */ }
        var updated = bill
        updated = SplitBill(
            id: bill.id, organizationId: bill.organizationId, creatorId: bill.creatorId,
            title: bill.title, totalAmount: total, note: bill.note, shareToken: bill.shareToken,
            lineGroupId: bill.lineGroupId, status: bill.status, createdAt: bill.createdAt,
            participants: bill.participants, category: bill.category, sportType: bill.sportType,
            venue: bill.venue, bookingDate: bill.bookingDate, startTime: bill.startTime,
            endTime: bill.endTime, courtNo: bill.courtNo, mapUrl: bill.mapUrl,
            maxPlayers: bill.maxPlayers, promptpayId: bill.promptpayId,
            extraNotes: bill.extraNotes, sportGroupId: bill.sportGroupId
        )
        return await recomputeEvenSplit(bill: updated)
    }
}
