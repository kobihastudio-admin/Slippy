import SwiftUI

struct OCRFullDetailView: View {
    /// `@State` (not `let`) so saving an edit updates what THIS screen shows
    /// too — previously the display tabs read this raw value directly while
    /// editing fields lived in a separate `correction` copy, so tapping
    /// "บันทึก" made the screen appear to revert/discard the edit even
    /// though it (separately) reached the training-feedback payload.
    @State private var extraction: SlipExtraction
    /// Called when the user taps "บันทึก" after editing — hands back a
    /// `SlipExtraction` with every correction applied (vendor/total/etc.
    /// fields, and line items with `.hidden` ones dropped + the rest tagged
    /// by their reviewed isLineItem flag). Without this, edits made here
    /// only ever fed the separate "ส่งให้ Slippy เรียนรู้" training payload
    /// and never changed what the caller actually displays/uploads — pass
    /// this from the caller (e.g. CameraPickerView) to close that gap.
    var onApply: ((SlipExtraction) -> Void)? = nil
    /// The original scanned/picked photo, when available — powers
    /// "ดาวน์โหลดใบเสร็จต้นฉบับ". Not every entry point has one on hand yet
    /// (e.g. a receipt already synced from a previous session), so the
    /// download button simply doesn't appear when this is nil.
    let originalImage: UIImage?

    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    // Receipt tab first — reads top-to-bottom like the physical receipt
    // itself (vendor → items → total), which is the most immediately
    // recognizable layout. The other tabs are supporting detail/reference,
    // not what someone opening this screen wants to see first.
    @State private var selectedTab: Tab = .receipt
    @State private var rawSearchText = ""
    @State private var showRawTextDetails = false
    @State private var isEditing = false
    @State private var correction: OCRCorrection
    @State private var isSending = false
    @State private var sendResult: String? = nil
    @State private var showShareSheet = false
    @StateObject private var categoriesVM = DocumentCategoriesViewModel()
    // Part B: when this screen is opened for an uploaded document, poll the
    // server pipeline and swap the crude on-device reading for Claude's clean,
    // fully-classified result (correct line items, no junk rows).
    @State private var isSyncingServer = false
    @State private var serverSynced = false

    init(extraction: SlipExtraction, documentId: String? = nil, imagePath: String? = nil,
         originalImage: UIImage? = nil, onApply: ((SlipExtraction) -> Void)? = nil) {
        _extraction = State(initialValue: extraction)
        self.originalImage = originalImage
        self.onApply = onApply
        var c = OCRCorrection(from: extraction)
        c.documentId = documentId
        c.imagePath  = imagePath
        _correction  = State(initialValue: c)
    }

    // Only the two financially-meaningful views are shown. The raw "ตัวเลขที่พบ"
    // (every number found) and "ข้อความต้นฉบับ" (raw OCR text) tabs were debug
    // surfaces that cluttered the screen with non-financial noise.
    enum Tab: String, CaseIterable {
        case receipt = "ใบเสร็จ"
        case overview = "ภาพรวม"

