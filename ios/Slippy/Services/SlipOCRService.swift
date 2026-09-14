import Vision
import UIKit

// MARK: – Line item

struct LineItem: Identifiable {
    let id = UUID()
    var name: String
    var qty: Double?
    var unitPrice: Double?
    var amount: Double
    /// False for items the user has reviewed and marked as not a real
    /// purchasable line (e.g. เงินสด/เงินทอน on a payment slip) — still
    /// present so it can be shown, but excluded from any total/split
    /// calculation. Set via OCRFullDetailView's per-item review, applied
    /// back through CameraPickerView's `onApply` callback.
    var isLineItem: Bool = true
}

// MARK: – Raw OCR observation

struct OCRObservation: Identifiable {
    let id = UUID()
    var text: String
    var confidence: Float    // per-candidate confidence from Vision
    var boundingBox: CGRect  // normalised 0-1, origin bottom-left (Vision coords)
    var isRightAligned: Bool // true when text block is in right 40% of image
    var section: DocSection  // which part of the document this came from

    enum DocSection: String {
        case header = "หัวเอกสาร"   // top ~25%
        case body   = "เนื้อหา"     // middle ~50%
        case footer = "ท้ายเอกสาร" // bottom ~25%
    }
}

// MARK: – Per-field confidence

struct FieldConfidence {
    var vendorName: Double  = 0
    var totalAmount: Double = 0
    var vatAmount: Double   = 0
    var subtotal: Double    = 0
    var docDate: Double     = 0
    var docNumber: Double   = 0
}

// MARK: – Extracted slip data

struct SlipExtraction {
    var vendorName: String?
    var vendorAddress: String?   // address line(s) after vendor name
    var vendorTaxId: String?     // เลขผู้เสียภาษี 13 หลัก
    var totalAmount: Double?
    var subtotal: Double?        // ยอดรวมรายการ ก่อนหักส่วนลด
    /// ส่วนลด — needed to show a breakdown that actually balances:
    /// subtotal − discount = ยอดก่อนภาษี, + VAT = ยอดรวมทั้งสิ้น.
    var discountAmount: Double?
    var vatAmount: Double?       // ภาษีมูลค่าเพิ่ม
    var whtAmount: Double?       // หัก ณ ที่จ่าย
    var docDate: String?         // ISO-8601 "yyyy-MM-dd"
    var docNumber: String?       // invoice / reference number
    var docType: String = "receipt"
    var paymentMethod: String?   // cash / card / transfer / promptpay
    /// Org-defined expense category (document_categories) — set during
    /// pre-upload review, written to documents.expense_category (NOT
    /// doc_category, which is the AI pipeline's own classification).
    var expenseCategory: String?
    var lineItems: [LineItem] = []
    var confidence: Double       // 0–1 overall
    var fieldConfidence = FieldConfidence()

    // Full raw data
    var rawObservations: [OCRObservation] = []
    var allAmountsFound: [Double] = []
    /// Decoded slip/PromptPay QR, when present — a deterministic source that
    /// outranks OCR for the amount.
    var qr: SlipQRData?

    var isEmpty: Bool {
        vendorName == nil && totalAmount == nil && docDate == nil && docNumber == nil
    }

    var rawText: String { rawObservations.map(\.text).joined(separator: "\n") }

    // Warnings for the UI
    var warnings: [String] {
        var w: [String] = []
        if confidence < 0.4 { w.append("ความแม่นยำต่ำ — กรุณาตรวจสอบข้อมูลด้วยตนเอง") }
        if vendorName == nil { w.append("ไม่พบชื่อร้าน/บริษัท") }
        if totalAmount == nil { w.append("ไม่พบยอดรวม") }
        if docDate == nil { w.append("ไม่พบวันที่") }
        // A receipt balances as  subtotal − discount + VAT − WHT = total.
        // Testing `subtotal + VAT == total` ignores two of those four terms, so
        // every discounted receipt was declared broken: KOFUKU reads
        // 1,126 + 73.22 = 1,199.22 against a printed total of 1,119.22, and the
        // ฿80 gap is exactly the discount the check never looked at.
        //
        // `subtotal` is documented above as the item total BEFORE the discount,
        // but some shops deduct it on the item lines instead and report the net
        // figure. Both are legitimate, so accept either rather than calling one
        // of them an error.
        if let s = subtotal, let v = vatAmount, let t = totalAmount {
            let wht   = whtAmount ?? 0
            let gross = abs((s - (discountAmount ?? 0) + v - wht) - t)
            let net   = abs((s + v - wht) - t)
            if min(gross, net) > 1 { w.append("ยอดก่อนภาษี + VAT ไม่ตรงกับยอดรวม") }
        }
        return w
    }
}

