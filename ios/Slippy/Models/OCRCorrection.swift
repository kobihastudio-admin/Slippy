import Foundation

/// Valid `documents.doc_type` values (matches the DB CHECK constraint in
/// `007_document_schema_v2.sql`) — used to constrain the pre-upload picker
/// to values that won't get rejected by the database.
enum DocTypeOption: String, CaseIterable {
    case receipt
    case invoice
    case taxInvoice = "tax_invoice"
    case creditNote = "credit_note"
    case expense
    case unknown

    var label: String {
        switch self {
        case .receipt:     return "ใบเสร็จรับเงิน (Receipt)"
        case .invoice:     return "ใบแจ้งหนี้ (Invoice)"
        case .taxInvoice:  return "ใบกำกับภาษี (Tax Invoice)"
        case .creditNote:  return "ใบลดหนี้ (Credit Note)"
        case .expense:     return "ค่าใช้จ่ายทั่วไป (Expense)"
        case .unknown:     return "ไม่ทราบประเภท"
        }
    }
}

/// How a reviewed line item should be treated — lets the user correct an
/// AI-extracted "line item" that's actually something else entirely, e.g.
/// "เงินสด"/"เงินทอน" (cash tendered / change) on a payment slip, which
/// should never be summed into the total alongside real purchased items.
enum LineItemKind: String, Codable, CaseIterable {
    /// A real purchasable line — counted into the total, shown normally.
    case lineItem
    /// Shown for reference (e.g. cash tendered, change, a sub-component
    /// breakdown) but excluded from the total.
    case info
    /// Not a line item at all — excluded from the total and hidden from
    /// the list once review is done.
    case hidden

    var label: String {
        switch self {
        case .lineItem: return "รายการคำนวณ"
        case .info:     return "ข้อมูลอย่างเดียว (ไม่นับ)"
        case .hidden:   return "ไม่เกี่ยวข้อง (ซ่อน)"
        }
    }

    var icon: String {
        switch self {
        case .lineItem: return "checkmark.circle.fill"
        case .info:     return "info.circle.fill"
        case .hidden:   return "eye.slash.circle.fill"
        }
    }

    /// On-device port of the server row classifier (receipt-rows.ts). Keeps the
    /// reading-result screen financial-only: payment/tender/change/points/totals/
    /// tax/metadata → `.hidden`; discounts + service/delivery fees → `.info`
    /// (relevant but not a product); everything else → `.lineItem`.
    static func classify(_ description: String) -> LineItemKind {
        let d = description.lowercased()
        func has(_ ks: [String]) -> Bool { ks.contains { d.contains($0) } }

        // ── hidden: not financial detail the user needs to see ──
        if has(["คะแนน", "แต้ม", "สะสม", "point", "reward", "redeem"]) { return .hidden }        // loyalty
        if has(["เงินทอน", "ทอน", "change"]) { return .hidden }                                   // change
        if has(["เงินสด", "cash", "บัตรเครดิต", "บัตรเดบิต", "credit card", "debit card",
                "mastercard", "master card", "visa", "jcb", "พร้อมเพย์", "promptpay", "prompt pay",
                "โอนเงิน", "เงินโอน", "transfer", "truemoney", "true money", "e-wallet", "ewallet",
                "ชำระโดย", "รับชำระ", "รับเงิน", "tender", "paid"]) { return .hidden }             // tender
        if has(["ยอดสุทธิ", "ยอดรวมทั้งสิ้น", "รวมทั้งสิ้น", "ยอดชำระ", "grand total",
                "net total", "amount due", "total", "ยอดก่อนภาษี", "ก่อนภาษี",
                "subtotal", "sub total", "รวมเป็นเงิน"]) { return .hidden }                        // subtotal/total
        if has(["ภาษีมูลค่าเพิ่ม", "vat", "tax"]) { return .hidden }                               // vat / tax id
        if has(["items:", "item:", "จำนวนรายการ"]) { return .hidden }                              // count
        if has(["powered by", "foodstory", "สมัครสมาชิก", "ขอบคุณ", "thank you"]) { return .hidden } // noise

        // ── info: financially relevant, but not a purchased product ──
        if has(["ส่วนลด", "discount", "โปรโมชั่น", "promo", "คูปอง", "coupon", "voucher"]) { return .info }
        if has(["ค่าบริการ", "เซอร์วิส", "service charge", "ค่าจัดส่ง", "ค่าส่ง", "ค่าขนส่ง",
                "delivery", "shipping"]) { return .info }

        return .lineItem
    }
}

/// One line item as reviewed by the user before submitting feedback.
struct CorrectedLineItem: Codable, Identifiable {
    var id: String = UUID().uuidString
    var name: String
    var qty: Double?
    var unitPrice: Double?
    var amount: Double
    var kind: LineItemKind = .lineItem

    /// Counted into the total — kept as a computed property (rather than
    /// storing the old plain `isLineItem: Bool`) so call sites that only
    /// care about "does this count" don't need to know about `.info` vs
    /// `.hidden`.
    var isLineItem: Bool { kind == .lineItem }

