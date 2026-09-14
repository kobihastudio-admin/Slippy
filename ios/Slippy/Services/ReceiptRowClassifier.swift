import Foundation

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * ReceiptRowClassifier — on-device row classification
 * =====================================================================
 * A lightweight Swift port of the server's `isNonItemRow` heuristics
 * (api/src/pipeline/receipt-rows.ts) so the INSTANT on-device OCR preview
 * (SlipOCRService) stops surfacing rows that aren't real purchasable line
 * items — subtotals, VAT, totals, tender/change, discounts, loyalty points,
 * and metadata (tax id, phone, branch, "thank you", …).
 *
 * The on-device OCR is deliberately cruder than the server (Apple Vision vs
 * Claude), so this can't be perfect — arbitrary place/brand names with no
 * keyword still slip through. The server extraction remains authoritative;
 * this just makes the pre-upload preview readable.
 *
 * Conservative by design: keyword phrases are specific enough not to eat real
 * dish names (e.g. "ข้าวผัดรวมมิตร" must survive despite containing "รวม"), so
 * we match distinctive multi-character phrases, never bare "รวม"/"ยอด".
 */
enum ReceiptRowClassifier {

    /// Distinctive non-item phrases (lower-cased substring match), TH + EN.
    private static let nonItemPhrases: [String] = [
        // ── Totals / subtotals ──────────────────────────────────────────────
        "ยอดรวม", "รวมทั้งสิ้น", "รวมสุทธิ", "รวมเงิน", "ยอดสุทธิ", "ยอดชำระ",
        "ยอดก่อนภาษี", "ก่อนภาษี", "มูลค่าสินค้า", "subtotal", "sub total", "sub-total",
        "grand total", "total", "net total", "amount due", "balance due",
        // ── Tax / VAT ───────────────────────────────────────────────────────
        "ภาษีมูลค่าเพิ่ม", "ภาษีมูลค่า", "vat", "vatable", "ภาษีหัก", "หัก ณ ที่จ่าย",
        "withholding", "wht",
        // ── Tender / payment ────────────────────────────────────────────────
        "เงินสด", "จ่ายโดย", "ชำระโดย", "ชำระเงิน", "รับเงิน", "cash", "received",
        "บัตรเครดิต", "บัตรเดบิต", "credit card", "debit card", "mastercard", "visa",
        "พร้อมเพย์", "promptpay", "โอนเงิน", "transfer", "qr code", "qr payment",
        // ── Change ──────────────────────────────────────────────────────────
        "เงินทอน", "ทอนเงิน", "change",
        // ── Discounts / promotions ──────────────────────────────────────────
        "ส่วนลด", "discount", "โปรโมชั่น", "โปรโมชัน", "คูปอง", "coupon", "ลดราคา",
        "promotion", "voucher",
        // ── Service / delivery fees ─────────────────────────────────────────
        "ค่าบริการ", "service charge", "service fee", "ค่าจัดส่ง", "ค่าส่ง", "delivery fee",
        // ── Loyalty / points ────────────────────────────────────────────────
        "คะแนน", "แต้ม", "สะสม", "points", "reward", "balance point", "earned today",
        "สมาชิก", "member no", "membership",
        // ── Counts ──────────────────────────────────────────────────────────
        "จำนวนรายการ", "จำนวนสินค้า", "items:", "qty:", "จำนวนชิ้น", "total items",
        // ── Document metadata ───────────────────────────────────────────────
        "เลขประจำตัวผู้เสียภาษี", "เลขผู้เสียภาษี", "tax id", "taxid", "tax invoice",
        "เลขที่ใบเสร็จ", "เลขที่ใบกำกับ", "ใบกำกับภาษี", "ใบเสร็จรับเงิน", "invoice no",
        "receipt no", "abb", "วันที่", "เวลา", "date", "time", "โทรศัพท์", "โทร.",
        "tel.", "tel:", "fax", "ที่อยู่", "address", "สาขา", "branch", "พนักงาน",
        "staff", "cashier", "แคชเชียร์", "พขร", "โต๊ะ", "table", "guests", "ลูกค้า",
        "ขอบคุณ", "thank you", "welcome", "powered by", "www.", "http", "pos #",
    ]

    /// A 13-digit run (tax id) or a Thai phone-number shape.
    private static let taxIdRegex = try! NSRegularExpression(pattern: #"\d{13}"#)
    private static let phoneRegex = try! NSRegularExpression(pattern: #"0\d[\s-]?\d{3}[\s-]?\d{3,4}"#)
    private static let allDigitsRegex = try! NSRegularExpression(pattern: #"^[\d.,\s\-฿]+$"#)

    /// True when this label+amount is NOT a real purchasable line item and
    /// should be dropped from the preview.
    static func isNonItem(_ rawName: String, amount: Double) -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.count < 2 { return true }

        let lower = name.lowercased()
        for phrase in nonItemPhrases where lower.contains(phrase) { return true }

        let full = NSRange(name.startIndex..., in: name)
        if allDigitsRegex.firstMatch(in: name, range: full) != nil { return true }
        if taxIdRegex.firstMatch(in: name, range: full) != nil { return true }
        if phoneRegex.firstMatch(in: name, range: full) != nil { return true }

        return false
    }

    /// Filters a list of candidate items down to real line items.
    static func realItems(_ items: [LineItem]) -> [LineItem] {
        items.filter { !isNonItem($0.name, amount: $0.amount) }
    }

    /// Amount-reconciliation cleanup for the crude on-device reading: Thai
    /// receipts price items VAT-inclusive, so the item sum usually equals the
    /// total (some equal the pre-VAT subtotal). When the sum overshoots but
    /// dropping exactly ONE row lands on a target within tolerance, that row is
    /// almost certainly a mis-read non-item (e.g. a branch/place name that
    /// slipped past the keyword filter) — drop it. Deliberately conservative:
    /// single-row only, and only when it reconciles cleanly, so real items are
    /// never pruned on a coincidence. The server extraction stays authoritative.
    static func reconcile(items: [LineItem], subtotal: Double?, total: Double?) -> [LineItem] {
        guard items.count >= 2 else { return items }
        let targets = [total, subtotal].compactMap { $0 }.filter { $0 > 0 }
        guard !targets.isEmpty else { return items }

        let amounts = items.map { $0.amount }
        let sum = amounts.reduce(0, +)
        func tol(_ t: Double) -> Double { max(1.0, t * 0.02) }

        // Already reconciles against a target → keep everything.
        for t in targets where abs(sum - t) <= tol(t) { return items }

        // Removing a single row lands on a target → that row is the outlier.
        for t in targets {
            for i in items.indices where abs((sum - amounts[i]) - t) <= tol(t) {
                var out = items; out.remove(at: i); return out
            }
        }
        return items   // can't reconcile cleanly → don't over-prune
    }
}