// MARK: – Server hint payload

/// Wire format for the on-device pre-read sent up to `/api/documents/{id}/process`
/// — matches `LocalOcrHint` in `api/src/pipeline/local-ocr-hint.ts`.
struct LocalOcrHintPayload: Encodable {
    var rawText:     String?
    var vendorName:  String?
    var totalAmount: Double?
    var docDate:     String?
    var docNumber:   String?
    var confidence:  Double?
    var source:      String?

    enum CodingKeys: String, CodingKey {
        case rawText     = "rawText"
        case vendorName  = "vendorName"
        case totalAmount = "totalAmount"
        case docDate     = "docDate"
        case docNumber   = "docNumber"
        case confidence  = "confidence"
        case source      = "source"
    }
}

// MARK: – Slip QR (deterministic path)

/// Payload decoded from a QR on a Thai slip / PromptPay code.
///
/// Thai transfer slips and PromptPay codes carry an EMVCo TLV payload. When it
/// includes tag 54 (transaction amount) that number is *exact* — no OCR guessing,
/// no glare, no faded thermal ink. For slips this beats every OCR/cloud model,
/// so it takes priority over the parsed text.
struct SlipQRData {
    var raw: String
    var isEMVCo: Bool = false
    var amount: Double?          // tag 54
    var currency: String?        // tag 53 — "764" = THB
    var reference: String?       // tag 62 → 01/05/07
    var promptPayTarget: String? // tag 29/30/31 → account identifier
    // Tag 30 (EMVCo Bill Payment — Thai tax-invoice / bill QRs):
    var billerId: String?        // tag 30 → 01 (raw Biller ID)
    var taxId: String?           // leading 13 digits of the Biller ID
    var invoiceRef: String?      // tag 30 → 02/03 (bill / invoice reference)
}

enum SlipQRReader {
    /// Detect and decode the most informative barcode in the image.
    static func read(from image: UIImage) -> SlipQRData? {
        let upright = image.orientationNormalized()
        guard let cg = upright.cgImage else { return nil }

        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr, .aztec, .dataMatrix, .pdf417, .code128]

        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try? handler.perform([request])

        let payloads = (request.results ?? [])
            .compactMap { $0.payloadStringValue }
            .filter { !$0.isEmpty }
        // Longest payload = richest (a PromptPay TLV beats a short URL).
        guard let best = payloads.max(by: { $0.count < $1.count }) else { return nil }
        return parse(best)
    }

    static func parse(_ payload: String) -> SlipQRData {
        var data = SlipQRData(raw: payload)
        let root = parseTLV(payload)

        // "00" = payload format indicator → this really is an EMVCo TLV string.
        guard root["00"] != nil else { return data }
        data.isEMVCo = true
        data.currency = root["53"]

        if let amountText = root["54"], let value = Double(amountText), value > 0 {
            data.amount = value
        }
        if let additional = root["62"] {
            let sub = parseTLV(additional)
            data.reference = sub["01"] ?? sub["05"] ?? sub["07"]
        }
        for tag in ["29", "30", "31"] {
            guard let merchant = root[tag] else { continue }
            let sub = parseTLV(merchant)
            if let target = sub["01"] ?? sub["02"] ?? sub["03"] {
                data.promptPayTarget = target
                break
            }
        }

        // Tag 30 = EMVCo Bill Payment. On Thai tax invoices / bill QRs its
        // Biller ID (sub-01) embeds the merchant's 13-digit Tax ID, and sub-02/03
        // carry the invoice reference. This is DETERMINISTIC — it fixes the exact
        // failure OCR keeps hitting (mis-reading a digit of the 13-digit tax id).
        if let billPay = root["30"] {
            let sub = parseTLV(billPay)
            if let biller = sub["01"], !biller.isEmpty {
                data.billerId = biller
                let digits = biller.filter(\.isNumber)
                if digits.count >= 13 { data.taxId = String(digits.prefix(13)) }
            }
            if let ref = (sub["02"] ?? sub["03"])?.trimmingCharacters(in: .whitespaces), !ref.isEmpty {
                data.invoiceRef = ref
            }
        }
        return data
    }

    /// EMVCo TLV: 2-char tag, 2-char length, then that many chars of value.
    private static func parseTLV(_ s: String) -> [String: String] {
        var out: [String: String] = [:]
        let chars = Array(s)
        var i = 0
        while i + 4 <= chars.count {
            let tag = String(chars[i..<(i + 2)])
            guard let len = Int(String(chars[(i + 2)..<(i + 4)])), len >= 0 else { break }
            let start = i + 4
            let end   = start + len
            guard end <= chars.count else { break }
            out[tag] = String(chars[start..<end])
            i = end
        }
        return out
    }
}

