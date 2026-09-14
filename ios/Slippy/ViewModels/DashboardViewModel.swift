import SwiftUI
import Supabase

/// Mirrors `web/src/app/(app)/dashboard/page.tsx` field-for-field so the
/// mobile dashboard always shows the same numbers as the web app — same
/// tables, same month-window logic, same Life Score domains.
@MainActor
final class DashboardViewModel: ObservableObject {
    // Recent documents
    @Published var recentDocs: [SlippyDocument] = []

    // Stat cards (matches web statCards exactly)
    @Published var docsThisMonth = 0
    @Published var pendingDocs   = 0
    @Published var totalExpense  = 0.0
    @Published var totalVat      = 0.0
    @Published var docMomText    = "เดือนนี้"
    @Published var docMomColor   = Color.textSecondary
    @Published var spendMomText  = "เดือนนี้"
    @Published var spendMomColor = Color.textSecondary

    /// Label for the period the month-cards actually reflect — "เดือนนี้" when
    /// it's the current month, otherwise the anchored month ("มิ.ย. 2569").
    @Published var periodLabel   = "เดือนนี้"

    // Quota strip
    @Published var docUsed     = 0
    @Published var docQuota    = 50
    @Published var orgPlan     = "free"
    @Published var isUnlimited = false

    // Life Score (4 domains + overall) — supabase/migrations/028_life_score_complete.sql
    @Published var wealthScore    = 0.0
    @Published var lifestyleScore = 0.0
    @Published var journeyScore   = 0.0
    @Published var socialScore    = 0.0
    @Published var overallScore   = 0.0

    // Activity feed — real notifications table
    @Published var notifications: [AppNotification] = []