        var icon: String {
            switch self {
            case .receipt:  return "list.bullet.rectangle"
            case .overview: return "doc.text.magnifyingglass"
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                tabBar
                Divider().opacity(0.5)
                TabView(selection: $selectedTab) {
                    itemsTab.tag(Tab.receipt)
                    summaryTab.tag(Tab.overview)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selectedTab)
            }
            .task { if let orgId = authVM.org?.id { await categoriesVM.load(orgId: orgId) } }
            .task(id: correction.documentId) { await syncFromServer() }
            .overlay(alignment: .top) {
                if isSyncingServer && !serverSynced {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        Text("กำลังอ่านด้วย AI…")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Color.textSecondary)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.top, 8)
                }
            }
            .background(Color.background)
            .navigationTitle("ผลการอ่านเอกสาร")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                        .foregroundColor(Color.brand500)
                        .fontWeight(.semibold)
                }
                ToolbarItem(placement: .primaryAction) {
                    if isEditing {
                        Button("บันทึก") {
                            OCRCorrectionStore.save(correction)
                            let applied = correction.appliedExtraction(basedOn: extraction)
                            extraction = applied   // so this screen's own display reflects the edit too
                            onApply?(applied)
                            isEditing = false
                            hapticSuccess()
                        }
                        .fontWeight(.bold)
                        .foregroundColor(Color.brand500)
                    } else {
                        HStack(spacing: 8) {
                            if originalImage != nil {
                                Button {
                                    hapticLight()
                                    showShareSheet = true
                                } label: {
                                    Image(systemName: "square.and.arrow.down")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundColor(Color.brand500)
                                        .frame(width: 30, height: 30)
                                        .background(Color.brand500.opacity(0.1))
                                        .clipShape(Circle())
                                }
                            }
                            confidencePill
                            Button {
                                hapticLight()
                                isEditing = true
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "pencil")
                                        .font(.system(size: 12, weight: .bold))
                                    Text("แก้ไข")
                                        .font(.system(size: 13, weight: .bold))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Color.brand500)
                                .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
            .sheet(isPresented: $showShareSheet) {
                if let originalImage {
                    ActivityShareSheet(items: [originalImage])
                }
            }
        }
    }

    // MARK: – Tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { tab in
                let active = selectedTab == tab
                Button { withAnimation(.spring(response: 0.3)) { selectedTab = tab } } label: {
                    VStack(spacing: 5) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 16, weight: active ? .semibold : .regular))
                            .foregroundColor(active ? Color.brand500 : Color.textSecondary)
                        Text(tab.rawValue)
                            .font(.system(size: 10, weight: active ? .bold : .medium))
                            .foregroundColor(active ? Color.brand500 : Color.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                        active ? Color.brand500.opacity(0.08) : Color.clear
                    )
                    .overlay(alignment: .bottom) {
                        if active {
                            Rectangle()
                                .fill(Color.brand500)
                                .frame(height: 2)
                                .matchedGeometryEffect(id: "tab_underline", in: tabNS)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .background(Color.surface)
    }

    @Namespace private var tabNS

    // MARK: ─────────────────────────────────────────────────────
    // MARK: Tab 1 – สรุป
    // ─────────────────────────────────────────────────────────────

    private var summaryTab: some View {
        ScrollView {
            VStack(spacing: 14) {

                // ── Low-confidence call-to-action ───────────────────────────────
                // Previously the only way to discover editing was a small
                // pencil icon in the toolbar — fields AI wasn't sure about
                // had no clear path to "fix this now." This surfaces them
                // immediately with a one-tap way into edit mode.
                if !isEditing && !lowConfidenceFieldLabels.isEmpty {
                    lowConfidenceBanner
                }

                // ── Hero: total amount ────────────────────────────────────────
                heroCard

                // ── Warnings ─────────────────────────────────────────────────
                if !extraction.warnings.isEmpty {
                    warningSection
                }

                // ── Vendor info ───────────────────────────────────────────────
                infoCard(title: "ข้อมูลผู้ขาย", icon: "building.2.fill", iconColor: Color(hex: "#6366f1")) {
                    if isEditing {
                        editRow(label: "ชื่อร้าน / บริษัท", icon: "storefront", binding: $correction.vendorName)
                        editRow(label: "เลขผู้เสียภาษี", icon: "number", binding: $correction.vendorTaxId, keyboard: .numberPad)
                    } else {
                        infoRow(label: "ชื่อร้าน / บริษัท",
                                value: extraction.vendorName,
                                conf: extraction.fieldConfidence.vendorName,
                                icon: "storefront")
                        if let addr = extraction.vendorAddress {
                            infoRow(label: "ที่อยู่", value: addr, conf: 0.7, icon: "mappin")
                        }
                        infoRow(label: "เลขผู้เสียภาษี",
                                value: extraction.vendorTaxId.map { formatTaxId($0) },
                                conf: extraction.vendorTaxId != nil ? 0.95 : 0,
                                icon: "number")
                    }
                }

                // ── Document info ─────────────────────────────────────────────
                infoCard(title: "ข้อมูลเอกสาร", icon: "doc.text.fill", iconColor: Color(hex: "#0ea5e9")) {
                    if isEditing {
                        docTypePickerRow
                        editRow(label: "วันที่ (yyyy-MM-dd)", icon: "calendar", binding: $correction.docDate)
                        editRow(label: "เลขอ้างอิง", icon: "number.square", binding: $correction.docNumber)
                        editRow(label: "วิธีชำระ", icon: "creditcard", binding: $correction.paymentMethod)
                        expenseCategoryPickerRow
                    } else {
                        infoRow(label: "ประเภท",
                                value: DocTypeOption(rawValue: extraction.docType)?.label ?? extraction.docType,
                                conf: 0.8, icon: "tag")
                        infoRow(label: "วันที่",
                                value: extraction.docDate.flatMap(formatDocDate),
                                conf: extraction.fieldConfidence.docDate,
                                icon: "calendar")
                        infoRow(label: "เลขอ้างอิง",
                                value: extraction.docNumber,
                                conf: extraction.fieldConfidence.docNumber,
                                icon: "number.square")
                        if let pm = extraction.paymentMethod {
                            infoRow(label: "วิธีชำระเงิน", value: pm, conf: 0.85, icon: "creditcard")
                        }
                        if let cat = extraction.expenseCategory {
                            infoRow(label: "หมวดหมู่ค่าใช้จ่าย", value: cat, conf: 1, icon: "folder.fill")
                        }
                    }
                }

                // ── Amount breakdown ──────────────────────────────────────────
                amountBreakdownCard

                // ── Stats row ─────────────────────────────────────────────────
                statsRow

                // ── Feedback section ──────────────────────────────────────────
                VStack(spacing: 10) {
                    if let result = sendResult {
                        HStack(spacing: 8) {
                            Image(systemName: result.hasPrefix("✓") ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.hasPrefix("✓") ? Color.statusApproved : .red)
                            Text(result)
                                .font(.system(size: 13))
                                .foregroundColor(Color.textPrimary)
                        }
                        .padding(12)
                        .background((result.hasPrefix("✓") ? Color.statusApproved : Color.statusFailed).opacity(0.12))
                        .cornerRadius(10)
                    }

                    Button {
                        Task { await sendFeedbackToSlippy() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSending {
                                ProgressView().scaleEffect(0.8).tint(.white)
                            } else {
                                Image(systemName: "brain.head.profile")
                                    .font(.system(size: 14))
                            }
                            Text(isSending ? "กำลังส่ง…" : "ส่งให้ Slippy เรียนรู้")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(
                            LinearGradient(colors: [Color(hex: "#6366f1"), Color(hex: "#818cf8")],
                                           startPoint: .leading, endPoint: .trailing)
                        )
                        .cornerRadius(14)
                    }
                    .disabled(isSending)

                    Text("ช่วยปรับปรุงการอ่านเอกสารในอนาคต — ไม่มีข้อมูลส่วนตัว")
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 4)

            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .padding(.bottom, 20)
        }
    }

    // Hero card with big total
    private var heroCard: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(LinearGradient(
                    colors: [Color(hex: "#6366f1"), Color(hex: "#818cf8")],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))

            VStack(spacing: 6) {
                Text("ยอดรวมทั้งสิ้น")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.8))
                    .textCase(.uppercase)
                    .tracking(1)

                if let total = extraction.totalAmount {
                    Text(fmtTHB(total))
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                } else {
                    Text("ไม่พบยอดรวม")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.white.opacity(0.6))
                }

                HStack(spacing: 16) {
                    if let sub = extraction.subtotal {
                        amtChip("ก่อนภาษี", fmtTHB(sub))
                    }
                    if let vat = extraction.vatAmount {
                        amtChip("VAT", fmtTHB(vat))
                    }
                    if let wht = extraction.whtAmount {
                        amtChip("WHT", fmtTHB(wht))
                    }
                }
                .padding(.top, 4)
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 20)
        }
        .shadow(color: Color(hex: "#6366f1").opacity(0.3), radius: 12, x: 0, y: 6)
    }

    private func amtChip(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(.white.opacity(0.7))
            Text(value)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.white.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    /// Fields whose AI confidence is low enough to be worth a second look —
    /// drives both the banner above and the "ตรวจสอบ" badges on individual
    /// rows further down.
    private var lowConfidenceFieldLabels: [String] {
        var labels: [String] = []
        let fc = extraction.fieldConfidence
        if extraction.vendorName != nil, fc.vendorName < 0.5  { labels.append("ชื่อร้าน") }
        if extraction.totalAmount != nil, fc.totalAmount < 0.5 { labels.append("ยอดรวม") }
        if extraction.docDate != nil, fc.docDate < 0.5         { labels.append("วันที่") }
        if extraction.docNumber != nil, fc.docNumber < 0.5     { labels.append("เลขอ้างอิง") }
        return labels
    }

    private var lowConfidenceBanner: some View {
        Button {
            hapticLight()
            isEditing = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                VStack(alignment: .leading, spacing: 2) {
                    Text("AI ไม่มั่นใจ \(lowConfidenceFieldLabels.count) รายการ")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                    Text(lowConfidenceFieldLabels.joined(separator: " · ") + " — แตะเพื่อตรวจสอบ")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.85))
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding(12)
            .background(
                LinearGradient(colors: [Color(hex: "#f59e0b"), Color(hex: "#d97706")],
                               startPoint: .leading, endPoint: .trailing)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    // Warning banners
    private var warningSection: some View {
        VStack(spacing: 6) {
            ForEach(extraction.warnings, id: \.self) { w in
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#d97706"))
                    Text(w)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color.textPrimary)
                    Spacer()
                }
                .padding(12)
                .background(Color.statusReviewing.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.statusReviewing.opacity(0.45), lineWidth: 1)
                )
                .cornerRadius(10)
            }
        }
    }

    // Generic info card
    @ViewBuilder
    private func infoCard(title: String, icon: String, iconColor: Color,
                           @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(iconColor)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            Divider().padding(.horizontal, 16)

            content()
                .padding(.bottom, 8)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    // Info row with field confidence pill — low-confidence rows are tappable
    // and jump straight into edit mode, instead of making the user hunt for
    // the edit button after noticing something looks off.
    @ViewBuilder
    private func infoRow(label: String, value: String?, conf: Double, icon: String) -> some View {
        if let value = value {
            let isLow = conf > 0 && conf < 0.5
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
                    .frame(width: 18)
                    .padding(.top, 3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color.textSecondary)
                        .textCase(.uppercase)
                        .tracking(0.5)
                    Text(value)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if conf > 0 {
                    confDot(conf)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(isLow ? Color(hex: "#f59e0b").opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
            .onTapGesture {
                guard isLow else { return }
                hapticLight()
                isEditing = true
            }
        }
    }

    // Amount breakdown card with visual bar
    private var amountBreakdownCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(Color(hex: "#10b981"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text("โครงสร้างราคา")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color.textPrimary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            Divider().padding(.horizontal, 16)

            if isEditing {
                VStack(spacing: 0) {
                    editRow(label: "ยอดรวมทั้งสิ้น", icon: "banknote", binding: $correction.totalAmount, keyboard: .decimalPad)
                    Divider().padding(.leading, 46)
                    editRow(label: "ราคาก่อนภาษี", icon: "minus.circle", binding: $correction.subtotal, keyboard: .decimalPad)
                    Divider().padding(.leading, 46)
                    editRow(label: "ภาษีมูลค่าเพิ่ม", icon: "percent", binding: $correction.vatAmount, keyboard: .decimalPad)
                    Divider().padding(.leading, 46)
                    editRow(label: "หัก ณ ที่จ่าย", icon: "arrow.down.circle", binding: $correction.whtAmount, keyboard: .decimalPad)
                }
            } else if let total = extraction.totalAmount {
                VStack(spacing: 10) {
                    // Visual bar
                    if let sub = extraction.subtotal, let vat = extraction.vatAmount, total > 0 {
                        GeometryReader { geo in
                            HStack(spacing: 2) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color(hex: "#6366f1"))
                                    .frame(width: geo.size.width * (sub / total))
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color(hex: "#f59e0b"))
                                    .frame(width: geo.size.width * (vat / total))
                            }
                        }
                        .frame(height: 10)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                        HStack(spacing: 14) {
                            legendDot(Color(hex: "#6366f1"), "ก่อนภาษี")
                            legendDot(Color(hex: "#f59e0b"), "VAT")
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                    }

                    // Rows
                    amtBreakRow("ราคาก่อนภาษี", extraction.subtotal, color: Color(hex: "#6366f1"))
                    amtBreakRow("ภาษีมูลค่าเพิ่ม", extraction.vatAmount, color: Color(hex: "#f59e0b"))
                    if let wht = extraction.whtAmount {
                        amtBreakRow("หัก ณ ที่จ่าย", wht, color: Color(hex: "#ef4444"))
                    }

                    Divider().padding(.horizontal, 16)

                    HStack {
                        Text("ยอดรวมทั้งสิ้น")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(Color.textPrimary)
                        Spacer()
                        Text(fmtTHB(total))
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .foregroundColor(Color.brand500)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                }
            } else {
                Text("ไม่พบข้อมูลยอดเงิน")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .padding(16)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    @ViewBuilder
    private func amtBreakRow(_ label: String, _ value: Double?, color: Color) -> some View {
        if let value = value {
            HStack {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(label)
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                Spacer()
                Text(fmtTHB(value))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(Color.textPrimary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Color.textSecondary)
        }
    }

    // Stats row
    private var statsRow: some View {
        HStack(spacing: 8) {
            statChip("\(extraction.rawObservations.count)", "บรรทัด", "text.alignleft", Color(hex: "#6366f1"))
            statChip("\(extraction.allAmountsFound.count)", "ตัวเลข", "number", Color(hex: "#10b981"))
            statChip("\(extraction.lineItems.count)", "รายการ", "list.bullet", Color(hex: "#f59e0b"))
        }
    }

    private func statChip(_ value: String, _ label: String, _ icon: String, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundColor(color)
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color.textPrimary)
                Text(label)
                    .font(.system(size: 10))
                    .foregroundColor(Color.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 10)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 1)
    }

    // MARK: ─────────────────────────────────────────────────────
    // MARK: Tab 2 – ข้อความทั้งหมด
    // ─────────────────────────────────────────────────────────────

    private var rawTextTab: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                TextField("ค้นหาข้อความ…", text: $rawSearchText)
                    .font(.system(size: 13))
                if !rawSearchText.isEmpty {
                    Button { rawSearchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(Color.textSecondary)
                    }
                }
            }
            .padding(10)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)

            // Legend + details toggle — line numbers/Y-position/exact % are
            // debugging info most users never need; hidden by default so
            // this reads as plain transcribed text instead of a QA report.
            HStack(spacing: 12) {
                legendItem(.green,  "ความมั่นใจสูง")
                legendItem(.orange, "ปานกลาง")
                legendItem(.red,    "ต่ำ")
                Spacer()
                Button {
                    hapticLight()
                    withAnimation(.easeInOut(duration: 0.15)) { showRawTextDetails.toggle() }
                } label: {
                    HStack(spacing: 3) {
                        Text(showRawTextDetails ? "ซ่อนรายละเอียด" : "แสดงรายละเอียด")
                        Image(systemName: showRawTextDetails ? "chevron.up" : "chevron.down")
                    }
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color.brand500)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            Divider()

            // Grouped by section
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
                    let grouped = groupedObs
                    ForEach(grouped, id: \.section) { group in
                        Section {
                            ForEach(Array(group.obs.enumerated()), id: \.element.id) { idx, obs in
                                rawObsRow(obs: obs, globalIdx: group.startIdx + idx)
                            }
                        } header: {
                            sectionHeader(group.section)
                        }
                    }
                }
                .padding(.bottom, 32)
            }
        }
    }

    private var filteredObs: [OCRObservation] {
        if rawSearchText.isEmpty { return extraction.rawObservations }
        return extraction.rawObservations.filter {
            $0.text.localizedCaseInsensitiveContains(rawSearchText)
        }
    }

    private struct ObsGroup {
        let section: OCRObservation.DocSection
        let obs: [OCRObservation]
        let startIdx: Int
    }

    private var groupedObs: [ObsGroup] {
        let sections: [OCRObservation.DocSection] = [.header, .body, .footer]
        var groups: [ObsGroup] = []
        var counter = 1
        for sec in sections {
            let items = filteredObs.filter { $0.section == sec }
            if !items.isEmpty {
                groups.append(ObsGroup(section: sec, obs: items, startIdx: counter))
                counter += items.count
            }
        }
        return groups
    }

    private func sectionHeader(_ section: OCRObservation.DocSection) -> some View {
        HStack(spacing: 6) {
            Text(section.rawValue.uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Color.textSecondary)
                .tracking(1)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(Color.background)
    }

    private func rawObsRow(obs: OCRObservation, globalIdx: Int) -> some View {
        let confColor: Color = obs.confidence > 0.9 ? Color(hex: "#10b981") :
                               obs.confidence > 0.7 ? Color(hex: "#f59e0b") : Color(hex: "#ef4444")

        return HStack(alignment: .center, spacing: 0) {
            // Line number — technical detail, only shown in expanded mode
            if showRawTextDetails {
                Text("\(globalIdx)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(Color.textSecondary.opacity(0.4))
                    .frame(width: 30, alignment: .trailing)
                    .padding(.trailing, 8)
            }

            // Confidence color bar
            Rectangle()
                .fill(confColor)
                .frame(width: 3)
                .cornerRadius(2)
                .padding(.vertical, 4)

            // Text content
            VStack(alignment: .leading, spacing: 2) {
                Text(obs.text)
                    .font(.system(size: 14))
                    .foregroundColor(Color.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .multilineTextAlignment(.leading)

                if showRawTextDetails {
                    HStack(spacing: 8) {
                        // Confidence %
                        Text("\(Int(obs.confidence * 100))%")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(confColor)

                        // Position
                        Text("Y:\(Int(obs.boundingBox.midY * 100))%")
                            .font(.system(size: 9))
                            .foregroundColor(Color.textSecondary.opacity(0.5))

                        if obs.isRightAligned {
                            Label("คอลัมน์ขวา", systemImage: "arrow.right.to.line")
                                .font(.system(size: 9))
                                .foregroundColor(Color.brand500.opacity(0.7))
                        }
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(globalIdx % 2 == 0 ? Color.clear : Color.surface.opacity(0.6))
    }

    private func legendItem(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 10, height: 10)
            Text(label).font(.system(size: 9)).foregroundColor(Color.textSecondary)
        }
    }

    // MARK: ─────────────────────────────────────────────────────
    // MARK: Tab 3 – ตัวเลข
    // ─────────────────────────────────────────────────────────────

    private var amountsTab: some View {
        ScrollView {
            VStack(spacing: 14) {

                // Summary chips
                HStack(spacing: 8) {
                    let tagged = taggedAmounts
                    let mappedCount = tagged.filter { $0.tag != nil }.count
                    let unmappedCount = tagged.count - mappedCount

                    amtStatChip("\(tagged.count)", "ตัวเลขทั้งหมด", Color.brand500)
                    amtStatChip("\(mappedCount)", "ระบุแล้ว", Color(hex: "#10b981"))
                    amtStatChip("\(unmappedCount)", "ยังไม่ระบุ", Color.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)

                // Tagged (identified) amounts first
                let tagged = taggedAmounts
                let identified = tagged.filter { $0.tag != nil }
                let unidentified = tagged.filter { $0.tag == nil }

                if !identified.isEmpty {
                    amtGroup(title: "ตัวเลขที่ระบุได้", items: identified, showTag: true)
                }

                if !unidentified.isEmpty {
                    amtGroup(title: "ตัวเลขอื่นๆ ที่พบ", items: unidentified, showTag: false)
                }

                if tagged.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "number.square")
                            .font(.system(size: 40))
                            .foregroundColor(Color.border)
                        Text("ไม่พบตัวเลขในเอกสาร")
                            .font(.system(size: 14))
                            .foregroundColor(Color.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                }
            }
            .padding(.bottom, 32)
        }
    }

    private func amtStatChip(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 20, weight: .black, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.04), radius: 4)
    }

    private func amtGroup(title: String, items: [TaggedAmount], showTag: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Color.textSecondary)
                .textCase(.uppercase)
                .tracking(0.5)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                    amtRow(item: item, idx: idx, showTag: showTag)
                    if idx < items.count - 1 {
                        Divider().padding(.leading, 16)
                    }
                }
            }
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            .padding(.horizontal, 16)
        }
    }

    private func amtRow(item: TaggedAmount, idx: Int, showTag: Bool) -> some View {
        HStack {
            Circle()
                .fill(item.tag != nil ? Color.brand500 : Color.border)
                .frame(width: 6, height: 6)

            Text(fmtTHB(item.amount))
                .font(.system(size: 16, weight: item.tag != nil ? .bold : .regular, design: .rounded))
                .foregroundColor(item.tag != nil ? Color.textPrimary : Color.textSecondary)

            Spacer()

            if showTag, let tag = item.tag {
                HStack(spacing: 4) {
                    Circle().fill(tagColor(tag)).frame(width: 6, height: 6)
                    Text(tag)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(tagColor(tag))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(tagColor(tag).opacity(0.1))
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func tagColor(_ tag: String) -> Color {
        switch tag {
        case "ยอดรวม":  return Color.brand500
        case "ก่อนภาษี": return Color(hex: "#6366f1")
        case "VAT":     return Color(hex: "#f59e0b")
        case "WHT":     return Color(hex: "#ef4444")
        default:        return Color.textSecondary
        }
    }

    private struct TaggedAmount {
        let amount: Double
        let tag: String?
    }

    private var taggedAmounts: [TaggedAmount] {
        extraction.allAmountsFound.map { n in
            var tag: String? = nil
            if let v = extraction.totalAmount, abs(v - n) < 0.01 { tag = "ยอดรวม" }
            else if let v = extraction.subtotal, abs(v - n) < 0.01 { tag = "ก่อนภาษี" }
            else if let v = extraction.vatAmount, abs(v - n) < 0.01 { tag = "VAT" }
            else if let v = extraction.whtAmount, abs(v - n) < 0.01 { tag = "WHT" }
            return TaggedAmount(amount: n, tag: tag)
        }
    }

    // MARK: ─────────────────────────────────────────────────────
    // MARK: Tab 4 – รายการ
    // ─────────────────────────────────────────────────────────────

    /// Part B — poll the server pipeline for this uploaded document and, once
    /// processed, replace the crude on-device reading with Claude's clean,
    /// classified result (proper line items, correct vendor/subtotal/VAT/total).
    /// No-op when there's no documentId (pre-upload preview). Best-effort.
    @MainActor
    private func syncFromServer() async {
        guard let docId = correction.documentId, !serverSynced else { return }
        struct DocRow: Decodable {
            let status: String?; let vendor_name: String?; let vendor_tax_id: String?
            let subtotal: Double?; let discount_amount: Double?; let vat_amount: Double?; let total_amount: Double?
        }
        struct ItemRow: Decodable {
            let description: String?; let quantity: Double?
            let unit_price: Double?; let amount: Double?
        }
        isSyncingServer = true
        defer { isSyncingServer = false }
        for _ in 0..<12 {   // ~24s ceiling while the pipeline runs
            do {
                let docs: [DocRow] = try await SupabaseManager.shared.client
                    .from("documents")
                    .select("status,vendor_name,vendor_tax_id,subtotal,discount_amount,vat_amount,total_amount")
                    .eq("id", value: docId).limit(1).execute().value
                if let d = docs.first, d.status != "processing", d.status != "pending" {
                    let rows: [ItemRow] = try await SupabaseManager.shared.client
                        .from("document_line_items").select()
                        .eq("document_id", value: docId)
                        .order("sort_order", ascending: true).execute().value
                    var ex = extraction
                    if let v = d.vendor_name, !v.isEmpty { ex.vendorName = v }
                    if let t = d.vendor_tax_id, !t.isEmpty { ex.vendorTaxId = t }
                    if let s = d.subtotal { ex.subtotal = s }
                    if let dc = d.discount_amount { ex.discountAmount = dc }
                    if let vt = d.vat_amount { ex.vatAmount = vt }
                    if let tot = d.total_amount { ex.totalAmount = tot }
                    if !rows.isEmpty {
                        ex.lineItems = rows.map {
                            LineItem(name: $0.description ?? "", qty: $0.quantity,
                                     unitPrice: $0.unit_price, amount: $0.amount ?? 0)
                        }
                    }
                    extraction = ex
                    var c = OCRCorrection(from: ex)
                    c.documentId = docId
                    c.imagePath  = correction.imagePath
                    correction = c
                    serverSynced = true
                    hapticSuccess()
                    return
                }
            } catch { /* transient — retry */ }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    private var itemsTab: some View {
        ScrollView {
            VStack(spacing: 0) {
                if extraction.lineItems.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "list.bullet.rectangle")
                            .font(.system(size: 48))
                            .foregroundColor(Color.border)
                        Text("ไม่พบรายการสินค้า")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Color.textSecondary)
                        Text("เอกสารนี้อาจไม่มีรายการสินค้า\nหรือรูปแบบไม่รองรับการอ่านอัตโนมัติ")
                            .font(.system(size: 13))
                            .foregroundColor(Color.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 80)
                } else {
                    // Receipt-style card
                    VStack(spacing: 0) {
                        // Vendor header — mirrors the Dashboard hero card so the
                        // document screens read as the same product as the home
                        // screen (same gradient, same weight hierarchy).
                        HStack(spacing: 10) {
                            Image(systemName: "receipt.fill")
                                .font(.system(size: 15))
                                .foregroundColor(.white.opacity(0.9))
                                .frame(width: 32, height: 32)
                                .background(Color.white.opacity(0.18))
                                .clipShape(RoundedRectangle(cornerRadius: 10))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(extraction.vendorName ?? "ไม่ระบุร้านค้า")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(.white)
                                    .lineLimit(2)
                                if let date = extraction.docDate.flatMap(formatDocDate) {
                                    Text(date)
                                        .font(.system(size: 12))
                                        .foregroundColor(.white.opacity(0.75))
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(
                            LinearGradient(
                                colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1"), Color(hex: "#4f46e5")],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            )
                        )

                        // Column header
                        HStack {
                            Text("รายการ")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                            Spacer()
                            Text("จำนวน")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                                .frame(width: 44, alignment: .center)
                            Text("ราคา")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                                .frame(width: 72, alignment: .trailing)
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 8)

                        Divider()

                        if isEditing {
                            HStack(spacing: 6) {
                                Image(systemName: "info.circle.fill")
                                    .font(.system(size: 11)).foregroundColor(Color.brand500)
                                Text("แตะไอคอนเพื่อเลือกว่ารายการนี้ต้องนับเข้าผลรวมหรือไม่ — เช่น เงินสด/เงินทอน ไม่ใช่รายการสินค้า")
                                    .font(.system(size: 11)).foregroundColor(Color.textSecondary)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(Color.brand500.opacity(0.05))
                        }

                        // Items — bound to `correction` so the user can fix
                        // the name and mark what each one actually is before
                        // the correction is submitted.
                        ForEach(correction.lineItems.indices, id: \.self) { idx in
                            let item = correction.lineItems[idx]
                            if isEditing || item.kind != .hidden {
                                VStack(spacing: 0) {
                                    HStack(alignment: .top) {
                                        if isEditing {
                                            kindMenu(for: idx)
                                        }

                                        if isEditing {
                                            TextField("ชื่อรายการ", text: Binding(
                                                get: { correction.lineItems[idx].name },
                                                set: { correction.lineItems[idx].name = $0 }
                                            ))
                                            .font(.system(size: 13))
                                            .foregroundColor(item.kind == .lineItem ? Color.textPrimary : Color.textSecondary)
                                        } else {
                                            Text(item.name)
                                                .font(.system(size: 13))
                                                .foregroundColor(item.kind == .lineItem ? Color.textPrimary : Color.textSecondary)
                                                .strikethrough(item.kind != .lineItem)
                                                .multilineTextAlignment(.leading)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                        }

                                        if let qty = item.qty {
                                            Text("×\(qty == qty.rounded() ? String(Int(qty)) : String(format: "%.1f", qty))")
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundColor(Color.textSecondary)
                                                .frame(width: 44, alignment: .center)
                                        } else {
                                            Spacer().frame(width: 44)
                                        }

                                        Text(fmtTHB(item.amount))
                                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                                            .foregroundColor(item.kind == .lineItem ? Color.textPrimary : Color.textSecondary)
                                            .strikethrough(item.kind != .lineItem)
                                            .frame(width: 72, alignment: .trailing)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 11)

                                    if let up = item.unitPrice, item.qty != nil {
                                        HStack {
                                            Text("ราคาต่อหน่วย: \(fmtTHB(up))")
                                                .font(.system(size: 10))
                                                .foregroundColor(Color.textSecondary)
                                                .padding(.leading, 16)
                                            Spacer()
                                        }
                                        .padding(.bottom, 6)
                                    }

                                    // Thin dividers instead of the alternating
                                    // paper-receipt stripes: the Dashboard lists
                                    // separate rows this way, and the stripes were
                                    // what turned into white bands in dark mode.
                                    Divider().padding(.leading, 16)
                                }
                            }
                        }

                        if correction.lineItems.contains(where: { !$0.isLineItem }) {
                            // Line items never reconcile with the GRAND TOTAL — that
                            // one also carries VAT, WHT and fees. They reconcile with
                            // the pre-tax figure, but which pre-tax figure depends on
                            // how the shop prints discounts, and both conventions are
                            // legitimate:
                            //
                            //   gross — discounts are a separate line at the bottom,
                            //           so item amounts are list prices and sum to
                            //           the subtotal.
                            //   net   — discounts are already baked into each item
                            //           line, so the items sum to subtotal − discount.
                            //
                            // KOFUKU prints the net convention (259→239, 558→498; the
                            // two markdowns are exactly the 80 discount), which made a
                            // perfectly balanced receipt look broken when we only ever
                            // tested the gross figure. Accept either.
                            let gross    = extraction.subtotal ?? extraction.totalAmount ?? 0
                            let net      = gross - (extraction.discountAmount ?? 0)
                            let sum      = correction.includedLineItemsTotal
                            let balanced = abs(sum - gross) < 0.01 || abs(sum - net) < 0.01
                            // Label it with the same number the summary rows below call
                            // "ก่อนภาษี", otherwise the warning contradicts the table
                            // it sits on top of.
                            let expected = net
                            HStack(spacing: 6) {
                                Image(systemName: balanced ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(balanced ? Color.statusApproved : .orange)
                                Text(balanced
                                     ? "รายการรวม \(fmtTHB(correction.includedLineItemsTotal)) ตรงกับยอดก่อนภาษี"
                                     : "รายการรวม \(fmtTHB(correction.includedLineItemsTotal)) แต่ยอดก่อนภาษี \(fmtTHB(expected))")
                                    .font(.system(size: 11))
                                    .foregroundColor(Color.textSecondary)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            Divider()
                        }

                        Spacer().frame(height: 6)

                        // Mirror the printed receipt so the column visibly adds up.
                        // Showing only "ก่อนภาษี 1,126" hid the −80 discount, and
                        // 1,126 + 73.22 does not make 1,119.22 — the figures looked
                        // wrong even though every one of them was right. The receipt
                        // itself prints Subtotal → Discount → Before TAX → VAT → Total.
                        let discount = extraction.discountAmount ?? 0
                        if let sub = extraction.subtotal {
                            totalRow(discount > 0 ? "รวมรายการ" : "ก่อนภาษี", fmtTHB(sub), bold: false)
                            if discount > 0 {
                                totalRow("ส่วนลด", "-\(fmtTHB(discount))", bold: false)
                                totalRow("ก่อนภาษี", fmtTHB(sub - discount), bold: false)
                            }
                        }
                        if let vat = extraction.vatAmount {
                            totalRow("ภาษีมูลค่าเพิ่ม (VAT)", fmtTHB(vat), bold: false)
                        }
                        if let wht = extraction.whtAmount {
                            totalRow("หัก ณ ที่จ่าย", "-\(fmtTHB(wht))", bold: false)
                        }

                        // Grand total
                        if let total = extraction.totalAmount {
                            Divider()
                            HStack {
                                Text("ยอดรวมทั้งสิ้น")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(Color.textPrimary)
                                Spacer()
                                Text(fmtTHB(total))
                                    .font(.system(size: 20, weight: .black, design: .rounded))
                                    .foregroundColor(Color.brand500)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color.brand500.opacity(0.06))
                        }
                    }
                    .background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                }
            }
            .padding(.bottom, 32)
        }
    }

    /// Tap to pick what kind of item this is — real line item (counted),
    /// info-only (shown but not counted, e.g. เงินสด/เงินทอน), or hidden
    /// entirely.
    private func kindMenu(for idx: Int) -> some View {
        let kind = correction.lineItems[idx].kind
        return Menu {
            ForEach(LineItemKind.allCases, id: \.self) { option in
                Button {
                    hapticLight()
                    correction.lineItems[idx].kind = option
                } label: {
                    Label(option.label, systemImage: option.icon)
                }
            }
        } label: {
            Image(systemName: kind.icon)
                .font(.system(size: 16))
                .foregroundColor(kind == .lineItem ? Color.brand500 : Color.textSecondary.opacity(0.6))
        }
        .padding(.trailing, 4)
    }

    private func totalRow(_ label: String, _ value: String, bold: Bool) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 13, weight: bold ? .bold : .regular))
                .foregroundColor(bold ? Color.textPrimary : Color.textSecondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: bold ? .heavy : .semibold, design: .rounded))
                .foregroundColor(bold ? Color.brand500 : Color.textPrimary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: – Edit row

    @ViewBuilder
    /// Constrained picker over `DocTypeOption` — replaces a free-text field
    /// that let the user type any value, including ones the DB's CHECK
    /// constraint on `doc_type` would reject (insert/update would just fail).
    private var docTypePickerRow: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "tag").font(.system(size: 12)).foregroundColor(Color.textSecondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text("ประเภทเอกสาร").font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color.textSecondary).textCase(.uppercase).tracking(0.5)
                Menu {
                    ForEach(DocTypeOption.allCases, id: \.self) { option in
                        Button(option.label) {
                            hapticLight()
                            correction.docType = option.rawValue
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(DocTypeOption(rawValue: correction.docType)?.label ?? correction.docType)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                        Image(systemName: "chevron.down").font(.system(size: 10)).foregroundColor(Color.brand500)
                    }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.brand500.opacity(0.04))
    }

    /// Org-defined expense category picker (document_categories) — free-text
    /// fallback still works since `expense_category` is plain text, not a FK.
    private var expenseCategoryPickerRow: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "folder.fill").font(.system(size: 12)).foregroundColor(Color.textSecondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text("หมวดหมู่ค่าใช้จ่าย").font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color.textSecondary).textCase(.uppercase).tracking(0.5)
                TextField("หมวดหมู่ค่าใช้จ่าย", text: $correction.expenseCategory)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
            }
            Spacer()
            if !categoriesVM.categories.isEmpty {
                Menu {
                    ForEach(categoriesVM.categories) { cat in
                        Button(cat.name) {
                            hapticLight()
                            correction.expenseCategory = cat.name
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Color.brand500)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.brand500.opacity(0.04))
    }

    private func editRow(label: String, icon: String, binding: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundColor(Color.textSecondary)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Color.textSecondary)
                    .textCase(.uppercase)
                    .tracking(0.5)
                TextField(label, text: binding)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .keyboardType(keyboard)
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.brand500.opacity(0.04))
    }

    // MARK: – Send feedback

    private func sendFeedbackToSlippy() async {
        isSending = true
        sendResult = nil

        // Save locally first
        OCRCorrectionStore.save(correction)

        // Build payload
        struct FeedbackPayload: Encodable {
            let documentId: String?
            let imagePath: String?
            let original: [String: String]
            let corrected: [String: String]
            /// Line items as reviewed by the user — including which ones
            /// were unmarked as "ไม่ใช่ Line Item" (informational
            /// sub-components wrongly extracted as real line items), so the
            /// correction actually teaches the AI not to repeat that.
            let correctedLineItems: [CorrectedLineItem]
            let rawText: String
        }

        let payload = FeedbackPayload(
            documentId:  correction.documentId,
            imagePath:   correction.imagePath,
            original: [
                "vendorName":   correction.originalVendorName,
                "totalAmount":  correction.originalTotalAmount,
            ],
            corrected: [
                "vendorName":   correction.vendorName,
                "vendorTaxId":  correction.vendorTaxId,
                "totalAmount":  correction.totalAmount,
                "subtotal":     correction.subtotal,
                "vatAmount":    correction.vatAmount,
                "docDate":      correction.docDate,
                "docNumber":    correction.docNumber,
                "docType":      correction.docType,
                "paymentMethod": correction.paymentMethod,
            ],
            correctedLineItems: correction.lineItems,
            rawText: extraction.rawText
        )

        do {
            guard let url = URL(string: "\(Config.webAppURL)/api/ocr-feedback") else {
                sendResult = "❌ URL ไม่ถูกต้อง"
                isSending = false
                return
            }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(payload)
            req.timeoutInterval = 15

            let (_, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            sendResult = code == 200 || code == 201 ? "✓ ส่งข้อมูลเรียบร้อย ขอบคุณ!" : "❌ เกิดข้อผิดพลาด (\(code))"
        } catch {
            sendResult = "❌ \(error.localizedDescription)"
        }

        isSending = false
    }

    // MARK: – Shared helpers

    private var confidencePill: some View {
        let pct  = Int(extraction.confidence * 100)
        let color: Color = extraction.confidence > 0.75 ? Color(hex: "#10b981") :
                           extraction.confidence > 0.4  ? Color(hex: "#f59e0b") : Color(hex: "#ef4444")
        let icon = extraction.confidence > 0.75 ? "checkmark.circle.fill" :
                   extraction.confidence > 0.4  ? "exclamationmark.circle.fill" : "xmark.circle.fill"
        return Label("\(pct)%", systemImage: icon)
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.1))
            .clipShape(Capsule())
    }

    private func confDot(_ conf: Double) -> some View {
        let color: Color = conf > 0.8 ? Color(hex: "#10b981") :
                           conf > 0.5 ? Color(hex: "#f59e0b") : Color(hex: "#ef4444")
        // Below 50% gets an explicit "ตรวจสอบ" badge instead of just a tiny
        // dot + percentage — easy to miss what a number alone is asking you
        // to do with it.
        let isLow = conf < 0.5
        return HStack(spacing: 3) {
            if isLow {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 8))
            } else {
                Circle().fill(color).frame(width: 6, height: 6)
            }
            Text(isLow ? "ตรวจสอบ" : "\(Int(conf * 100))%")
                .font(.system(size: isLow ? 10 : 9, weight: isLow ? .bold : .semibold))
        }
        .foregroundColor(isLow ? .white : color)
        .padding(.horizontal, isLow ? 7 : 0)
        .padding(.vertical, isLow ? 3 : 0)
        .background(isLow ? color : Color.clear)
        .clipShape(Capsule())
    }

    private func formatDocDate(_ iso: String) -> String? {
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        guard let d = fmt.date(from: iso) else { return iso }
        let out = DateFormatter(); out.dateStyle = .long; out.locale = Locale(identifier: "th_TH")
        return out.string(from: d)
    }

    private func formatTaxId(_ id: String) -> String {
        // Format: x-xxxx-xxxxx-xx-x
        guard id.count == 13 else { return id }
        let chars = Array(id)
        return "\(chars[0])-\(String(chars[1...4]))-\(String(chars[5...9]))-\(String(chars[10...11]))-\(String(chars[12]))"
    }
}