// MARK: – OCR Service

enum SlipOCRService {

    static func extract(from image: UIImage) async -> SlipExtraction {
        // VNImageRequestHandler(cgImage:) assumes upright pixels; a sideways
        // photo would make Vision read rotated text badly. Normalise first.
        let image = image.orientationNormalized()
        guard let cgImage = image.cgImage else { return SlipExtraction(confidence: 0) }

        // Pass 1: language correction ON — good for Thai text, vendor names, labels
        let req1 = VNRecognizeTextRequest()
        req1.recognitionLevel       = .accurate
        req1.usesLanguageCorrection = true
        req1.recognitionLanguages   = ["th-TH", "en-US"]
        req1.minimumTextHeight      = 0.006

        // Pass 2: language correction OFF — better for numbers, IDs, reference codes
        // Language correction can silently corrupt "฿3" → "B3", "7%" → "7%", etc.
        let req2 = VNRecognizeTextRequest()
        req2.recognitionLevel       = .accurate
        req2.usesLanguageCorrection = false
        req2.recognitionLanguages   = ["th-TH", "en-US"]
        req2.minimumTextHeight      = 0.006

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([req1, req2])

        let obs1 = req1.results ?? []
        let obs2 = req2.results ?? []

        // Merge: for each bounding box region, pick candidate with higher confidence
        // Use pass-1 text for labels, pass-2 text for numeric regions
        var richObs: [OCRObservation] = []

        for obs in obs1 {
            guard let c1 = obs.topCandidates(1).first else { continue }
            let bb = obs.boundingBox

            // Find matching box from pass 2 (same region, within 2% tolerance)
            let match2 = obs2.first { o2 in
                abs(o2.boundingBox.midX - bb.midX) < 0.02 &&
                abs(o2.boundingBox.midY - bb.midY) < 0.02
            }

            let isNumericLine = looksNumeric(c1.string)
            var finalText = c1.string

            if let c2 = match2?.topCandidates(1).first {
                if isNumericLine {
                    // Prefer pass-2 for numbers (no language correction distortion)
                    finalText = c2.string
                } else if c2.confidence > c1.confidence + 0.1 {
                    finalText = c2.string
                }
            }

            let section: OCRObservation.DocSection
            if bb.minY > 0.75 { section = .header }
            else if bb.minY < 0.25 { section = .footer }
            else { section = .body }

            richObs.append(OCRObservation(
                text: finalText,
                confidence: c1.confidence,
                boundingBox: bb,
                isRightAligned: bb.minX > 0.55,
                section: section
            ))
        }

        // Sort top-to-bottom
        let sorted = richObs.sorted { $0.boundingBox.minY > $1.boundingBox.minY }
        let lines  = sorted.map(\.text)

        var result = parse(lines: lines, observations: sorted)
        result.rawObservations = sorted

        // ── Deterministic slip path ──────────────────────────────────────────
        // A QR carrying an EMVCo amount (tag 54) is exact — prefer it over any
        // OCR reading. Static merchant QRs omit tag 54, so this only fires when
        // the code really encodes this transaction's amount.
        if let qr = SlipQRReader.read(from: image) {
            result.qr = qr
            if let amount = qr.amount, amount > 0 {
                result.totalAmount = amount
                result.fieldConfidence.totalAmount = 1.0
                result.paymentMethod = result.paymentMethod ?? "promptpay"
                result.confidence = max(result.confidence, 0.9)
            }
            if result.docNumber == nil, let ref = qr.reference,
               !ref.trimmingCharacters(in: .whitespaces).isEmpty {
                result.docNumber = ref
            }

            // Bill-payment / tax-invoice QR: the 13-digit Tax ID and invoice
            // reference are exact — trust them over OCR.
            if let taxId = qr.taxId, taxId.count == 13 {
                result.vendorTaxId = taxId
                result.docType = "tax_invoice"
                result.confidence = max(result.confidence, 0.9)
            }
            if let ref = qr.invoiceRef, !ref.isEmpty {
                result.docNumber = ref
            }
        }

        return result
    }

