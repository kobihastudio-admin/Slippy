import Foundation

/// Mirrors the real `documents` table schema (see
/// `supabase/migrations/001_core_schema.sql` + `007_document_schema_v2.sql`).
/// Note: the table has NO `file_name`, `invoice_number`, `subtotal_amount`,
/// `net_amount` or `category` columns — those were mistaken aliases. The real
/// columns are `file_path`, `doc_number`, `subtotal`, `doc_category`.
/// `fileName` below is derived client-side from `file_path` for display only.
struct SlippyDocument: Codable, Identifiable {
    let id: String
    let organizationId: String
    /// Shop/branch as printed — what the user recognises ("KOFUKU Silom Complex").
    let vendorName: String?
    /// Registered juristic entity behind the shop — owns `vendorTaxId`.
    /// Defaulted so existing construction sites (previews, fixtures) still compile.
    var companyName: String? = nil
    let vendorTaxId: String?
    let invoiceNumber: String?
    let docDate: String?
    let totalAmount: Double?
    let vatAmount: Double?
    let whtAmount: Double?
    let subtotalAmount: Double?
    let status: String
    let source: String
    let docType: String?
    let overallConfidence: Double?
    var machineVerificationStatus: String? = nil
    var reconciliationStatus: String? = nil
    var reconciliationDetails: ReconciliationDetails? = nil
    /// AI's own accounting classification (tax_invoice_full/receipt_with_tax/...,
    /// see api/src/pipeline/extractor.ts DocCategory) — overwritten on every
    /// (re)processing run, NOT a user-editable taxonomy.
    let category: String?
    /// Org-defined expense category (see DocumentCategory/document_categories) —
    /// the user-editable one, kept in its own column precisely because
    /// `category`/doc_category above is AI-owned and would otherwise get
    /// silently overwritten on reprocessing.
    var expenseCategory: String?
    let filePath: String
    let createdAt: String
    let notes: String?
    let displayRotation: Int?
    /// Set by the pipeline's duplicate check (validator.ts).
    var isDuplicate: Bool? = nil
    /// Warning codes from validation — the machine-readable reason a document
    /// needs a human look. See api/src/pipeline/validator.ts.
    var validationIssues: [String]? = nil

    /// Display-only file name derived from the storage path (no DB column backs this).
    var fileName: String {
        (filePath as NSString).lastPathComponent
    }

    enum CodingKeys: String, CodingKey {
        case id
        case organizationId    = "organization_id"
        case vendorName        = "vendor_name"
        case companyName       = "company_name"
        case vendorTaxId       = "vendor_tax_id"
        case invoiceNumber     = "doc_number"
        case docDate           = "doc_date"
        case totalAmount       = "total_amount"
        case vatAmount         = "vat_amount"
        case whtAmount         = "wht_amount"
        case subtotalAmount    = "subtotal"
        case status, source
        case docType           = "doc_type"
        case overallConfidence = "overall_confidence"
        case machineVerificationStatus = "machine_verification_status"
        case reconciliationStatus      = "reconciliation_status"
        case reconciliationDetails     = "reconciliation_details"
        case category          = "doc_category"
        case expenseCategory   = "expense_category"
        case filePath          = "file_path"
        case createdAt         = "created_at"
        case notes
        case displayRotation   = "display_rotation"
        case isDuplicate       = "is_duplicate"
        case validationIssues  = "validation_issues"
    }
}

struct ReconciliationDetails: Codable {
    let status: String?
}

extension SlippyDocument {

    // MARK: – Review signals
    //
    // What the list needs to answer at a glance: is this the same receipt
    // twice, and did the reading come out wrong? Both were already computed
    // server-side and stored — they just had nowhere to appear.

    var isDuplicateDocument: Bool {
        (isDuplicate ?? false) || (validationIssues ?? []).contains("DUPLICATE")
    }

    /// Codes the user can actually act on, in Thai. DUPLICATE is excluded — it
    /// gets its own badge, and lumping it in here would ask someone to "fix"
    /// a document whose only problem is that it exists twice.
    var correctionReasons: [String] {
        (validationIssues ?? []).compactMap { code in
            switch code {
            case "FUTURE_DATE":           return "วันที่เป็นอนาคต"
            case "OLD_DATE":              return "วันที่เก่าเกิน 2 ปี"
            case "INVALID_DATE":          return "รูปแบบวันที่ผิด"
            case "MISSING_DATE":          return "ไม่มีวันที่"
            case "MISSING_VENDOR":        return "ไม่มีชื่อผู้ขาย"
            case "MISSING_DOC_NUM":       return "ไม่มีเลขที่เอกสาร"
            case "ZERO_TOTAL":            return "ยอดรวมเป็น 0"
            case "VAT_MISMATCH":          return "VAT ไม่ตรงกับฐาน"
            case "TOTAL_MISMATCH":        return "ยอดรวมไม่ตรง"
            case "LINE_ITEM_SUM_MISMATCH":return "รายการไม่ตรงกับยอด"
            case "DUPLICATE":             return nil
            default:                      return nil
            }
        }
    }

    /// Below this the reading is a guess worth checking, even with no warning
    /// code — the model can be confidently wrong about Thai, so a low score is
    /// itself the signal.
    private var confidenceIsLow: Bool { (overallConfidence ?? 1) < 0.7 }

    var needsCorrection: Bool { !correctionReasons.isEmpty || confidenceIsLow }

    /// One short line for the badge. Names the specific problem when there is
    /// one, because "ตรวจสอบ" alone tells the user nothing about what to look at.
    var correctionSummary: String {
        if let first = correctionReasons.first {
            return correctionReasons.count > 1
                ? "\(first) +\(correctionReasons.count - 1)"
                : first
        }
        return "ความแม่นยำต่ำ"
    }

    var statusColor: String {
        switch status {
        case "pushed":    return "#8b5cf6"
        case "approved":  return "#10b981"
        case "reviewing": return "#f59e0b"
        case "failed":    return "#ef4444"
        case "rejected":  return "#ef4444"
        default:          return "#94a3b8"
        }
    }

    var statusLabel: String {
        switch status {
        case "pushed":    return "ส่งแล้ว"
        case "approved":  return "อนุมัติ"
        case "reviewing": return "ตรวจสอบ"
        case "processing":return "ประมวลผล"
        case "failed":    return "ผิดพลาด"
        case "rejected":  return "ปฏิเสธ"
        default:          return "รอดำเนินการ"
        }
    }
}
