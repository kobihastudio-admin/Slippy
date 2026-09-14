import SwiftUI
import Supabase

/// Pager wrapper — lets the user swipe left/right to move between documents
/// in the same list that opened this screen (recent docs on Dashboard, or
/// the full list in DocumentsView), instead of going back and reopening
/// another row each time. Each page is a fresh `DocumentDetailContentView`
/// with its own state, so swiping away from an in-progress edit discards it
/// the same way tapping the back button already does — no new data-loss
/// risk introduced.
struct DocumentDetailView: View {
    let documents: [SlippyDocument]
    @State private var currentIndex: Int

    /// `documents` defaults to just `[doc]` (no swipe, current behavior)
    /// for call sites that only have a single document and no surrounding
    /// list — e.g. opening a document straight from a search result.
    init(doc: SlippyDocument, documents: [SlippyDocument]? = nil) {
        let list = documents ?? [doc]
        self.documents = list
        _currentIndex = State(initialValue: list.firstIndex(where: { $0.id == doc.id }) ?? 0)
    }

    var body: some View {
        TabView(selection: $currentIndex) {
            ForEach(Array(documents.enumerated()), id: \.element.id) { index, doc in
                DocumentDetailContentView(doc: doc)
                    .tag(index)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }
}

struct DocumentDetailContentView: View {
    /// `@State` (not `let`) — `headerCard` reads vendor name/total/VAT
    /// straight from this, so after a successful edit it must update too.
    /// Previously this was immutable, so the header at the top of the
    /// screen kept showing the pre-edit values forever after tapping
    /// "บันทึก" — looked exactly like saving did nothing.
    @State private var doc: SlippyDocument
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmAction: String?
    @State private var isActing = false

    // ── Receipt image viewer ───────────────────────────────────────────────
    @State private var showImageViewer  = false
    @State private var imageURL: URL?
    @State private var isLoadingImage   = false
    @State private var imageLoadError: String?

    // ── Edit mode ───────────────────────────────────────────────────────────
    @State private var isEditing       = false
    @State private var isSaving        = false
    @State private var isLoadingItems  = true
    @State private var saveError: String?
    @State private var saveSuccess     = false

    // ── Re-read (re-run the AI extraction pipeline on the stored file) ────────
    @State private var isReprocessing  = false
    @State private var reprocessError: String?
    @State private var reprocessDone   = false

    @State private var showItems       = true

    /// How many documents this org has from the same vendor (vendors.doc_count),
    /// i.e. how many times they've bought from this store.
    @State private var repeatCount: Int?

    @State private var vendorName  = ""
    @State private var companyName = ""
    @State private var docDateText = ""
    @State private var docDateValue = Date()
    @State private var docNumber   = ""
    @State private var subtotalText = ""
    @State private var vatText      = ""
    @State private var whtText      = ""
    @State private var totalText    = ""
    @State private var notesText    = ""
    @State private var categoryText = ""

    @StateObject private var categoriesVM = DocumentCategoriesViewModel()

    @State private var lineItems: [EditableLineItem] = []
    /// Snapshot of the AI-produced item descriptions at load time, so a save can
    /// diff what the user removed/added and feed it back as row-role corrections.
    @State private var originalItemDescriptions: [String] = []

    struct EditableLineItem: Identifiable {
        let id: String
        var description: String
        var qty: String
        var unitPrice: String
        var amount: String
        var isNew: Bool
    }

    init(doc: SlippyDocument) {
        _doc = State(initialValue: doc)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                headerCard
                primaryButtonsRow

                infoCard
                if !lineItems.isEmpty || isEditing { itemsCard }
                bottomDetailSummaryRow
                receiptRemarkSection

                if !isEditing {
                    // Tagging and sharing used to be possible only on the
                    // pre-upload review screen, i.e. before anyone knew what
                    // the document was. They belong where the document is
                    // actually looked at.
                    DocumentTagsShareSection(documentId: doc.id)
                        .environmentObject(authVM)

                    footerActionBar
                    statusActionButtons
                }
            }
            .padding(20)
            .padding(.bottom, 40)
        }
        .background(Color.background)
        .navigationTitle("รายละเอียดเอกสาร")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadLineItems()
            if let orgId = authVM.org?.id { await categoriesVM.load(orgId: orgId) }
            await loadRepeatCount()
        }
        .sheet(isPresented: $showImageViewer) {
            ReceiptImageViewer(
                url: imageURL, isLoading: isLoadingImage, error: imageLoadError,
                initialRotation: doc.displayRotation ?? 0,
                onSaveRotation: { newRotation in await saveRotation(newRotation) }
                // returns Bool now — success/failure surfaced in the viewer's UI
            )
        }
        .alert("ยืนยันการดำเนินการ", isPresented: Binding(
            get: { confirmAction != nil },
            set: { if !$0 { confirmAction = nil } }
        )) {
            Button("ยืนยัน", role: .destructive) {
                if let action = confirmAction { Task { await performAction(action) } }
                confirmAction = nil
            }
            Button("ยกเลิก", role: .cancel) { confirmAction = nil }
        } message: {
            if let action = confirmAction {
                Text(action == "approved" ? "อนุมัติเอกสารนี้?" :
                     action == "rejected" ? "ปฏิเสธเอกสารนี้?" : "ส่งเอกสารเข้าระบบ?")
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        Task { await reprocessDocument() }
                    } label: {
                        Label("อ่านไฟล์ซ้ำด้วย AI", systemImage: "arrow.clockwise")
                    }
                    .disabled(isEditing || isReprocessing)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Color.brand500)
                }
            }
        }
        .overlay {
            if isReprocessing {
                ZStack {
                    Color.black.opacity(0.15).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().tint(Color.brand500)
                        Text("กำลังอ่านไฟล์ซ้ำด้วย AI…")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                        Text("ระบบกำลังพยายามเก็บรายละเอียดเพิ่มเติม")
                            .font(.system(size: 11))
                            .foregroundColor(Color.textSecondary)
                    }
                    .padding(24)
                    .background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .shadow(color: .black.opacity(0.12), radius: 20, y: 8)
                }
                .transition(.opacity)
            }
        }
        .alert("อ่านไฟล์ซ้ำสำเร็จ", isPresented: $reprocessDone) {
            Button("ตกลง", role: .cancel) {}
        } message: {
            Text("อัปเดตรายละเอียดจากการอ่านล่าสุดแล้ว")
        }
        .alert("อ่านซ้ำไม่สำเร็จ", isPresented: Binding(
            get: { reprocessError != nil },
            set: { if !$0 { reprocessError = nil } }
        )) {
            Button("ตกลง", role: .cancel) { reprocessError = nil }
        } message: {
            Text(reprocessError ?? "")
        }
    }

    // MARK: – Header card

    private var headerCard: some View {
        HStack(alignment: .top, spacing: 14) {
            // Document glyph tile
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LinearGradient(colors: [Color(hex: "#8b83f7"), Color(hex: "#6366f1")],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 68, height: 78)
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 30))
                    .foregroundColor(.white)
            }
            .shadow(color: Color.brand500.opacity(0.3), radius: 8, x: 0, y: 4)

            VStack(alignment: .leading, spacing: 6) {
                Text("เอกสาร")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color.brand500)
                Text(doc.vendorName ?? "—")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(Color.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                HStack(spacing: 6) {
                    StatusBadge(status: doc.status)
                    if let type = docTypeLabel {
                        Text(type)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(hex: "#6366f1"))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.brand500.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
                if let n = repeatCount, n >= 2 {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 10, weight: .bold))
                        Text("ซื้อร้านนี้มาแล้ว \(n) ครั้ง")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(Color(hex: "#059669"))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: "#059669").opacity(0.12))
                    .clipShape(Capsule())
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Text("ยอดรวมเงิน")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                Text(fmtTHB(doc.totalAmount ?? 0))
                    .font(.system(size: 24, weight: .black, design: .rounded))
                    .foregroundColor(Color.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !docDateText.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.system(size: 10))
                            .foregroundColor(Color.textSecondary)
                        Text(formatDocDate(docDateText))
                            .font(.system(size: 11))
                            .foregroundColor(Color.textSecondary)
                    }
                }
            }
        }
        .sectionCard()
    }

    /// Thai label for the AI-detected `doc_type` badge (e.g. "ใบเสร็จรับเงิน").
    private var docTypeLabel: String? {
        switch doc.docType?.lowercased() {
        case "receipt":                       return "ใบเสร็จรับเงิน"
        case "receipt_with_tax", "tax_receipt": return "ใบเสร็จ/ใบกำกับภาษี"
        case "tax_invoice":                   return "ใบกำกับภาษี"
        case "invoice":                       return "ใบแจ้งหนี้"
        case "quotation":                     return "ใบเสนอราคา"
        case "purchase_order", "po":          return "ใบสั่งซื้อ"
        case "credit_note":                   return "ใบลดหนี้"
        case .some(let t) where !t.isEmpty:   return t
        default:                              return nil
        }
    }

    // MARK: – View original receipt photo

    private var primaryButtonsRow: some View {
        VStack(spacing: 8) {
            if let err = saveError {
                Text(err).font(.system(size: 12)).foregroundColor(Color.statusFailed)
            }
            if saveSuccess {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(Color.statusApproved)
                    Text("บันทึกการแก้ไขสำเร็จ").font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Color.statusApproved)
                }
            }
            HStack(spacing: 12) {
                if isEditing {
                    Button {
                        hapticLight()
                        isEditing = false
                        Task { await loadLineItems() } // discard edits, reload original
                    } label: {
                        pillLabel("ยกเลิก", icon: "xmark", filled: false)
                    }
                    Button { Task { await saveEdits() } } label: {
                        HStack(spacing: 6) {
                            if isSaving { ProgressView().tint(.white) }
                            else {
                                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold))
                                Text("บันทึก").font(.system(size: 14, weight: .bold))
                            }
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.brand500)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(isSaving)
                } else {
                    Button {
                        hapticLight()
                        showImageViewer = true
                        Task { await loadSignedImageURL() }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "photo.fill").font(.system(size: 14, weight: .semibold))
                            Text("ดูรูปที่อัปโหลด").font(.system(size: 13.5, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundColor(Color.brand500)
                        .padding(.horizontal, 14).padding(.vertical, 13)
                        .frame(maxWidth: .infinity)
                        .background(Color.brand500.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    Button {
                        hapticLight()
                        saveSuccess = false
                        isEditing = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "square.and.pencil").font(.system(size: 14, weight: .semibold))
                            Text("แก้ไขข้อมูล").font(.system(size: 13.5, weight: .semibold))
                        }
                        .foregroundColor(Color.brand500)
                        .padding(.horizontal, 14).padding(.vertical, 13)
                        .frame(maxWidth: .infinity)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.brand500.opacity(0.4), lineWidth: 1.5))
                    }
                }
            }
        }
    }

    private func pillLabel(_ text: String, icon: String, filled: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 13, weight: .bold))
            Text(text).font(.system(size: 14, weight: .bold))
        }
        .foregroundColor(filled ? .white : Color.textSecondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 13)
        .background(filled ? Color.brand500 : Color.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func loadSignedImageURL() async {
        guard imageURL == nil else { return }
        isLoadingImage = true; imageLoadError = nil
        do {
            let signed = try await SupabaseManager.shared.client
                .storage.from(Config.storageBucket)
                .createSignedURL(path: doc.filePath, expiresIn: 3600)
            imageURL = signed
        } catch {
            imageLoadError = "โหลดรูปไม่สำเร็จ: \(error.localizedDescription)"
        }
        isLoadingImage = false
    }

    // MARK: – HEADER section (editable vendor/doc info)

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            cardHeader(icon: "list.bullet.rectangle.portrait.fill", title: "ข้อมูลเอกสาร")

            if isEditing {
                editField("ชื่อร้าน / สาขา", text: $vendorName)
                editField("ชื่อบริษัท (นิติบุคคล)", text: $companyName)
                editDateField("วันที่เอกสาร", date: $docDateValue) { newDate in
                    let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
                    docDateText = fmt.string(from: newDate)
                }
                editField("เลขที่เอกสาร", text: $docNumber)
                categoryPickerRow
            } else {
                // Shop and company are separate facts: the tax id belongs to the
                // company, while the branch is what the user actually visited —
                // and on chains they differ (KOFUKU Silom Complex vs
                // บริษัท สยาม อัลเตอร์ กรุ๊ป จำกัด), as do their addresses.
                infoRow("storefront.fill", "ชื่อร้าน / สาขา", vendorName.isEmpty ? "—" : vendorName, bold: true)
                if !companyName.isEmpty, companyName != vendorName {
                    infoDivider
                    infoRow("building.2.fill", "ชื่อบริษัท (นิติบุคคล)", companyName)
                }
                infoDivider
                infoRow("calendar", "วันที่เอกสาร", docDateText.isEmpty ? "—" : formatDocDate(docDateText))
                infoDivider
                infoRow("number", "เลขที่เอกสาร", docNumber.isEmpty ? "—" : docNumber, mono: true)
                infoDivider
                infoRow("tag.fill", "หมวดหมู่", categoryText.isEmpty ? "—" : categoryText)
                infoDivider
                infoRow("mappin.and.ellipse", "ช่องทาง", doc.source)
                infoDivider
                infoRow("clock.fill", "อัพโหลดเมื่อ", relTime(doc.createdAt))
                if let conf = doc.overallConfidence {
                    infoDivider
                    HStack(spacing: 10) {
                        rowIcon("checkmark.shield.fill")
                        Text("ความเชื่อมั่น AI").font(.system(size: 13)).foregroundColor(Color.textSecondary)
                        Spacer()
                        confidenceChip(conf)
                    }
                }
                if let verification = doc.machineVerificationStatus {
                    infoDivider
                    HStack(spacing: 10) {
                        rowIcon(verification == "verified" ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verification == "verified" ? "ระบบตรวจยอดแล้ว" :
                                 verification == "needs_review" ? "ควรตรวจสอบก่อนอนุมัติ" : "ยังยืนยันข้อมูลไม่ได้")
                                .font(.system(size: 13, weight: .semibold))
                            Text(doc.reconciliationStatus == "balanced" ? "ยอดที่ตรวจได้สมดุลกัน" :
                                 doc.reconciliationStatus == "mismatch" ? "พบยอดที่ไม่ตรงกัน" : "ยังตรวจสมดุลยอดไม่ได้")
                                .font(.system(size: 11))
                                .foregroundColor(Color.textSecondary)
                        }
                        Spacer()
                    }
                }
            }
        }
        .sectionCard()
    }

    private var infoDivider: some View { Divider().opacity(0.5).padding(.leading, 30) }

    private func rowIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(Color.brand500)
            .frame(width: 20)
    }

    private func infoRow(_ icon: String, _ label: String, _ value: String,
                         bold: Bool = false, mono: Bool = false) -> some View {
        HStack(spacing: 10) {
            rowIcon(icon)
            Text(label).font(.system(size: 13)).foregroundColor(Color.textSecondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 13, weight: bold ? .bold : .medium, design: mono ? .monospaced : .default))
                .foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
    }

    private func cardHeader<Trailing: View>(icon: String, title: String, color: Color = Color.brand500,
                                            @ViewBuilder trailing: () -> Trailing = { EmptyView() }) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundColor(color)
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(Color.textPrimary)
            Spacer()
            trailing()
        }
    }

    // MARK: – DETAIL section (editable line items)

    private var itemsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardHeader(icon: "cart.fill", title: "รายการสินค้า (\(lineItems.count) รายการ)") {
                if !isEditing && !lineItems.isEmpty {
                    Button {
                        hapticLight()
                        withAnimation(.easeInOut(duration: 0.2)) { showItems.toggle() }
                    } label: {
                        Image(systemName: showItems ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Color.brand500)
                    }
                }
            }

            if isLoadingItems {
                HStack { Spacer(); ProgressView().tint(Color.brand500); Spacer() }.padding(.vertical, 12)
            } else if isEditing {
                ForEach($lineItems) { $item in
                    lineItemRow($item)
                    if item.id != lineItems.last?.id { Divider().opacity(0.4) }
                }
                Button {
                    hapticLight()
                    lineItems.append(EditableLineItem(
                        id: "new-\(UUID().uuidString)", description: "", qty: "1",
                        unitPrice: "0", amount: "0", isNew: true))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill")
                        Text("เพิ่มรายการ")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.brand500)
                }
                .padding(.top, 6)
            } else if lineItems.isEmpty {
                Text("ไม่มีรายการสินค้าแยกย่อย")
                    .font(.system(size: 12)).foregroundColor(Color.textSecondary)
            } else if showItems {
                HStack {
                    Text("รายการ").frame(maxWidth: .infinity, alignment: .leading)
                    Text("จำนวน").frame(width: 40, alignment: .trailing)
                    Text("ราคา/หน่วย").frame(width: 66, alignment: .trailing)
                    Text("รวม").frame(width: 58, alignment: .trailing)
                }
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                Divider().opacity(0.5)
                ForEach(lineItems) { item in
                    itemViewRow(item)
                    if item.id != lineItems.last?.id { Divider().opacity(0.3) }
                }
            }

            if !isEditing && !lineItems.isEmpty {
                Button {
                    hapticLight()
                    withAnimation(.easeInOut(duration: 0.2)) { showItems.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text(showItems ? "ดูน้อยลง" : "ดูทั้งหมด")
                        Image(systemName: showItems ? "chevron.up" : "chevron.down")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.brand500)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
                }
            }
        }
        .sectionCard()
    }

    private func itemViewRow(_ item: EditableLineItem) -> some View {
        // .top so the qty/price columns stay on the first line when a long
        // product name wraps onto two or three.
        HStack(alignment: .top, spacing: 8) {
            Text(itemEmoji(item.description)).font(.system(size: 17))
            // Thai menu lines run long ("Premium: เซตข้าวหน้าเนื้อวากิวย่างไฟ
            // ซอสชิมิชูรี Medium-สุกปานกลาง") and a single clipped line hid the
            // part that tells the items apart. Let them wrap instead.
            Text(item.description.isEmpty ? "—" : item.description)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundColor(Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(item.qty)
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                .frame(width: 40, alignment: .trailing)
            Text(fmtTHB(Double(item.unitPrice) ?? 0))
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                .frame(width: 66, alignment: .trailing)
            Text(fmtTHB(Double(item.amount) ?? 0))
                .font(.system(size: 12.5, weight: .bold)).foregroundColor(Color.textPrimary)
                .frame(width: 58, alignment: .trailing)
        }
        .padding(.vertical, 3)
    }

    /// Best-effort emoji thumbnail from the line-item name (food-receipt heavy,
    /// with a neutral receipt default).
    private func itemEmoji(_ desc: String) -> String {
        let d = desc.lowercased()
        func has(_ ks: [String]) -> Bool { ks.contains { d.contains($0) } }
        if has(["coffee", "กาแฟ", "ชา", "tea", "latte", "espresso", "cappu", "มอคค่า"]) { return "☕️" }
        if has(["water", "น้ำดื่ม", "น้ำเปล่า", "น้ำแร่"]) { return "💧" }
        if has(["sandwich", "แซนด์", "ขนมปัง", "bread", "burger", "เบอร์เกอร์", "toast"]) { return "🥪" }
        if has(["rice", "ข้าว"]) { return "🍚" }
        if has(["noodle", "ก๋วยเตี๋ยว", "บะหมี่", "หมี่", "ราเมน", "ramen"]) { return "🍜" }
        if has(["chip", "มันฝรั่ง", "ขนม", "snack", "คุกกี้", "cookie", "เลย์"]) { return "🍟" }
        if has(["fruit", "ผลไม้", "apple", "แอปเปิ", "กล้วย", "banana", "ส้ม"]) { return "🍎" }
        if has(["beer", "เบียร์", "wine", "ไวน์", "เหล้า", "alcohol"]) { return "🍺" }
        if has(["milk", "นม", "yogurt", "โยเกิร์ต"]) { return "🥛" }
        if has(["cake", "เค้ก", "dessert", "ของหวาน", "ไอศ", "ice cream"]) { return "🍰" }
        if has(["chicken", "ไก่", "pork", "หมู", "beef", "เนื้อ", "meat", "steak"]) { return "🍗" }
        return "🧾"
    }

    @ViewBuilder
    private func lineItemRow(_ item: Binding<EditableLineItem>) -> some View {
        if isEditing {
            VStack(spacing: 6) {
                HStack {
                    TextField("ชื่อรายการ", text: item.description)
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "#1e1b4b"))
                        .padding(8)
                        .background(Color.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    Button {
                        hapticLight()
                        lineItems.removeAll { $0.id == item.wrappedValue.id }
                        recalcFromLineItems()
                    } label: {
                        Image(systemName: "minus.circle.fill")
                            .foregroundColor(Color.statusFailed)
                    }
                }
                HStack(spacing: 8) {
                    labeledNumberField("จำนวน", text: item.qty, isInteger: true) { recomputeAmount(item) }
                    labeledNumberField("ราคา/หน่วย", text: item.unitPrice) { recomputeAmount(item) }
                    labeledNumberField("รวม", text: item.amount) { recalcFromLineItems() }
                }
            }
            .padding(.vertical, 4)
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.wrappedValue.description)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color.textPrimary)
                    Text("จำนวน \(item.wrappedValue.qty) × \(fmtTHB(Double(item.wrappedValue.unitPrice) ?? 0))")
                        .font(.system(size: 10))
                        .foregroundColor(Color.textSecondary)
                }
                Spacer()
                Text(fmtTHB(Double(item.wrappedValue.amount) ?? 0))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
            }
            .padding(.vertical, 4)
        }
    }

    private func labeledNumberField(_ label: String, text: Binding<String>, isInteger: Bool = false,
                                     onChange: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 9)).foregroundColor(Color.textSecondary)
            TextField("0", text: text)
                .keyboardType(isInteger ? .numberPad : .decimalPad)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .onChange(of: text.wrappedValue) { _, newValue in
                    if isInteger {
                        let digitsOnly = newValue.filter(\.isNumber)
                        if digitsOnly != newValue { text.wrappedValue = digitsOnly }
                    }
                    onChange()
                }
        }
        .padding(8)
        .background(Color.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func recomputeAmount(_ item: Binding<EditableLineItem>) {
        let qty = Double(item.wrappedValue.qty) ?? 0
        let price = Double(item.wrappedValue.unitPrice) ?? 0
        item.wrappedValue.amount = String(format: "%.2f", qty * price)
        recalcFromLineItems()
    }

    // MARK: – SUMMARY section (editable amounts, auto-recalculated)

    // Bottom row: when there are no line items, pair the empty-state card next
    // to the money summary (two columns, like the reference). Otherwise the
    // items already showed above — give the summary the full width.
    // Two-column bottom row, matching the reference: the "รายละเอียดสินค้า/บริการ"
    // breakdown card sits beside the money summary in view mode (full-width
    // summary while editing amounts).
    @ViewBuilder
    private var bottomDetailSummaryRow: some View {
        if isEditing {
            summaryCard
        } else {
            HStack(alignment: .top, spacing: 12) {
                detailBreakdownCard
                summaryCard
            }
        }
    }

    private var detailBreakdownCard: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet.rectangle.fill")
                    .font(.system(size: 12, weight: .bold)).foregroundColor(Color.brand500)
                Text("รายละเอียดสินค้า/บริการ")
                    .font(.system(size: 12.5, weight: .bold)).foregroundColor(Color.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 2)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundColor(Color.brand500)
            }
            Spacer(minLength: 4)
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 34)).foregroundColor(Color.brand500.opacity(0.35))
            Text("ไม่มีรายการสินค้าแยกย่อย")
                .font(.system(size: 12, weight: .semibold)).foregroundColor(Color.brand500)
            Text("เอกสารนี้ไม่มีรายการสินค้าหรือบริการแยกย่อย")
                .font(.system(size: 10)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
            Spacer(minLength: 4)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(14)
        .background(Color.brand500.opacity(0.05))
        .cornerRadius(16)
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardHeader(icon: "dollarsign.circle.fill", title: "สรุปยอดเงิน", color: Color(hex: "#059669"))

            if isEditing {
                editAmountField("ราคาก่อนภาษี (Subtotal)", text: $subtotalText, disabled: !lineItems.isEmpty) {
                    recalcFromSubtotal()
                }
                editAmountField("ภาษีมูลค่าเพิ่ม (VAT)", text: $vatText) { recalcTotal() }
                editAmountField("หัก ณ ที่จ่าย (WHT)", text: $whtText) { recalcTotal() }
                if !lineItems.isEmpty {
                    Text("* ยอดก่อนภาษีคำนวณจากรายการสินค้าอัตโนมัติ")
                        .font(.system(size: 10)).foregroundColor(Color(hex: "#9ca3af"))
                }
            } else {
                summaryRow("ราคาก่อนภาษี (Subtotal)", value: fmtTHB(Double(subtotalText) ?? 0))
                summaryRow("ภาษีมูลค่าเพิ่ม (VAT)", value: fmtTHB(Double(vatText) ?? 0))
                if let wht = Double(whtText), wht > 0 {
                    summaryRow("หัก ณ ที่จ่าย (WHT)", value: "- \(fmtTHB(wht))", valueColor: Color(hex: "#ef4444"))
                }
            }

            Divider()

            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("ยอดรวมทั้งหมด")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(Color.textPrimary)
                    Text("Grand Total").font(.system(size: 9)).foregroundColor(Color.textSecondary)
                }
                Spacer()
                Text(fmtTHB(Double(totalText) ?? 0))
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#059669"))
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(hex: "#059669").opacity(0.06))
        .cornerRadius(16)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#059669").opacity(0.2)))
    }

    // MARK: – Footer action bar + status actions

    private var footerActionBar: some View {
        HStack(spacing: 0) {
            footerAction("ดาวน์โหลด", "square.and.arrow.down") {
                hapticLight(); showImageViewer = true; Task { await loadSignedImageURL() }
            }
            footerDivider
            ShareLink(item: shareSummaryText) { footerActionLabel("แชร์", "square.and.arrow.up") }
            footerDivider
            footerAction("เพิ่มแท็ก", "tag") {
                hapticLight(); saveSuccess = false; isEditing = true
            }
            footerDivider
            ShareLink(item: reportText) { footerActionLabel("รายงานปัญหา", "flag") }
        }
        .sectionCard()
    }

    private var footerDivider: some View {
        Rectangle().fill(Color.border).frame(width: 1, height: 28)
    }

    private func footerAction(_ label: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { footerActionLabel(label, icon) }
    }

    private func footerActionLabel(_ label: String, _ icon: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold))
            Text(label).font(.system(size: 10.5, weight: .medium))
        }
        .foregroundColor(Color.brand500)
        .frame(maxWidth: .infinity)
    }

    private var shareSummaryText: String {
        var lines = ["\(doc.vendorName ?? "เอกสาร") — \(fmtTHB(doc.totalAmount ?? 0))"]
        if !docDateText.isEmpty { lines.append("วันที่ \(formatDocDate(docDateText))") }
        lines.append("ผ่าน Slippy")
        return lines.joined(separator: "\n")
    }

    private var reportText: String {
        "รายงานปัญหาเอกสาร\nร้าน: \(doc.vendorName ?? "-")\nยอดรวม: \(fmtTHB(doc.totalAmount ?? 0))\nรหัสเอกสาร: \(doc.id)"
    }

    @ViewBuilder
    private var statusActionButtons: some View {
        if doc.status == "reviewing" {
            HStack(spacing: 12) {
                actionButton("อนุมัติ", "checkmark.circle.fill", Color.statusApproved, "approved")
                actionButton("ปฏิเสธ", "xmark.circle.fill", Color.statusFailed, "rejected")
            }
        } else if doc.status == "approved" {
            actionButton("ส่งเข้าระบบ", "paperplane.fill", Color.statusPushed, "pushed")
        }
    }

    // MARK: – REMARK section (editable notes)

    private var receiptRemarkSection: some View {
        receiptSection(label: "REMARK · หมายเหตุ", icon: "info.circle.fill",
                       color: Color(hex: "#f59e0b")) {
            if isEditing {
                TextEditor(text: $notesText)
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 80)
                    .padding(8)
                    .background(Color.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
            } else if notesText.isEmpty {
                Text("ไม่มีหมายเหตุ")
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
            } else {
                Text(notesText)
                    .font(.system(size: 13))
                    .foregroundColor(Color.textPrimary)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    // MARK: – Receipt layout helpers (mirror CameraPickerView's receipt style)

    private func receiptSection<Content: View>(label: String, icon: String, color: Color,
                                               @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(color)
                Text(label).font(.system(size: 10, weight: .bold)).foregroundColor(color).tracking(0.5)
            }
            VStack(alignment: .leading, spacing: 8) { content() }
        }
        .padding(14)
    }

    private func editField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10)).foregroundColor(Color(hex: "#6b7280"))
            TextField(label, text: text)
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .padding(8)
                .background(Color.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    /// Menu-based picker over the org's `document_categories` list, with a
    /// free-text fallback (typing a name not in the list still works) since
    /// `documents.expense_category` is plain text, not a FK. (Deliberately
    /// not `doc_category` — that column is the AI pipeline's own accounting
    /// classification and gets overwritten on reprocessing.)
    private var categoryPickerRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("หมวดหมู่").font(.system(size: 10)).foregroundColor(Color(hex: "#6b7280"))
            HStack(spacing: 8) {
                TextField("หมวดหมู่", text: $categoryText)
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                    .padding(8)
                    .background(Color.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Menu {
                    // Canonical Slippy categories — always offered, and each maps
                    // 1:1 to the recent-list icon so the picked category and its
                    // icon stay in sync.
                    ForEach(SlippyCategory.all) { cat in
                        Button {
                            hapticLight()
                            categoryText = cat.label
                        } label: {
                            Label(cat.label, systemImage: cat.symbol)
                        }
                    }

                    // Any org-defined custom categories not already covered above.
                    let customs = categoriesVM.categories.filter { c in
                        !SlippyCategory.all.contains { $0.label == c.name }
                    }
                    if !customs.isEmpty {
                        Divider()
                        Section("หมวดหมู่ขององค์กร") {
                            ForEach(customs) { cat in
                                Button(cat.name) {
                                    hapticLight()
                                    categoryText = cat.name
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(Color.brand500)
                }
            }
        }
    }

    private func editDateField(_ label: String, date: Binding<Date>,
                                onChange: @escaping (Date) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10)).foregroundColor(Color(hex: "#6b7280"))
            DatePicker("", selection: date, displayedComponents: .date)
                .datePickerStyle(.compact)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "th_TH"))
                .tint(Color.brand500)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .onChange(of: date.wrappedValue) { _, newValue in onChange(newValue) }
        }
    }

    private func editAmountField(_ label: String, text: Binding<String>, disabled: Bool = false,
                                  onChange: @escaping () -> Void) -> some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundColor(Color(hex: "#6b7280"))
            Spacer()
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color(hex: "#1e1b4b"))
                .frame(width: 110)
                .padding(8)
                .background(disabled ? Color(hex: "#f3f4f6") : Color(hex: "#f9fafb"))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .disabled(disabled)
                .onChange(of: text.wrappedValue) { _, _ in onChange() }
        }
    }

    private func summaryRow(_ label: String, value: String, valueColor: Color = Color.textPrimary) -> some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundColor(Color(hex: "#6b7280"))
            Spacer()
            Text(value).font(.system(size: 13, weight: .semibold)).foregroundColor(valueColor)
        }
    }

    @ViewBuilder
    private func confidenceChip(_ conf: Double) -> some View {
        let pct = Int(conf * 100)
        let color: Color = conf >= 0.85 ? .statusApproved : conf >= 0.60 ? .statusReviewing : .statusFailed
        Text("\(pct)%")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func formatDocDate(_ iso: String) -> String {
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        guard let d = fmt.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.dateFormat = "d MMMM yyyy"
        out.locale = Locale(identifier: "th_TH")
        out.calendar = Calendar(identifier: .buddhist)
        return out.string(from: d)
    }

    @ViewBuilder
    private func actionButton(_ label: String, _ icon: String, _ color: Color, _ action: String) -> some View {
        Button {
            hapticMedium()
            confirmAction = action
        } label: {
            HStack {
                if isActing { ProgressView().tint(.white).scaleEffect(0.8) }
                else {
                    Image(systemName: icon)
                    Text(label).font(.system(size: 15, weight: .bold))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundColor(.white)
            .background(isActing ? color.opacity(0.6) : color)
            .cornerRadius(14)
        }
        .disabled(isActing)
    }

    // MARK: – Recalculation logic

    private func recalcFromLineItems() {
        guard !lineItems.isEmpty else { return }
        let sub = lineItems.reduce(0.0) { $0 + (Double($1.amount) ?? 0) }
        subtotalText = String(format: "%.2f", sub)
        recalcFromSubtotal()
    }

    private func recalcFromSubtotal() {
        let sub = Double(subtotalText) ?? 0
        let vat = sub * 0.07
        vatText = String(format: "%.2f", vat)
        recalcTotal()
    }

    private func recalcTotal() {
        let sub = Double(subtotalText) ?? 0
        let vat = Double(vatText) ?? 0
        let wht = Double(whtText) ?? 0
        totalText = String(format: "%.2f", max(0, sub + vat - wht))
    }

    // MARK: – Data loading

    private func loadLineItems() async {
        isLoadingItems = true
        vendorName  = doc.vendorName ?? ""
        companyName = doc.companyName ?? ""
        docDateText = doc.docDate ?? ""
        let dateFmt = DateFormatter(); dateFmt.dateFormat = "yyyy-MM-dd"
        docDateValue = dateFmt.date(from: docDateText) ?? Date()
        docNumber   = doc.invoiceNumber ?? ""
        subtotalText = doc.subtotalAmount.map { String(format: "%.2f", $0) } ?? "0"
        vatText      = doc.vatAmount.map { String(format: "%.2f", $0) } ?? "0"
        whtText      = doc.whtAmount.map { String(format: "%.2f", $0) } ?? "0"
        totalText    = doc.totalAmount.map { String(format: "%.2f", $0) } ?? "0"
        notesText    = doc.notes ?? ""
        categoryText = doc.expenseCategory ?? ""

        struct Row: Decodable {
            let id: String
            let description: String?
            let quantity: Double?
            let unit_price: Double?
            let amount: Double?
        }
        do {
            let rows: [Row] = try await SupabaseManager.shared.client
                .from("document_line_items")
                .select()
                .eq("document_id", value: doc.id)
                .order("sort_order", ascending: true)
                .execute()
                .value
            lineItems = rows.map {
                EditableLineItem(
                    id: $0.id,
                    description: $0.description ?? "",
                    qty: $0.quantity.map { String(Int($0.rounded())) } ?? "1",
                    unitPrice: $0.unit_price.map { String(format: "%.2f", $0) } ?? "0",
                    amount: $0.amount.map { String(format: "%.2f", $0) } ?? "0",
                    isNew: false
                )
            }
        } catch {
            lineItems = []
        }
        originalItemDescriptions = lineItems.map(\.description)
        isLoadingItems = false
    }

    // MARK: – Re-read (re-run AI extraction on the already-stored file)

    /// Re-triggers the same server pipeline the upload flow uses
    /// (`POST /api/documents/{id}/process`, see CameraPickerView.triggerServerOCR),
    /// but with no hint/confirmation — telling it to read the stored image again
    /// from scratch to try to recover fields/line-items an earlier pass missed.
    /// On success we reload the fresh document + line items in place.
    private func reprocessDocument() async {
        guard !isReprocessing, !isEditing else { return }
        isReprocessing = true
        reprocessError = nil
        reprocessDone = false
        hapticLight()
        defer { isReprocessing = false }

        guard let url = URL(string: "\(Config.webAppURL)/api/documents/\(doc.id)/process") else {
            reprocessError = "ไม่พบปลายทางประมวลผล"
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = authVM.session?.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.timeoutInterval = 90
        // Empty body: no local OCR hint, not user-confirmed → the pipeline
        // re-reads the stored file and re-extracts everything itself.
        req.httpBody = "{}".data(using: .utf8)

        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                reprocessError = "อ่านซ้ำไม่สำเร็จ (\(http.statusCode)) — ลองอีกครั้ง"
                hapticMedium()
                return
            }
            await reloadDocument()
            await loadLineItems()
            reprocessDone = true
            hapticSuccess()
        } catch {
            reprocessError = "อ่านซ้ำไม่สำเร็จ: \(error.localizedDescription)"
            hapticMedium()
        }
    }

    /// Pulls the fresh `documents` row after a re-read so header/fields reflect
    /// the pipeline's new extraction.
    private func reloadDocument() async {
        do {
            let rows: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents")
                .select()
                .eq("id", value: doc.id)
                .limit(1)
                .execute()
                .value
            if let fresh = rows.first { doc = fresh }
        } catch {
            // Non-fatal — the POST already succeeded; keep showing current data.
        }
    }

    /// Reads the deduplicated vendor's document count (see migration
    /// 079_vendor_match_key.sql). Matched by name — the vendor row keeps the
    /// freshest display name, which is usually this document's vendor.
    private func loadRepeatCount() async {
        guard let orgId = authVM.org?.id else { return }
        struct Row: Decodable { let doc_count: Int }

        // Match by tax id first (the vendor's canonical identity); fall back to
        // the display name. Mirrors merchant-key.ts's priority.
        let taxDigits = (doc.vendorTaxId ?? "").filter(\.isNumber)
        let name = doc.vendorName?.trimmingCharacters(in: .whitespaces) ?? ""

        do {
            var query = SupabaseManager.shared.client
                .from("vendors")
                .select("doc_count")
                .eq("organization_id", value: orgId)
            if taxDigits.count == 13 {
                query = query.eq("tax_id", value: doc.vendorTaxId ?? "")
            } else if !name.isEmpty {
                query = query.eq("name", value: name)
            } else {
                return
            }
            let rows: [Row] = try await query
                .order("doc_count", ascending: false)
                .limit(1)
                .execute()
                .value
            repeatCount = rows.first?.doc_count
        } catch {
            // Non-fatal — the chip just won't show.
        }
    }

    private func saveEdits() async {
        isSaving = true; saveError = nil

        // Capture corrections against the PRE-save (AI) values now, before `doc`
        // is replaced with the fresh server row below.
        let validItems = lineItems.filter { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
        let corrections = buildCorrections(newItems: validItems)

        do {
            let update: [String: AnyEncodable] = [
                "vendor_name":  AnyEncodable(vendorName.isEmpty ? nil : vendorName),
                "company_name": AnyEncodable(companyName.isEmpty ? nil : companyName),
                "doc_date":     AnyEncodable(docDateText.isEmpty ? nil : docDateText),
                "doc_number":   AnyEncodable(docNumber.isEmpty ? nil : docNumber),
                "subtotal":     AnyEncodable(Double(subtotalText)),
                "vat_amount":   AnyEncodable(Double(vatText)),
                "wht_amount":   AnyEncodable(Double(whtText)),
                "total_amount": AnyEncodable(Double(totalText)),
                "notes":        AnyEncodable(notesText.isEmpty ? nil : notesText),
                "expense_category": AnyEncodable(categoryText.isEmpty ? nil : categoryText),
            ]
            // `.select()` lets us detect RLS silently filtering the row (insufficient
            // role / wrong org) instead of mistaking a 0-row update for success.
            let updated: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents")
                .update(update)
                .eq("id", value: doc.id)
                .select()
                .execute()
                .value
            guard let freshDoc = updated.first else {
                saveError = "บันทึกไม่สำเร็จ — คุณอาจไม่มีสิทธิ์แก้ไขเอกสารนี้"
                isSaving = false
                hapticLight()
                return
            }
            // The server's row is the new source of truth — `doc` was `let`
            // before, so headerCard above kept showing pre-edit values even
            // after a successful save.
            doc = freshDoc

            // Sync line items: delete-then-insert keeps it simple and consistent
            try await SupabaseManager.shared.client
                .from("document_line_items")
                .delete()
                .eq("document_id", value: doc.id)
                .execute()

            if !validItems.isEmpty {
                let records: [[String: AnyEncodable]] = validItems.enumerated().map { idx, item in
                    [
                        "document_id":  AnyEncodable(doc.id),
                        "description":  AnyEncodable(item.description),
                        "quantity":     AnyEncodable(Double(item.qty)),
                        "unit_price":   AnyEncodable(Double(item.unitPrice)),
                        "amount":       AnyEncodable(Double(item.amount) ?? 0),
                        "sort_order":   AnyEncodable(idx),
                    ]
                }
                try await SupabaseManager.shared.client
                    .from("document_line_items")
                    .insert(records)
                    .execute()
            }

            // Feed the user's edits back into the learning loop (best-effort).
            await submitCorrections(corrections)

            hapticSuccess()
            saveSuccess = true
            isEditing = false
            await loadLineItems()
        } catch {
            saveError = "บันทึกไม่สำเร็จ: \(error.localizedDescription)"
            hapticLight()
        }
        isSaving = false
    }

    // MARK: – Correction capture (feedback loop → receipt_corrections)

    /// Builds correction rows by diffing the AI values (`doc` + the item snapshot)
    /// against what the user is saving. Field edits feed few-shot/vendor learning;
    /// line-item removals/additions feed the row-role classifier
    /// (see api/src/pipeline/receipt-feedback.ts).
    private func buildCorrections(newItems: [EditableLineItem]) -> [[String: AnyEncodable]] {
        var rows: [[String: AnyEncodable]] = []

        func field(_ name: String, ai: String?, now: String?) {
            let a = (ai ?? "").trimmingCharacters(in: .whitespaces)
            let n = (now ?? "").trimmingCharacters(in: .whitespaces)
            guard a != n else { return }
            rows.append(correctionRow(field: name, ai: a.isEmpty ? nil : a, corrected: n.isEmpty ? nil : n))
        }
        func money(_ v: Double?) -> String? { v.map { String(format: "%.2f", $0) } }

        field("vendor_name",      ai: doc.vendorName,      now: vendorName)
        field("company_name",     ai: doc.companyName,     now: companyName)
        field("doc_number",       ai: doc.invoiceNumber,   now: docNumber)
        field("doc_date",         ai: doc.docDate,         now: docDateText)
        field("subtotal",         ai: money(doc.subtotalAmount), now: subtotalText)
        field("vat_amount",       ai: money(doc.vatAmount),      now: vatText)
        field("total_amount",     ai: money(doc.totalAmount),    now: totalText)
        field("expense_category", ai: doc.expenseCategory, now: categoryText)

        // Row-role feedback: which items the AI produced that the user removed
        // (→ non_item) or added itself (→ item).
        let newKeys = Set(newItems.map { normLabel($0.description) })
        let oldKeys = Set(originalItemDescriptions.map { normLabel($0) })
        for old in originalItemDescriptions where !old.trimmingCharacters(in: .whitespaces).isEmpty
            && !newKeys.contains(normLabel(old)) {
            rows.append(correctionRow(field: "line_item_role", ai: old, corrected: "non_item"))
        }
        for item in newItems where !oldKeys.contains(normLabel(item.description)) {
            rows.append(correctionRow(field: "line_item_role", ai: item.description, corrected: "item"))
        }
        return rows
    }

    /// Mirrors `normalizeLabel` in receipt-rows.ts so client-side de-dup agrees
    /// with server-side aggregation.
    private func normLabel(_ s: String) -> String {
        s.lowercased().filter { !$0.isWhitespace && !".,()-฿*".contains($0) }
    }

    private func correctionRow(field: String, ai: String?, corrected: String?) -> [String: AnyEncodable] {
        [
            "organization_id":  AnyEncodable(authVM.org?.id),
            "document_id":      AnyEncodable(doc.id),
            "field_name":       AnyEncodable(field),
            "ai_value":         AnyEncodable(ai),
            "corrected_value":  AnyEncodable(corrected),
            "vendor_name":      AnyEncodable(vendorName.isEmpty ? doc.vendorName : vendorName),
            "company_name":     AnyEncodable(companyName.isEmpty ? doc.companyName : companyName),
            "doc_category":     AnyEncodable(doc.category),
            "confidence_score": AnyEncodable(doc.overallConfidence),
            "corrected_by":     AnyEncodable(authVM.session?.user.id.uuidString),
        ]
    }

    private func submitCorrections(_ rows: [[String: AnyEncodable]]) async {
        guard !rows.isEmpty, authVM.org?.id != nil else { return }
        do {
            try await SupabaseManager.shared.client
                .from("receipt_corrections")
                .insert(rows)
                .execute()
        } catch {
            // Learning is best-effort — never surface to the user.
            print("[corrections] insert failed:", error)
        }
    }

    private func saveRotation(_ rotation: Int) async -> Bool {
        do {
            // `documents` RLS only filters rows on UPDATE (no error on mismatch) —
            // request the row back via `.select()` so an RLS-blocked write (wrong
            // org, insufficient role) shows up as an empty array instead of a
            // false "success" with zero rows actually changed.
            let updated: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents")
                .update(["display_rotation": rotation])
                .eq("id", value: doc.id)
                .select()
                .execute()
                .value
            return !updated.isEmpty
        } catch {
            print("[DocumentDetail] saveRotation error:", error)
            return false
        }
    }

    @MainActor
    private func performAction(_ action: String) async {
        isActing = true
        do {
            let updated: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents")
                .update(["status": action])
                .eq("id", value: doc.id)
                .select()
                .execute()
                .value
            guard !updated.isEmpty else {
                saveError = "ดำเนินการไม่สำเร็จ — คุณอาจไม่มีสิทธิ์แก้ไขเอกสารนี้"
                hapticLight()
                isActing = false
                return
            }
            hapticSuccess()
            if action == "rejected" {
                await notifyDocumentSource(documentId: doc.id, action: "rejected", authVM: authVM)
            }
            dismiss()
        } catch {
            hapticLight()
        }
        isActing = false
    }
}

// MARK: – Receipt image viewer (zoomable, full screen)

struct ReceiptImageViewer: View {
    let url: URL?
    let isLoading: Bool
    let error: String?
    let initialRotation: Int
    let onSaveRotation: (Int) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var rotation: Int
    @State private var savedRotation: Int
    @State private var isSavingRotation = false
    @State private var rotationSaveError: String?

    init(url: URL?, isLoading: Bool, error: String?, initialRotation: Int,
         onSaveRotation: @escaping (Int) async -> Bool) {
        self.url = url; self.isLoading = isLoading; self.error = error
        self.initialRotation = initialRotation
        self.onSaveRotation = onSaveRotation
        _rotation      = State(initialValue: initialRotation)
        _savedRotation = State(initialValue: initialRotation)
    }

    private var rotationChanged: Bool { rotation != savedRotation }

    private func resetZoom() {
        withAnimation(.easeInOut(duration: 0.2)) {
            scale = 1; lastScale = 1
            offset = .zero; lastOffset = .zero
        }
    }

    /// Keeps pan offset within the bounds of the zoomed image so it can't be dragged off-screen.
    private func clampedOffset(_ proposed: CGSize, scale: CGFloat, in size: CGSize) -> CGSize {
        let maxX = max(0, (size.width * (scale - 1)) / 2)
        let maxY = max(0, (size.height * (scale - 1)) / 2)
        return CGSize(
            width: min(max(proposed.width, -maxX), maxX),
            height: min(max(proposed.height, -maxY), maxY)
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if isLoading {
                    ProgressView().tint(.white)
                } else if let error {
                    VStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 32)).foregroundColor(.white.opacity(0.7))
                        Text(error).font(.system(size: 13)).foregroundColor(.white.opacity(0.7))
                            .multilineTextAlignment(.center).padding(.horizontal, 30)
                    }
                } else if let url {
                    GeometryReader { geo in
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image.resizable().scaledToFit()
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .rotationEffect(.degrees(Double(rotation)))
                                    .scaleEffect(scale)
                                    .offset(offset)
                                    .animation(.easeInOut(duration: 0.25), value: rotation)
                                    .gesture(
                                        SimultaneousGesture(
                                            MagnificationGesture()
                                                .onChanged { value in
                                                    let newScale = lastScale * value
                                                    scale = max(1, min(5, newScale))
                                                }
                                                .onEnded { _ in
                                                    lastScale = scale
                                                    if scale <= 1 {
                                                        withAnimation(.easeOut(duration: 0.2)) {
                                                            scale = 1; lastScale = 1
                                                            offset = .zero; lastOffset = .zero
                                                        }
                                                    } else {
                                                        offset = clampedOffset(offset, scale: scale, in: geo.size)
                                                        lastOffset = offset
                                                    }
                                                },
                                            DragGesture()
                                                .onChanged { value in
                                                    guard scale > 1 else { return }
                                                    let proposed = CGSize(
                                                        width: lastOffset.width + value.translation.width,
                                                        height: lastOffset.height + value.translation.height
                                                    )
                                                    offset = clampedOffset(proposed, scale: scale, in: geo.size)
                                                }
                                                .onEnded { _ in lastOffset = offset }
                                        )
                                    )
                                    .onTapGesture(count: 2) {
                                        withAnimation(.easeInOut(duration: 0.25)) {
                                            if scale > 1 {
                                                scale = 1; lastScale = 1
                                                offset = .zero; lastOffset = .zero
                                            } else {
                                                scale = 2.5; lastScale = 2.5
                                            }
                                        }
                                    }
                            } else if phase.error != nil {
                                Image(systemName: "photo.badge.exclamationmark")
                                    .font(.system(size: 40)).foregroundColor(.white.opacity(0.5))
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            } else {
                                ProgressView().tint(.white)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                    }

                    VStack {
                        Spacer()
                        if let rotationSaveError {
                            Text(rotationSaveError)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Color.statusFailed.opacity(0.85))
                                .clipShape(Capsule())
                                .padding(.bottom, 10)
                        }
                        HStack(spacing: 14) {
                            Button {
                                hapticLight()
                                rotation = ((rotation - 90) % 360 + 360) % 360
                                resetZoom()
                            } label: {
                                Image(systemName: "rotate.left")
                                    .font(.system(size: 18)).foregroundColor(.white)
                                    .frame(width: 48, height: 48)
                                    .background(.white.opacity(0.15)).clipShape(Circle())
                            }
                            Button {
                                hapticLight()
                                rotation = (rotation + 90) % 360
                                resetZoom()
                            } label: {
                                Image(systemName: "rotate.right")
                                    .font(.system(size: 18)).foregroundColor(.white)
                                    .frame(width: 48, height: 48)
                                    .background(.white.opacity(0.15)).clipShape(Circle())
                            }
                            if rotationChanged {
                                Button {
                                    hapticLight()
                                    let target = ((rotation % 360) + 360) % 360
                                    Task {
                                        isSavingRotation = true
                                        rotationSaveError = nil
                                        let ok = await onSaveRotation(target)
                                        if ok {
                                            savedRotation = target
                                            hapticSuccess()
                                        } else {
                                            rotationSaveError = "บันทึกไม่สำเร็จ ลองอีกครั้ง"
                                        }
                                        isSavingRotation = false
                                    }
                                } label: {
                                    HStack(spacing: 6) {
                                        if isSavingRotation { ProgressView().tint(.white) }
                                        else { Image(systemName: "checkmark") }
                                        Text("บันทึกการหมุน")
                                            .font(.system(size: 13, weight: .bold))
                                    }
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                                    .background(Color.brand500)
                                    .clipShape(Capsule())
                                }
                                .disabled(isSavingRotation)
                            } else if savedRotation != initialRotation {
                                HStack(spacing: 6) {
                                    Image(systemName: "checkmark.circle.fill")
                                    Text("บันทึกแล้ว")
                                        .font(.system(size: 13, weight: .bold))
                                }
                                .foregroundColor(Color.statusApproved)
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(Color.statusApproved.opacity(0.15))
                                .clipShape(Capsule())
                            }
                        }
                        .padding(.bottom, 30)
                    }
                }
            }
            .navigationTitle("รูปบิลต้นฉบับ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }.foregroundColor(.white)
                }
            }
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

#if DEBUG
#Preview {
    let doc = SlippyDocument(
        id: "doc-001",
        organizationId: "demo-org",
        vendorName: "บริษัท ซัพพลายเออร์ จำกัด",
        vendorTaxId: nil,
        invoiceNumber: "INV-2026-0042",
        docDate: "2026-05-15",
        totalAmount: 53500.00,
        vatAmount: 3500.00,
        whtAmount: 535.00,
        subtotalAmount: 50000.00,
        status: "reviewing",
        source: "mobile",
        docType: "invoice",
        overallConfidence: 0.91,
        category: "วัตถุดิบ",
        filePath: "demo-org/invoice_042.jpg",
        createdAt: "2026-05-16T08:30:00Z",
        notes: "ส่งของล่าช้า 2 วัน — ต่อรองส่วนลดเพิ่ม 2%",
        displayRotation: 0
    )
    let authVM = AuthViewModel(_preview: true)
    authVM.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return NavigationStack {
        DocumentDetailView(doc: doc).environmentObject(authVM)
    }
}
#endif