    /// Deterministic-only pre-read for the document-upload flow: decode a QR and
    /// nothing else. No text recognition, no interpretation.
    ///
    /// The full `extract(from:)` path stays for the bill-split feature, which
    /// needs an offline reading. For uploads the SERVER is authoritative:
    /// on-device Vision OCR consistently mis-read vendor names (GATEAUX HOUSE →
    /// "STEAD"/"KEAD"), missed or invented line items, and — worst of all — that
    /// guess was sent up as a "second OCR reading" and injected into the model's
    /// prompt, biasing it toward the wrong answer. A QR payload has none of that
    /// ambiguity: tag 54 is the exact amount and the tag-30 biller id is the
    /// exact 13-digit tax id, so those are the only facts worth pre-computing.
    static func quickFacts(from image: UIImage) -> SlipExtraction {
        var result = SlipExtraction(confidence: 0)
        guard let qr = SlipQRReader.read(from: image) else { return result }
        result.qr = qr

        if let amount = qr.amount, amount > 0 {
            result.totalAmount = amount
            result.fieldConfidence.totalAmount = 1.0
            result.paymentMethod = "promptpay"
        }
        if let taxId = qr.taxId, taxId.count == 13 {
            result.vendorTaxId = taxId
            result.docType = "tax_invoice"
        }
        if let ref = qr.invoiceRef, !ref.isEmpty {
            result.docNumber = ref
        }
        // 1.0 = these came from a machine-readable payload, not a guess.
        result.confidence = (result.totalAmount != nil || result.vendorTaxId != nil) ? 1.0 : 0
        return result
    }

    private static func looksNumeric(_ text: String) -> Bool {
        let digits = text.filter { $0.isNumber || $0 == "." || $0 == "," || $0 == "฿" || $0 == "%" }
        return Double(digits.count) / Double(max(text.count, 1)) > 0.5
    }

    // MARK: – Parser

    private static let instructionKeywords = [
        "เพื่อรับ", "โปรแสด", "กรุณา", "สำหรับ", "โปรด", "ใส่ตัวเลข",
        "invitation", "คูปอง", "ส่วนลด", "scan", "แสกน", "qr code",
        "เริ่มนับ", "ใช้ได้", "มีอายุ", "ครั้งต่อไป", "แสดง", "ใช้ได้ภายใน",
        "สแกน", "แบบสอบถาม", "ดาวน์โหลด", "ติดตาม", "ลงทะเบียน"
    ]

    private static func parse(lines: [String], observations: [OCRObservation] = []) -> SlipExtraction {
        var result = SlipExtraction(confidence: 0)
        let fullText = lines.joined(separator: "\n")
        var hits = 0

        // ── Doc type ─────────────────────────────────────────────────────────
        let lower = fullText.lowercased()
        if lower.contains("ใบกำกับภาษี") || lower.contains("tax invoice") {
            result.docType = "invoice"
        } else if lower.contains("invoice") || lower.contains("ใบแจ้งหนี้") {
            result.docType = "invoice"
        } else if lower.contains("ใบเสร็จ") || lower.contains("receipt") {
            result.docType = "receipt"
        }

        // ── Payment method ────────────────────────────────────────────────────
        if lower.contains("promptpay") || lower.contains("พร้อมเพย์") {
            result.paymentMethod = "PromptPay"
        } else if lower.contains("บัตรเครดิต") || lower.contains("credit card") || lower.contains("visa") || lower.contains("mastercard") {
            result.paymentMethod = "บัตรเครดิต"
        } else if lower.contains("บัตรเดบิต") || lower.contains("debit") {
            result.paymentMethod = "บัตรเดบิต"
        } else if lower.contains("โอน") || lower.contains("transfer") {
            result.paymentMethod = "โอนเงิน"
        } else if lower.contains("เงินสด") || lower.contains("cash") {
            result.paymentMethod = "เงินสด"
        }

        // ── Vendor name ───────────────────────────────────────────────────────
        // Header observations (top 25%) sorted by Y — topmost valid name wins
        let headerObs = observations.filter { $0.section == .header }
            .sorted { $0.boundingBox.minY > $1.boundingBox.minY }

        let vendorTriggers = ["ร้าน", "บริษัท", "หจก.", "หสน.", "บจก.", "ผู้รับ", "โอนให้",
                              "ชื่อบัญชี", "to:", "receiver", "beneficiary", "merchant", "store:"]

        for trigger in vendorTriggers {
            if let name = lineAfterKeyword(trigger, in: lines, sameLineAllowed: true) {
                let cleaned = cleanName(name)
                if isValidVendorName(cleaned) {
                    result.vendorName = cleaned
                    result.fieldConfidence.vendorName = 0.9
                    hits += 1
                    break
                }
            }
        }

        // Fallback: topmost observation in header that looks like a name
        if result.vendorName == nil {
            for obs in headerObs {
                let s = obs.text.trimmingCharacters(in: .whitespaces)
                if s.count >= 2 && s.count <= 80
                    && !s.contains(":")
                    && firstMatch(of: #"[0-9]{5,}"#, in: s) == nil
                    && isValidVendorName(s) {
                    result.vendorName = s
                    result.fieldConfidence.vendorName = Double(obs.confidence) * 0.7
                    hits += 1
                    break
                }
            }
        }

        // ── Vendor address (line(s) right after name in header) ───────────────
        if let name = result.vendorName,
           let nameIdx = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == name }) {
            var addrLines: [String] = []
            for i in (nameIdx + 1)..<min(nameIdx + 4, lines.count) {
                let s = lines[i].trimmingCharacters(in: .whitespaces)
                // Address lines: contain numbers + words but not amount patterns
                if s.count > 5 && s.count < 100
                    && extractAllAmounts(from: s).filter({ $0 > 100 }).isEmpty
                    && isValidVendorName(s) {
                    addrLines.append(s)
                } else { break }
            }
            if !addrLines.isEmpty { result.vendorAddress = addrLines.joined(separator: " ") }
        }