#if DEBUG
#Preview {
    var ex = SlipExtraction(confidence: 0.78)
    ex.vendorName    = "ร้านซูชิโร่"
    ex.vendorAddress = "199/9 ถนนพระราม 2 กรุงเทพฯ"
    ex.vendorTaxId   = "0105558009224"
    ex.totalAmount   = 486
    ex.subtotal      = 454
    ex.vatAmount     = 32
    ex.docDate       = "2026-06-17"
    ex.docNumber     = "REC-2026-0617"
    ex.paymentMethod = "บัตรเครดิต"
    ex.allAmountsFound = [486, 454, 32, 200, 154, 100]
    ex.rawObservations = [
        OCRObservation(text: "ร้านซูชิโร่",    confidence: 0.97, boundingBox: CGRect(x: 0.1, y: 0.92, width: 0.5, height: 0.03), isRightAligned: false, section: .header),
        OCRObservation(text: "ราคาก่อนภาษี",  confidence: 0.94, boundingBox: CGRect(x: 0.1, y: 0.5,  width: 0.4, height: 0.03), isRightAligned: false, section: .body),
        OCRObservation(text: "454",            confidence: 0.99, boundingBox: CGRect(x: 0.7, y: 0.5,  width: 0.2, height: 0.03), isRightAligned: true,  section: .body),
        OCRObservation(text: "ภาษีมูลค่าเพิ่ม", confidence: 0.91, boundingBox: CGRect(x: 0.1, y: 0.45, width: 0.4, height: 0.03), isRightAligned: false, section: .body),
        OCRObservation(text: "32",             confidence: 0.88, boundingBox: CGRect(x: 0.7, y: 0.45, width: 0.2, height: 0.03), isRightAligned: true,  section: .body),
        OCRObservation(text: "ยอดรวมทั้งสิ้น",  confidence: 0.96, boundingBox: CGRect(x: 0.1, y: 0.3,  width: 0.4, height: 0.03), isRightAligned: false, section: .footer),
        OCRObservation(text: "486",            confidence: 0.99, boundingBox: CGRect(x: 0.7, y: 0.3,  width: 0.2, height: 0.03), isRightAligned: true,  section: .footer),
    ]
    ex.lineItems = [
        LineItem(name: "เซ็ตซูชิ A (8 ชิ้น)", qty: 2, unitPrice: 159, amount: 318),
        LineItem(name: "น้ำซุปมิโสะ",           qty: nil, unitPrice: nil, amount: 60),
        LineItem(name: "ชาเขียว (ร้อน)",        qty: 2, unitPrice: 38, amount: 76),
    ]
    return OCRFullDetailView(extraction: ex)
}
#endif