    init(from item: LineItem) {
        name = item.name
        qty = item.qty
        unitPrice = item.unitPrice
        amount = item.amount
        // Prefer the keyword classifier; fall back to the parser's flag only
        // when the label isn't recognised as a non-product row.
        let classified = LineItemKind.classify(item.name)
        kind = classified != .lineItem ? classified : (item.isLineItem ? .lineItem : .info)
    }

    /// Reconstructs the base LineItem used elsewhere in the app (display,
    /// upload, split calculations) — `.hidden` items are dropped by the
    /// caller before this is reached (see appliedExtraction()).
    var asLineItem: LineItem {
        LineItem(name: name, qty: qty, unitPrice: unitPrice, amount: amount, isLineItem: kind == .lineItem)
    }
}

// User-corrected OCR result saved locally before upload
struct OCRCorrection: Codable, Identifiable {
    var id: String = UUID().uuidString
    var documentId: String?       // set after upload
    var imagePath: String?        // supabase storage path, set after upload
    var correctedAt: Date = Date()

    // Corrected fields
    var vendorName: String
    var vendorTaxId: String
    var totalAmount: String       // store as string for UI editing, parse on submit
    var subtotal: String
    var vatAmount: String
    var whtAmount: String
    var docDate: String
    var docNumber: String
    var docType: String
    var paymentMethod: String
    var expenseCategory: String
    var lineItems: [CorrectedLineItem]

    // Original OCR values (for diff/learning)
    var originalVendorName: String
    var originalTotalAmount: String

    /// Sum of only the items still marked as real line items — what should
    /// match totalAmount/subtotal once informational sub-components are
    /// excluded.
    var includedLineItemsTotal: Double {
        lineItems.filter(\.isLineItem).reduce(0) { $0 + $1.amount }
    }

    init(from extraction: SlipExtraction) {
        vendorName     = extraction.vendorName    ?? ""
        vendorTaxId    = extraction.vendorTaxId   ?? ""
        totalAmount    = extraction.totalAmount.map { String(format: "%.2f", $0) } ?? ""
        subtotal       = extraction.subtotal.map   { String(format: "%.2f", $0) } ?? ""
        vatAmount      = extraction.vatAmount.map  { String(format: "%.2f", $0) } ?? ""
        whtAmount      = extraction.whtAmount.map  { String(format: "%.2f", $0) } ?? ""
        docDate        = extraction.docDate        ?? ""
        docNumber      = extraction.docNumber      ?? ""
        docType        = extraction.docType
        paymentMethod  = extraction.paymentMethod  ?? ""
        expenseCategory = extraction.expenseCategory ?? ""
        lineItems      = extraction.lineItems.map(CorrectedLineItem.init(from:))

        originalVendorName   = extraction.vendorName    ?? ""
        originalTotalAmount  = extraction.totalAmount.map { String(format: "%.2f", $0) } ?? ""
    }

    /// Rebuilds a `SlipExtraction` carrying every edit made in
    /// OCRFullDetailView — the corrected scalar fields, plus line items with
    /// `.hidden` ones dropped entirely and the rest tagged with their
    /// reviewed `isLineItem` flag. This is what `onApply` hands back to the
    /// caller (CameraPickerView) so edits actually take effect on the
    /// document being uploaded, instead of only ever feeding the separate
    /// "ส่งให้ Slippy เรียนรู้" training payload.
    func appliedExtraction(basedOn original: SlipExtraction) -> SlipExtraction {
        var result = original
        result.vendorName    = vendorName.isEmpty ? nil : vendorName
        result.vendorTaxId   = vendorTaxId.isEmpty ? nil : vendorTaxId
        result.totalAmount   = Double(totalAmount)
        result.subtotal      = Double(subtotal)
        result.vatAmount     = Double(vatAmount)
        result.whtAmount     = Double(whtAmount)
        result.docDate       = docDate.isEmpty ? nil : docDate
        result.docNumber     = docNumber.isEmpty ? nil : docNumber
        result.docType       = docType
        result.paymentMethod = paymentMethod.isEmpty ? nil : paymentMethod
        result.expenseCategory = expenseCategory.isEmpty ? nil : expenseCategory
        result.lineItems     = lineItems.filter { $0.kind != .hidden }.map(\.asLineItem)
        return result
    }
}

enum OCRCorrectionStore {
    private static var fileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("ocr_corrections.json")
    }

    static func save(_ correction: OCRCorrection) {
        var all = loadAll()
        // Replace if same documentId exists, else append
        if let docId = correction.documentId,
           let idx = all.firstIndex(where: { $0.documentId == docId }) {
            all[idx] = correction
        } else {
            all.append(correction)
        }
        if let data = try? JSONEncoder().encode(all) {
            try? data.write(to: fileURL)
        }
    }

    static func loadAll() -> [OCRCorrection] {
        guard let data = try? Data(contentsOf: fileURL),
              let items = try? JSONDecoder().decode([OCRCorrection].self, from: data)
        else { return [] }
        return items
    }

    static func pending() -> [OCRCorrection] {
        loadAll().filter { $0.documentId != nil }
    }
}