        // ── Vendor tax ID ─────────────────────────────────────────────────────
        // Try 13-digit no-dash first, then with dashes (e.g. 0-1055-63035-87-4)
        if let taxId = firstMatch(of: #"\b(\d{13})\b"#, in: fullText) {
            result.vendorTaxId = taxId
            hits += 1
        } else if let taxId = firstMatch(of: #"\b(\d{1}-\d{4}-\d{5}-\d{2}-\d{1})\b"#, in: fullText) {
            // Strip dashes to normalise
            result.vendorTaxId = taxId.replacingOccurrences(of: "-", with: "")
            hits += 1
        } else if let taxId = firstMatch(of: #"TAX\s*ID\s*[:\s]+([0-9\-]{13,17})"#, in: fullText, options: .caseInsensitive) {
            result.vendorTaxId = taxId.replacingOccurrences(of: "-", with: "")
            hits += 1
        }

        // ── Invoice / reference number ────────────────────────────────────────
        // Priority: standalone code on its own line (T36-9770036 style) > labelled ref > prefix
        let refPatterns: [(String, Double)] = [
            // Standalone receipt/table number: letter(s) + digits + dash + digits alone on line
            (#"^([A-Z]\d{2}-\d{7,10})$"#, 0.98),
            // Labelled: "เลขที่ xxx", "TAX INVOICE# xxx", "RCT# xxx"
            (#"(?:เลขที่|tax\s*invoice\s*#?|rct\s*#?|inv\.?\s*no\.?|receipt\s*no\.?|doc\s*no\.?|ref\.?)[:\s#]+([A-Z0-9\-\/]{4,30})"#, 0.95),
            // Generic prefix pattern
            (#"\b(INV|REC|TXN|REF|SLP|T\d{2})[0-9\-]{4,20}\b"#, 0.85),
        ]
        for (p, conf) in refPatterns {
            if let ref = firstMatch(of: p, in: fullText, options: .caseInsensitive) {
                result.docNumber = ref.trimmingCharacters(in: .whitespaces)
                result.fieldConfidence.docNumber = conf
                hits += 1
                break
            }
        }

        // ── Date ──────────────────────────────────────────────────────────────
        if let date = extractDate(from: fullText) {
            result.docDate = date
            result.fieldConfidence.docDate = 0.9
            hits += 1
        }

        // ── Amounts ───────────────────────────────────────────────────────────
        let subtotalTriggers = ["ราคาก่อนภาษี", "ยอดก่อนvat", "subtotal", "ยอดรวมก่อน",
                                "มูลค่าสินค้า", "net amount", "ราคาสุทธิก่อน", "มูลค่าก่อน", "ราคาก่อน vat",
                                "sub total"]
        let vatTriggers      = ["ภาษีมูลค่าเพิ่ม", "vat", "tax 7%", "ภาษี 7%",
                                "value added tax", "ภาษี(7%)", "ภาษี 7", "ภาษีมูลค่า"]
        let whtTriggers      = ["หัก ณ ที่จ่าย", "withholding tax", "wht", "หักภาษี ณ"]
        let totalTriggers    = ["ยอดรวมทั้งสิ้น", "รวมทั้งสิ้น", "grand total", "total amount",
                                "ยอดชำระ", "จำนวนเงิน", "จํานวนเงิน", "รวมเงิน", "ยอดรวม",
                                "รวมสุทธิ", "net total"]
        // Note: "total" alone is intentionally excluded — too broad and causes false positives

        // ── Special patterns (Sushiro style) ─────────────────────────────────
        // TOTAL(4Qt) — strip parenthetical qualifier before matching
        // E.g. "TOTAL(4Qt)   ฿649.00"
        for line in lines {
            let stripped = line.replacingOccurrences(of: #"\(.*?\)"#, with: "", options: .regularExpression)
                               .trimmingCharacters(in: .whitespaces)
            if stripped.caseInsensitiveCompare("total") == .orderedSame {
                if let amt = extractAllAmounts(from: line).filter({ $0 > 0 }).last {
                    if result.totalAmount == nil || amt > (result.totalAmount ?? 0) {
                        result.totalAmount = amt
                        result.fieldConfidence.totalAmount = 0.95
                    }
                }
            }
        }

        // VAT INCLUDED line: two amounts on same line → first = taxable base, second = VAT
        // E.g. "(VAT INCLUDED #1 7.00%)  ฿606.54  ฿42.46"
        for line in lines {
            guard line.localizedCaseInsensitiveContains("vat included") ||
                  line.localizedCaseInsensitiveContains("vat incl") else { continue }
            let amounts = extractAllAmounts(from: line).filter { $0 > 0 }
            if amounts.count >= 2 {
                if result.subtotal == nil { result.subtotal = amounts[amounts.count - 2] }
                if result.vatAmount == nil { result.vatAmount = amounts[amounts.count - 1] }
            }
        }

        // SERVICE CHARGE — store in whtAmount slot or just skip line items
        // (stored as a warning flag; line items extractor will skip SERVICE CHARGE lines)

        result.subtotal    = result.subtotal    ?? labelledAmount(triggers: subtotalTriggers, in: lines, observations: observations)
        result.vatAmount   = result.vatAmount   ?? labelledAmount(triggers: vatTriggers,      in: lines, observations: observations)
        result.whtAmount   = labelledAmount(triggers: whtTriggers,      in: lines, observations: observations)
        result.totalAmount = result.totalAmount ?? labelledAmount(triggers: totalTriggers,    in: lines, observations: observations)

        // Collect all amounts
        let allNums = extractAllAmounts(from: fullText).filter { $0 >= 0.01 }
        result.allAmountsFound = Array(Set(allNums)).sorted(by: >)

        // Smarter fallback: search footer area (bottom 40% of doc) for the largest amount
        if result.totalAmount == nil {
            let footerObs = observations.filter { $0.boundingBox.minY < 0.40 }
            let footerAmounts = footerObs.flatMap { extractAllAmounts(from: $0.text) }.filter { $0 >= 1 }
            result.totalAmount = footerAmounts.max()
        }

        // Last resort: largest number in full text
        if result.totalAmount == nil {
            result.totalAmount = allNums.filter { $0 >= 1 }.max()
        }

        if let s = result.subtotal { result.fieldConfidence.subtotal = s > 0 ? 0.85 : 0 }
        if let v = result.vatAmount { result.fieldConfidence.vatAmount = v > 0 ? 0.85 : 0 }
        if let t = result.totalAmount { result.fieldConfidence.totalAmount = t > 0 ? 0.9 : 0 }

        // Back-calculate subtotal
        if result.subtotal == nil, let total = result.totalAmount, let vat = result.vatAmount {
            let calculated = total - vat
            if calculated > 0 {
                result.subtotal = calculated
                result.fieldConfidence.subtotal = 0.7
            }
        }

        if result.totalAmount != nil { hits += 1 }

        // ── Line items ────────────────────────────────────────────────────────
        result.lineItems = extractLineItems(from: lines, observations: observations, totalAmount: result.totalAmount)
        // Drop outlier rows whose removal reconciles the item sum with the
        // subtotal/total (e.g. a branch/place name mis-read as an item).
        result.lineItems = ReceiptRowClassifier.reconcile(
            items: result.lineItems, subtotal: result.subtotal, total: result.totalAmount)
        if !result.lineItems.isEmpty { hits += 1 }

        // ── Confidence ────────────────────────────────────────────────────────
        // More nuanced: weight by field importance
        let fieldHits = (result.vendorName != nil ? 1.5 : 0)
                      + (result.totalAmount != nil ? 2.0 : 0)
                      + (result.docDate != nil ? 1.0 : 0)
                      + (result.docNumber != nil ? 0.5 : 0)
                      + (result.vatAmount != nil ? 0.5 : 0)
        result.confidence = min(fieldHits / 5.5, 1.0)

        return result
    }

    // MARK: – Line item extractor (spatial-aware)

    private static func extractLineItems(from lines: [String], observations: [OCRObservation],
                                          totalAmount: Double?) -> [LineItem] {
        var items: [LineItem] = []

        let skipKeywords = ["รวม", "total", "vat", "tax", "ภาษี", "subtotal", "ยอด", "discount",
                            "ที่อยู่", "address", "เลขที่", "invoice", "receipt", "วันที่", "date",
                            "หัก", "wht", "ขอบคุณ", "thank", "โทร", "tel", "fax", "สาขา",
                            "service charge", "service fee", "sub total"]

        // Body observations: pair left-side labels with right-side amounts on same Y
        let bodyObs = observations.filter { $0.section == .body }
            .sorted { $0.boundingBox.minY > $1.boundingBox.minY }

        var usedIDs = Set<UUID>()

        for obs in bodyObs where !obs.isRightAligned {
            guard !usedIDs.contains(obs.id) else { continue }
            let label = obs.text.trimmingCharacters(in: .whitespaces)
            guard label.count >= 2 else { continue }
            let labelLower = label.lowercased()
            if skipKeywords.contains(where: { labelLower.contains($0) }) { continue }

            // Find right-aligned observation on the same row (y within 2%)
            let amtObs = bodyObs.first { right in
                right.isRightAligned &&
                !usedIDs.contains(right.id) &&
                abs(right.boundingBox.midY - obs.boundingBox.midY) < 0.025
            }

            if let amtObs = amtObs {
                let amtNums = extractAllAmounts(from: amtObs.text).filter { $0 > 0 }
                if let amt = amtNums.last, amt > 0 {
                    if let total = totalAmount, abs(amt - total) < 0.01 { continue }
                    items.append(LineItem(name: label, qty: nil, unitPrice: nil, amount: amt))
                    usedIDs.insert(obs.id)
                    usedIDs.insert(amtObs.id)
                }
            }
        }

        // Fallback: regex patterns on raw lines
        if items.isEmpty {
            let linePattern = #"^(.+?)\s{2,}(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$"#
            let qtyPattern  = #"^(\d+(?:\.\d+)?)\s+(.+?)\s{2,}[\d,]+\.\d{2}\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$"#

            for line in lines {
                let t = line.trimmingCharacters(in: .whitespaces)
                guard t.count > 3 else { continue }
                let tl = t.lowercased()
                if skipKeywords.contains(where: { tl.contains($0) }) { continue }

                if let m = try? NSRegularExpression(pattern: qtyPattern)
                    .firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), m.numberOfRanges == 4 {
                    let ns = t as NSString
                    let q = ns.substring(with: m.range(at: 1))
                    let n = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespaces)
                    let a = ns.substring(with: m.range(at: 3)).replacingOccurrences(of: ",", with: "")
                    if let qty = Double(q), let amt = Double(a), amt > 0 {
                        items.append(LineItem(name: n, qty: qty, unitPrice: amt / qty, amount: amt))
                        continue
                    }
                }

                if let m = try? NSRegularExpression(pattern: linePattern)
                    .firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), m.numberOfRanges == 3 {
                    let ns = t as NSString
                    let n  = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
                    let a  = ns.substring(with: m.range(at: 2)).replacingOccurrences(of: ",", with: "")
                    if let amt = Double(a), amt > 0, n.count >= 2 {
                        if let total = totalAmount, abs(amt - total) < 0.01 { continue }
                        items.append(LineItem(name: n, qty: nil, unitPrice: nil, amount: amt))
                    }
                }
            }
        }

        // Drop rows that aren't real purchasable line items (subtotal/VAT/total,
        // tender/change, discounts, loyalty points, metadata) — mirrors the
        // server's isNonItemRow so the preview matches what actually gets saved.
        return Array(ReceiptRowClassifier.realItems(items).prefix(30))
    }