    // Life Graph: AI insights + top merchants
    @Published var lifeInsights:  [LifeInsight]  = []
    @Published var lifeMerchants: [LifeMerchant] = []

    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    func load(orgId: String, userId: String) async {
        isLoading = true
        defer { isLoading = false }

        let now        = Date()
        let cal        = Calendar.current
        let thisMonth  = cal.date(from: cal.dateComponents([.year, .month], from: now))!

        // Anchor the "month" cards to the most recent month that actually has
        // finalized (approved/pushed) documents. Without this the whole
        // dashboard reads 0 the instant a new calendar month begins with no
        // data yet — even though last month is full. Falls back to the current
        // month when the org has no finalized documents at all.
        let anchor     = (await fetchActiveMonthStart(orgId: orgId)) ?? thisMonth
        let monthStart = isoDate(anchor)
        let monthEnd   = isoDate(cal.date(byAdding: .month, value: 1, to: anchor)!)
        let prevStart  = isoDate(cal.date(byAdding: .month, value: -1, to: anchor)!)

        periodLabel = cal.isDate(anchor, equalTo: thisMonth, toGranularity: .month)
            ? "เดือนนี้"
            : monthYearLabel(anchor)

        async let orgTask     = fetchOrg(orgId: orgId)
        async let docCountT   = fetchCount(orgId: orgId, status: nil)
        async let pendingT    = fetchCount(orgId: orgId, status: "reviewing")
        async let monthExpT   = fetchExpense(orgId: orgId, from: monthStart, to: monthEnd)
        async let prevExpT    = fetchExpense(orgId: orgId, from: prevStart, to: monthStart)
        async let recentT     = fetchRecent(orgId: orgId)
        async let notifT      = fetchNotifications(orgId: orgId, userId: userId)
        async let lifeScoreT  = fetchLifeScore(orgId: orgId)
        async let insightsT   = fetchInsights(orgId: orgId)
        async let merchantsT  = fetchMerchants(orgId: orgId)

        do {
            let (org, totalDocs, pending, monthExp, prevExp, recent, notifs, score, insights, merchants) =
                try await (orgTask, docCountT, pendingT, monthExpT, prevExpT, recentT, notifT, lifeScoreT, insightsT, merchantsT)

            docUsed     = org?.docUsed  ?? 0
            docQuota    = org?.docQuota ?? 50
            orgPlan     = org?.plan ?? "free"
            isUnlimited = docQuota >= 99999

            docsThisMonth = monthExp.count
            pendingDocs   = pending
            totalExpense  = monthExp.total
            totalVat      = monthExp.vat
            _ = totalDocs

            let docMom   = momLabel(cur: Double(monthExp.count), prev: Double(prevExp.count))
            docMomText   = docMom.text;  docMomColor   = docMom.color
            let spendMom = momLabel(cur: monthExp.total, prev: prevExp.total)
            spendMomText = spendMom.text; spendMomColor = spendMom.color

            recentDocs    = recent
            notifications = notifs

            wealthScore    = score?.wealthScore    ?? 0
            lifestyleScore = score?.lifestyleScore ?? 0
            journeyScore   = score?.journeyScore   ?? 0
            socialScore    = score?.socialScore    ?? 0
            overallScore   = score?.overallScore   ?? 0

            lifeInsights  = insights
            lifeMerchants = merchants
        } catch is CancellationError {
            // Pull-to-refresh (or any interrupted reload) cancels this task's
            // children — that's expected, not a failure. Surfacing it as
            // "The operation couldn't be completed (CancellationError)" to
            // the user is just confusing noise.
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Hard-deletes a document and removes it from the local recent list optimistically.
    func deleteDocument(_ doc: SlippyDocument) async -> Bool {
        do {
            try await db
                .from("documents")
                .delete()
                .eq("id", value: doc.id)
                .execute()
            recentDocs.removeAll { $0.id == doc.id }
            return true
        } catch {
            return false
        }
    }

    /// Updates a document's status (approve/reject/etc.) and reflects it in the
    /// local `recentDocs` list. `.select()` lets us detect RLS silently filtering
    /// the row (insufficient role / wrong org) instead of a false "success".
    func updateDocumentStatus(_ doc: SlippyDocument, status: String) async -> Bool {
        do {
            let updated: [SlippyDocument] = try await db
                .from("documents")
                .update(["status": status])
                .eq("id", value: doc.id)
                .select()
                .execute()
                .value
            guard let new = updated.first else {
                // RLS filtered the row out (insufficient role / wrong org) — the
                // request succeeded with 0 rows affected, not a thrown error.
                print("[Dashboard] updateDocumentStatus: 0 rows affected for doc \(doc.id) — likely blocked by RLS (doc_update requires owner/admin/accountant)")
                self.error = "ไม่สามารถเปลี่ยนสถานะได้ — คุณอาจไม่มีสิทธิ์แก้ไขเอกสารนี้"
                return false
            }
            if let idx = recentDocs.firstIndex(where: { $0.id == doc.id }) {
                recentDocs[idx] = new
            }
            return true
        } catch {
            print("[Dashboard] updateDocumentStatus error:", error)
            self.error = "เปลี่ยนสถานะไม่สำเร็จ: \(error.localizedDescription)"
            return false
        }
    }

    // MARK: – Fetch helpers (mirror web queries 1:1)

    private func fetchOrg(orgId: String) async throws -> Organization? {
        let rows: [Organization] = try await db
            .from("organizations")
            .select("id, name, plan, doc_quota, doc_used")
            .eq("id", value: orgId)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    private func fetchCount(orgId: String, status: String?) async throws -> Int {
        struct Row: Decodable { let id: String }
        var query = db.from("documents").select("id").eq("organization_id", value: orgId)
        if let status { query = query.eq("status", value: status) }
        let rows: [Row] = try await query.execute().value
        return rows.count
    }

    private struct ExpenseAgg { let count: Int; let total: Double; let vat: Double }

    private func fetchExpense(orgId: String, from: String, to: String?) async throws -> ExpenseAgg {
        struct Row: Decodable { let total_amount: Double?; let vat_amount: Double? }
        var query = db.from("documents")
            .select("total_amount, vat_amount")
            .eq("organization_id", value: orgId)
            .in("status", values: ["approved", "pushed"])
            .gte("created_at", value: from)
        if let to { query = query.lt("created_at", value: to) }
        let rows: [Row] = try await query.execute().value
        return ExpenseAgg(
            count: rows.count,
            total: rows.compactMap(\.total_amount).reduce(0, +),
            vat:   rows.compactMap(\.vat_amount).reduce(0, +)
        )
    }

    private func fetchRecent(orgId: String) async throws -> [SlippyDocument] {
        try await db
            .from("documents")
            .select()
            .eq("organization_id", value: orgId)
            // A rejected document is one the server declined as non-financial
            // and already refunded the quota for (api/src/pipeline/scope-gate.ts).
            // The row is kept server-side as the abuse signal and to carry the
            // rejection reason, but showing it here would be telling the user
            // about a document that, as far as their accounts go, does not exist.
            .neq("status", value: "rejected")
            .order("created_at", ascending: false)
            .limit(6)
            .execute()
            .value
    }

    private func fetchNotifications(orgId: String, userId: String) async throws -> [AppNotification] {
        try await db
            .from("notifications")
            .select()
            .or("user_id.eq.\(userId),organization_id.eq.\(orgId)")
            .order("created_at", ascending: false)
            .limit(5)
            .execute()
            .value
    }

    private struct LifeScoreRow: Decodable {
        let wealthScore: Double
        let lifestyleScore: Double
        let journeyScore: Double
        let socialScore: Double
        let overallScore: Double
        enum CodingKeys: String, CodingKey {
            case wealthScore = "wealth_score", lifestyleScore = "lifestyle_score"
            case journeyScore = "journey_score", socialScore = "social_score"
            case overallScore = "overall_score"
        }
    }

    private func fetchLifeScore(orgId: String) async throws -> LifeScoreRow? {
        let rows: [LifeScoreRow] = try await db
            .from("life_score_snapshots")
            .select("wealth_score, lifestyle_score, journey_score, social_score, overall_score")
            .eq("organization_id", value: orgId)
            .order("snapshot_date", ascending: false)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    private func fetchInsights(orgId: String) async throws -> [LifeInsight] {
        try await db
            .from("life_insights")
            .select("id, insight_type, title, body")
            .eq("organization_id", value: orgId)
            .eq("is_read", value: false)
            .order("priority", ascending: false)
            .limit(3)
            .execute()
            .value
    }

    private func fetchMerchants(orgId: String) async throws -> [LifeMerchant] {
        try await db
            .from("life_merchants")
            .select("name, category, visit_count, total_spent")
            .eq("organization_id", value: orgId)
            .order("total_spent", ascending: false)
            .limit(4)
            .execute()
            .value
    }

    // MARK: – Helpers

    private func isoDate(_ d: Date) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        return fmt.string(from: d)
    }

    /// Start-of-month for the newest finalized (approved/pushed) document, or
    /// nil if the org has none. Never throws — a failure here just means we fall
    /// back to the current calendar month.
    private func fetchActiveMonthStart(orgId: String) async -> Date? {
        struct Row: Decodable { let created_at: String }
        do {
            let rows: [Row] = try await db
                .from("documents")
                .select("created_at")
                .eq("organization_id", value: orgId)
                .in("status", values: ["approved", "pushed"])
                .order("created_at", ascending: false)
                .limit(1)
                .execute()
                .value
            guard let iso = rows.first?.created_at,
                  let date = parseTimestamp(iso) else { return nil }
            let cal = Calendar.current
            return cal.date(from: cal.dateComponents([.year, .month], from: date))
        } catch {
            return nil
        }
    }

    /// Supabase `created_at` may or may not carry fractional seconds — try both.
    private func parseTimestamp(_ s: String) -> Date? {
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    /// "มิ.ย. 2569" — Thai locale renders the Buddhist year automatically.
    private func monthYearLabel(_ d: Date) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "th_TH")
        fmt.setLocalizedDateFormatFromTemplate("MMMy")
        return fmt.string(from: d)
    }

    private func momLabel(cur: Double, prev: Double) -> (text: String, color: Color) {
        guard prev != 0 else { return ("เดือนนี้", Color.textSecondary) }
        let pct = ((cur - prev) / prev) * 100
        let sign = pct >= 0 ? "+" : ""
        let color: Color = pct >= 0 ? Color(hex: "#10b981") : Color(hex: "#ef4444")
        return ("\(sign)\(String(format: "%.0f", pct))% vs เดือนก่อน", color)
    }
}

// MARK: – Life Graph models (mirror life_insights / life_merchants tables)

struct LifeInsight: Codable, Identifiable {
    let id: String
    let insightType: String
    let title: String
    let body: String

    enum CodingKeys: String, CodingKey {
        case id, title, body
        case insightType = "insight_type"
    }

    var emoji: String {
        switch insightType {
        case "spending": return "📊"
        case "habit":    return "❤️"
        case "anomaly":  return "⚠️"
        default:         return "💡"
        }
    }
}

struct LifeMerchant: Codable {
    let name: String
    let category: String?
    let visitCount: Int
    let totalSpent: Double

    enum CodingKeys: String, CodingKey {
        case name, category
        case visitCount = "visit_count"
        case totalSpent = "total_spent"
    }
}
