import SwiftUI
import Supabase

struct VatMonth {
    let year: Int
    let month: Int
    let inputVat: Double
    let inputBase: Double
    let outputVat: Double
    let outputBase: Double
    var netVat: Double { (outputVat - inputVat).rounded(toPlaces: 2) }
    let dueDate: String?
}

struct WhtItem: Identifiable {
    var id: String { "\(date)-\(payer)-\(amount)" }
    let date: String
    let payer: String
    let amount: Double
    let rate: Double
    let tax: Double
}


/// Replicates `/api/tax/vat` and `/api/tax/wht`'s Supabase-fallback computation
/// (see `web/src/app/api/tax/{vat,wht}/route.ts`) by querying the same
/// `documents` table directly — keeping the iOS app on the same source of truth.
@MainActor
final class TaxViewModel: ObservableObject {
    @Published var vat: VatMonth?
    @Published var whtItems: [WhtItem] = []
    @Published var whtTotalBase: Double = 0
    @Published var whtTotalTax: Double = 0
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    private struct DocVatRow: Decodable {
        let vat_amount: Double?
        let total_amount: Double?
    }
    private struct DocWhtRow: Decodable {
        let doc_date: String?
        let vendor_name: String?
        let total_amount: Double?
        let wht_rate: Double?
        let wht_amount: Double?
    }

    func load(orgId: String, year: Int, month: Int) async {
        isLoading = true
        defer { isLoading = false }
        async let vatTask: Void = loadVat(orgId: orgId, year: year, month: month)
        async let whtTask: Void = loadWht(orgId: orgId, year: year, month: month)
        _ = await (vatTask, whtTask)
    }

    private func monthRange(year: Int, month: Int) -> (from: String, to: String) {
        let from = String(format: "%04d-%02d-01", year, month)
        var comps = DateComponents()
        comps.year = year; comps.month = month + 1; comps.day = 0
        let cal = Calendar(identifier: .gregorian)
        let lastDay = cal.date(from: comps).flatMap { cal.component(.day, from: $0) } ?? 28
        let to = String(format: "%04d-%02d-%02d", year, month, lastDay)
        return (from, to)
    }

    private func loadVat(orgId: String, year: Int, month: Int) async {
        let (from, to) = monthRange(year: year, month: month)
        do {
            async let inputRows: [DocVatRow] = db
                .from("documents")
                .select("vat_amount,total_amount")
                .eq("organization_id", value: orgId)
                .in("doc_type", values: ["expense", "receipt"])
                .eq("vat_claimable", value: true)
                .gte("doc_date", value: from)
                .lte("doc_date", value: to)
                .not("vat_amount", operator: .is, value: "null")
                .execute().value

            async let outputRows: [DocVatRow] = db
                .from("documents")
                .select("vat_amount,total_amount")
                .eq("organization_id", value: orgId)
                .in("doc_type", values: ["invoice", "tax_invoice", "tax_invoice_full", "tax_invoice_simplified"])
                .gte("doc_date", value: from)
                .lte("doc_date", value: to)
                .not("vat_amount", operator: .is, value: "null")
                .execute().value

            let inRows = try await inputRows
            let outRows = try await outputRows

            let inputVat  = inRows.reduce(0) { $0 + ($1.vat_amount ?? 0) }
            let inputBase = inRows.reduce(0) { $0 + (($1.total_amount ?? 0) - ($1.vat_amount ?? 0)) }
            let outVat    = outRows.reduce(0) { $0 + ($1.vat_amount ?? 0) }
            let outBase   = outRows.reduce(0) { $0 + (($1.total_amount ?? 0) - ($1.vat_amount ?? 0)) }

            // PP.30 due date = 15th of following month
            var comps = DateComponents()
            comps.year = year; comps.month = month + 1; comps.day = 15
            let cal = Calendar(identifier: .gregorian)
            let dueStr: String?
            if let due = cal.date(from: comps) {
                let f = DateFormatter()
                f.dateFormat = "yyyy-MM-dd"
                dueStr = f.string(from: due)
            } else { dueStr = nil }

            vat = VatMonth(
                year: year, month: month,
                inputVat: inputVat.rounded(toPlaces: 2), inputBase: inputBase.rounded(toPlaces: 2),
                outputVat: outVat.rounded(toPlaces: 2), outputBase: outBase.rounded(toPlaces: 2),
                dueDate: dueStr
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadWht(orgId: String, year: Int, month: Int) async {
        let (from, to) = monthRange(year: year, month: month)
        do {
            let rows: [DocWhtRow] = try await db
                .from("documents")
                .select("doc_date,vendor_name,total_amount,wht_rate,wht_amount")
                .eq("organization_id", value: orgId)
                .gte("doc_date", value: from)
                .lte("doc_date", value: to)
                .not("wht_amount", operator: .is, value: "null")
                .gt("wht_amount", value: 0)
                .order("doc_date", ascending: false)
                .execute().value

            let items = rows.map {
                WhtItem(date: $0.doc_date ?? "",
                        payer: $0.vendor_name ?? "ไม่ระบุ",
                        amount: $0.total_amount ?? 0,
                        rate: $0.wht_rate ?? 0,
                        tax: $0.wht_amount ?? 0)
            }
            whtItems = items
            whtTotalBase = items.reduce(0) { $0 + $1.amount }
            whtTotalTax  = items.reduce(0) { $0 + $1.tax }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