    // MARK: – Vendor name validator

    private static func isValidVendorName(_ text: String) -> Bool {
        let lower = text.lowercased()
        for kw in instructionKeywords {
            if lower.contains(kw.lowercased()) { return false }
        }
        let digitCount = text.filter(\.isNumber).count
        if digitCount > text.count / 2 { return false }
        if text.count > 80 { return false }
        return true
    }

    // MARK: – Labelled amount helper (spatial-aware)

    private static func labelledAmount(triggers: [String], in lines: [String],
                                        observations: [OCRObservation] = []) -> Double? {
        // Collect all candidates, prefer one lowest in document (Vision minY smallest = bottom)
        var candidates: [(Double, Double)] = []  // (amount, yPosition) — yPos 0=bottom 1=top

        for trigger in triggers {
            for (idx, line) in lines.enumerated() {
                guard line.localizedCaseInsensitiveContains(trigger) else { continue }

                // Same line — rightmost number
                let nums = extractAllAmounts(from: line).filter { $0 > 0 }
                if let amt = nums.last {
                    let yPos = observations.first(where: { $0.text == line })?.boundingBox.midY ?? Double(lines.count - idx) / Double(lines.count)
                    candidates.append((amt, yPos))
                    continue
                }

                // Spatially paired right-aligned observation
                if let labelObs = observations.first(where: { $0.text == line }) {
                    let nearby = observations.filter { obs in
                        obs.isRightAligned &&
                        abs(obs.boundingBox.midY - labelObs.boundingBox.midY) < 0.04 &&
                        obs.text != line
                    }
                    for obs in nearby {
                        let ns = extractAllAmounts(from: obs.text).filter { $0 > 0 }
                        if let amt = ns.last {
                            candidates.append((amt, obs.boundingBox.midY))
                        }
                    }
                }

                // Next line
                if idx + 1 < lines.count {
                    let nextNums = extractAllAmounts(from: lines[idx + 1]).filter { $0 > 0 }
                    if let amt = nextNums.last {
                        let yPos = observations.first(where: { $0.text == lines[idx+1] })?.boundingBox.midY ?? 0.5
                        candidates.append((amt, yPos))
                    }
                }
            }
        }

        // Return candidate that's lowest in document (smallest minY in Vision = bottom)
        return candidates.min(by: { $0.1 < $1.1 })?.0
    }

