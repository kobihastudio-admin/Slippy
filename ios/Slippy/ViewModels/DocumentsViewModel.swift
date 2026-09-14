import SwiftUI
import Supabase

/// Period the document list is scoped to.
///
/// `.all` was missing entirely at first — day/month were the only choices,
/// with no way to see every document at once. Since the list opens on
/// whichever single day happens to hold the most recent document, that read
/// as "I only have one receipt" when there were really dozens sitting on
/// other days nothing pointed you toward.
enum DocumentPeriod: String, CaseIterable {
    case day, month, all

    var label: String {
        switch self {
        case .day:   return "รายวัน"
        case .month: return "รายเดือน"
        case .all:   return "ทั้งหมด"
        }
    }
}

@MainActor
final class DocumentsViewModel: ObservableObject {
    @Published var documents: [SlippyDocument] = []
    @Published var searchText  = ""
    @Published var filterStatus: String? = nil
    @Published var isLoading   = false
    @Published var error: String?

    /// Which slice of time the list shows, and which slice.
    @Published var period: DocumentPeriod = .day
    @Published var anchor: Date = Date()

    private let db = SupabaseManager.shared.client
    private var orgId = ""

    // MARK: – Period window

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c
    }

    /// Half-open [start, end) for the current period, in local time — nil for
    /// `.all`, which has no window to compute and reads as "don't filter".
    var window: (start: Date, end: Date)? {
        let cal = calendar
        switch period {
        case .day:
            let start = cal.startOfDay(for: anchor)
            return (start, cal.date(byAdding: .day, value: 1, to: start)!)
        case .month:
            let start = cal.date(from: cal.dateComponents([.year, .month], from: anchor))!
            return (start, cal.date(byAdding: .month, value: 1, to: start)!)
        case .all:
            return nil
        }
    }

    /// "16 ส.ค. 2569" or "ส.ค. 2569" — Thai locale renders the Buddhist year.
    var periodLabel: String {
        if period == .all { return "ทั้งหมด" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "th_TH")
        f.setLocalizedDateFormatFromTemplate(period == .day ? "dMMMy" : "MMMy")
        return f.string(from: anchor)
    }

    /// Also gates the stepper's "next" arrow — `.all` has nothing to step
    /// through, so it is reported as "current" to keep that arrow disabled
    /// rather than paging a date that is not even shown.
    var isCurrentPeriod: Bool {
        guard period != .all else { return true }
        return calendar.isDate(anchor, equalTo: Date(),
                                toGranularity: period == .day ? .day : .month)
    }

    func step(_ direction: Int) {
        guard period != .all else { return }
        let cal = calendar
        let unit: Calendar.Component = period == .day ? .day : .month
        guard let moved = cal.date(byAdding: unit, value: direction, to: anchor) else { return }
        // Never page into the future — there is nothing there, and an empty
        // screen with no explanation reads as a bug.
        if moved > Date() && direction > 0 { return }
        anchor = moved
        Task { await fetch() }
    }

    func setPeriod(_ p: DocumentPeriod) {
        period = p
        Task { await fetch() }
    }

    // MARK: – Grouping and totals

    /// Documents bucketed by the day they belong to, newest day first.
    ///
    /// Buckets on the document's OWN date, not on when it was uploaded: a
    /// receipt scanned today for a purchase last month belongs to last month.
    /// Uploads with no readable date fall back to the upload day so they stay
    /// visible instead of silently vanishing from every period.
    var days: [(date: Date, documents: [SlippyDocument])] {
        let cal = calendar
        let buckets = Dictionary(grouping: documents) { cal.startOfDay(for: $0.effectiveDate) }
        return buckets
            .map { (date: $0.key, documents: $0.value.sorted { $0.createdAt > $1.createdAt }) }
            .sorted { $0.date > $1.date }
    }

    struct Summary {
        var count = 0
        var total = 0.0
        var vat   = 0.0
        /// Documents still awaiting review — the number that means "not done yet".
        var pending = 0
        /// Read wrong or flagged — the number that means "go look at these".
        var needsFix = 0
        var duplicates = 0
    }

    var summary: Summary {
        documents.reduce(into: Summary()) { s, d in
            s.count += 1
            s.total += d.totalAmount ?? 0
            s.vat   += d.vatAmount ?? 0
            if d.status == "reviewing" || d.status == "processing" { s.pending += 1 }
            if d.needsCorrection      { s.needsFix += 1 }
            if d.isDuplicateDocument  { s.duplicates += 1 }
        }
    }

    func dayTotal(_ docs: [SlippyDocument]) -> Double {
        docs.reduce(0) { $0 + ($1.totalAmount ?? 0) }
    }

    // MARK: – Loading

    func load(orgId: String) async {
        self.orgId = orgId
        // Open on the most recent period that actually holds documents.
        //
        // Anchoring on today looks obvious and is usually wrong here: a
        // document is filed under the date PRINTED on it, and people scan a
        // week's receipts in one sitting. Three receipts uploaded this morning
        // are dated 24 Jul, 25 Jul and 21 Sep — so "today" is empty, and an
        // empty screen right after a successful upload reads as data loss.
        // DashboardViewModel anchors its month cards the same way, for the
        // same reason.
        if let latest = await mostRecentDocumentDate() { anchor = latest }
        await fetch()
    }

    /// Effective date of the newest document, or nil when the org has none.
    /// Never throws — failing here just means we open on today.
    private func mostRecentDocumentDate() async -> Date? {
        struct Row: Decodable { let doc_date: String?; let created_at: String }
        do {
            let rows: [Row] = try await db
                .from("documents")
                .select("doc_date,created_at")
                .eq("organization_id", value: orgId)
                .neq("status", value: "rejected")
                .order("doc_date", ascending: false, nullsFirst: false)
                .limit(1)
                .execute()
                .value
            guard let r = rows.first else { return nil }
            if let d = r.doc_date {
                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
                if let parsed = f.date(from: d) { return parsed }
            }
            return ISO8601DateFormatter.withFractional.date(from: r.created_at)
                ?? ISO8601DateFormatter.plain.date(from: r.created_at)
        } catch {
            return nil
        }
    }

    func applyFilter(status: String?) async {
        filterStatus = status
        await fetch()
    }

    func search(query: String) async {
        searchText = query
        await fetch()
    }

    /// Mirrors DashboardViewModel.deleteDocument — hard-deletes and removes
    /// it from the local list optimistically.
    func deleteDocument(_ doc: SlippyDocument) async -> Bool {
        do {
            try await db
                .from("documents")
                .delete()
                .eq("id", value: doc.id)
                .execute()
            documents.removeAll { $0.id == doc.id }
            return true
        } catch {
            self.error = "ลบเอกสารไม่สำเร็จ: \(error.localizedDescription)"
            return false
        }
    }

    private func fetch() async {
        isLoading = true
        defer { isLoading = false }
        do {
            var query = db
                .from("documents")
                .select()
                .eq("organization_id", value: orgId)

            // `.all` has no window — every document for the org, unfiltered by
            // date, which is the whole point of the mode.
            if let (start, end) = window {
                let dayFmt = DateFormatter()
                dayFmt.dateFormat = "yyyy-MM-dd"
                let startDay = dayFmt.string(from: start)
                let endDay   = dayFmt.string(from: end)
                let startTs  = ISO8601DateFormatter().string(from: start)
                let endTs    = ISO8601DateFormatter().string(from: end)

                // A document belongs to the period by its printed date. Those
                // without one would then never appear in any period at all, so
                // they fall back to when they were uploaded.
                query = query.or("and(doc_date.gte.\(startDay),doc_date.lt.\(endDay))," +
                    "and(doc_date.is.null,created_at.gte.\(startTs),created_at.lt.\(endTs))")
            }

            if let status = filterStatus {
                query = query.eq("status", value: status)
            } else {
                // Documents the server declined as non-financial were never
                // charged for and carry no accounting value — see
                // api/src/pipeline/scope-gate.ts. They stay in the table as an
                // abuse signal, not as something the user has to scroll past.
                query = query.neq("status", value: "rejected")
            }
            if !searchText.isEmpty {
                query = query.ilike("vendor_name", pattern: "%\(searchText)%")
            }

            documents = try await query
                .order("created_at", ascending: false)
                .limit(500)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension SlippyDocument {
    /// The day this document counts against: the date printed on it, or the
    /// day it was uploaded when the print could not be read.
    var effectiveDate: Date {
        if let docDate {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            f.timeZone = .current
            if let d = f.date(from: docDate) { return d }
        }
        return ISO8601DateFormatter.withFractional.date(from: createdAt)
            ?? ISO8601DateFormatter.plain.date(from: createdAt)
            ?? Date()
    }

    /// True when the date shown is the upload date rather than the printed one.
    var dateIsFallback: Bool {
        guard let docDate else { return true }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        return f.date(from: docDate) == nil
    }
}