    // MARK: – Date extractor

    private static func extractDate(from text: String) -> String? {
        if let iso = firstMatch(of: #"\b(\d{4}-\d{2}-\d{2})\b"#, in: text) { return iso }

        for sep in ["/", "."] {
            let escaped = NSRegularExpression.escapedPattern(for: sep)
            let pat = #"(\d{1,2})"# + escaped + #"(\d{1,2})"# + escaped + #"(\d{2,4})"#
            if let m = firstMatch(of: pat, in: text, fullMatch: true) {
                let p = m.components(separatedBy: CharacterSet(charactersIn: "/. ")).compactMap(Int.init)
                if p.count == 3 {
                    var y = p[2]; if y < 100 { y += 2500 }; if y > 2400 { y -= 543 }
                    if p[0] <= 31 && p[1] <= 12 {
                        return String(format: "%04d-%02d-%02d", y, p[1], p[0])
                    }
                }
            }
        }

        let months: [String: Int] = [
            "ม.ค.":1,"ก.พ.":2,"มี.ค.":3,"เม.ย.":4,"พ.ค.":5,"มิ.ย.":6,
            "ก.ค.":7,"ส.ค.":8,"ก.ย.":9,"ต.ค.":10,"พ.ย.":11,"ธ.ค.":12,
            "มกราคม":1,"กุมภาพันธ์":2,"มีนาคม":3,"เมษายน":4,"พฤษภาคม":5,
            "มิถุนายน":6,"กรกฎาคม":7,"สิงหาคม":8,"กันยายน":9,"ตุลาคม":10,
            "พฤศจิกายน":11,"ธันวาคม":12,
            "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
            "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12
        ]
        for (mn, mv) in months {
            let e = NSRegularExpression.escapedPattern(for: mn)
            if let m = firstMatch(of: #"(\d{1,2})\s*"# + e + #"\s*(\d{4})"#, in: text, fullMatch: true) {
                let nums = m.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }.compactMap(Int.init)
                if nums.count >= 2 {
                    var y = nums.last!; if y > 2400 { y -= 543 }
                    return String(format: "%04d-%02d-%02d", y, mv, nums[0])
                }
            }
        }
        return nil
    }

    // MARK: – Helpers

    private static func cleanName(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
           .replacingOccurrences(of: #"[\t]+"#, with: " ", options: .regularExpression)
    }

    private static func extractAllAmounts(from text: String) -> [Double] {
        let pattern = #"[฿$]?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)"#
        return matches(of: pattern, in: text)
            .map { $0.replacingOccurrences(of: ",", with: "") }
            .compactMap(Double.init)
    }

    private static func lineAfterKeyword(_ keyword: String, in lines: [String],
                                          sameLineAllowed: Bool = false) -> String? {
        for (i, line) in lines.enumerated() {
            if line.localizedCaseInsensitiveContains(keyword) {
                if sameLineAllowed, let r = line.range(of: ":") {
                    let after = String(line[r.upperBound...]).trimmingCharacters(in: .whitespaces)
                    if after.count >= 2 { return after }
                }
                if i + 1 < lines.count {
                    let next = lines[i + 1].trimmingCharacters(in: .whitespaces)
                    if next.count >= 2 { return next }
                }
            }
        }
        return nil
    }

    private static func matches(of pattern: String, in text: String,
                                 options: NSRegularExpression.Options = []) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap {
            $0.numberOfRanges > 1 ? ns.substring(with: $0.range(at: 1)) : nil
        }
    }

    private static func firstMatch(of pattern: String, in text: String,
                                    captureIndex: Int? = 1, fullMatch: Bool = false,
                                    options: NSRegularExpression.Options = []) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        if fullMatch { return ns.substring(with: m.range) }
        let idx = captureIndex ?? 0
        guard idx < m.numberOfRanges else { return nil }
        let r = m.range(at: idx)
        guard r.location != NSNotFound else { return nil }
        return ns.substring(with: r)
    }
}
