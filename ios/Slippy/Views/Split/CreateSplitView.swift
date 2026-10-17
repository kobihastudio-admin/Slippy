import SwiftUI
import PhotosUI

// MARK: – Split mode

enum SplitMode: String, CaseIterable {
    case equal      = "equal"        // หารเท่ากัน
    case custom     = "custom"       // กำหนดเอง
    case percentage = "percentage"   // ตามสัดส่วน %
    case item       = "item"         // ตามรายการ

    var label: String {
        switch self {
        case .equal:      return "หารเท่ากัน"
        case .custom:     return "กำหนดเอง"
        case .percentage: return "ตามสัดส่วน %"
        case .item:       return "ตามรายการ"
        }
    }

    var icon: String {
        switch self {
        case .equal:      return "equal.circle.fill"
        case .custom:     return "slider.horizontal.3"
        case .percentage: return "percent"
        case .item:       return "list.bullet.rectangle"
        }
    }

    var description: String {
        switch self {
        case .equal:      return "หารยอดรวมเท่าๆ กันทุกคน"
        case .custom:     return "กำหนดยอดเองแต่ละคน"
        case .percentage: return "แบ่งตามสัดส่วนเปอร์เซ็นต์"
        case .item:       return "เลือกรายการที่แต่ละคนสั่ง"
        }
    }
}

// MARK: – Draft models

struct DraftParticipant: Identifiable {
    let id = UUID()
    var name: String
    var amount: Double      // สำหรับ custom mode
    var percentage: Double  // สำหรับ percentage mode (0–100)
    var items: [UUID]       // สำหรับ item mode
}

struct DraftItem: Identifiable {
    let id = UUID()
    var name: String
    var price: Double
    var assignedTo: [UUID]  // participant ids
    /// Which scanned receipt this line item came from, if any — lets removing
    /// a receipt clean up the items it contributed instead of leaving orphans.
    /// nil for items added manually via "เพิ่มรายการ".
    var sourceReceiptId: UUID? = nil
    var isIncluded = true
}

enum CreateSplitStep: Int, CaseIterable {
    case details = 1
    case friends = 2
    case review = 3

    var title: String {
        switch self {
        case .details: return "รายละเอียด"
        case .friends: return "รายการและเพื่อน"
        case .review: return "ตรวจสอบ"
        }
    }
}

enum SplitBillCategory: String, CaseIterable {
    case food = "อาหารและเครื่องดื่ม"
    case travel = "เดินทาง"
    case shopping = "ช้อปปิ้ง"
    case activity = "กิจกรรม"
    case other = "อื่นๆ"

    var icon: String {
        switch self {
        case .food: return "fork.knife"
        case .travel: return "car.fill"
        case .shopping: return "bag.fill"
        case .activity: return "sparkles"
        case .other: return "square.grid.2x2.fill"
        }
    }

    var tint: Color {
        switch self {
        case .food: return Color(hex: "#fb923c")
        case .travel: return Color(hex: "#38bdf8")
        case .shopping: return Color(hex: "#ec4899")
        case .activity: return Color(hex: "#8b5cf6")
        case .other: return Color.textTertiary
        }
    }
}

/// One scanned/selected bill — "หารบิล" now supports scanning multiple bills
/// into one split (e.g. several receipts from the same trip/meal), each kept
/// here so it can be reviewed and removed individually before saving. The
/// combined total auto-recalculates as the sum of every receipt's amount.
struct ScannedReceipt: Identifiable {
    let id = UUID()
    var result: SlipExtraction
    /// The original scanned photo — kept so OCRFullDetailView can offer
    /// "ดาวน์โหลดใบเสร็จต้นฉบับ" without needing a round-trip to storage.
    var image: UIImage?
    var sourceDocumentID: String? = nil
    /// Each bill has its own split pattern — only summed together across all
    /// receipts at the end (see CreateSplitView.aggregatedAmount).
    var splitMode: SplitMode = .equal
    var customAmounts: [UUID: Double] = [:]   // participant.id -> amount, .custom mode
    var percentages: [UUID: Double] = [:]     // participant.id -> percent, .percentage mode
    var vatMode: SplitVATMode = .receiptTotal
    var vatRateText = ""
    // .item mode reads draftItems filtered by sourceReceiptId == self.id
}

// MARK: – Create Split View

struct CreateSplitView: View {
    @ObservedObject var vm: SplitViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var totalAmountText = ""
    @State private var note = ""
    @State private var splitMode: SplitMode = .equal
    @State private var participants: [DraftParticipant] = []
    @State private var draftItems: [DraftItem] = []
    @State private var showAddParticipant = false
    @State private var showAddItem = false
    @State private var isSaving = false
    @State private var validationError: String?
    @State private var showModeSelector = false
    @State private var createdShareToken: String?
    @State private var showShareSheet = false
    @State private var createStep: CreateSplitStep = .details
    @State private var billDate = Date()
    @State private var location = ""
    @State private var category: SplitBillCategory?
    @State private var manualVATMode: SplitVATMode = .none
    @State private var manualVATRate = ""
    @State private var addingItemToReceiptId: UUID?

    // Receipt scan
    @State private var showImageSourceMenu = false
    @State private var showCameraPicker = false
    @State private var showPhotoPicker = false
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    /// Same cap used for gallery multi-select elsewhere (CameraPickerView) —
    /// keeps concurrent on-device OCR/processing bounded regardless of how
    /// many bills are already in this split.
    private let maxReceiptCount = 10
    @State private var isScanning = false
    @State private var receipts: [ScannedReceipt] = []
    /// Which receipt's "แก้ไขข้อมูล/รายการ" sheet is open, if any.
    @State private var editingReceiptId: UUID? = nil
    @State private var scanError: String?
    /// Images staged for review/rotate before OCR runs on them — both camera
    /// capture and gallery multi-select route through this so the user can
    /// confirm each one is the right photo and fix sideways/upside-down
    /// shots first, instead of OCR running blind on whatever came back.
    @State private var pendingReviewImages: [UIImage] = []
    @State private var showImageReview = false
    /// Which receipt's per-bill split editor is expanded — nil collapses all.
    @State private var expandedReceiptId: UUID?
    /// Set once the user manually edits the total themselves — after that,
    /// adding/removing receipts stops silently overwriting their number.
    @State private var totalManuallyEdited = false
    /// Guards the onChange below from mistaking our own programmatic
    /// updates (recomputeTotalFromReceipts) for a manual edit.
    @State private var isProgrammaticTotalUpdate = false

    init(vm: SplitViewModel, initialReceipt: SlipExtraction? = nil, sourceDocumentID: String? = nil) {
        self.vm = vm
        if let result = initialReceipt {
            let receipt = ScannedReceipt(result: result, image: nil, sourceDocumentID: sourceDocumentID)
            _receipts = State(initialValue: [receipt])
            _title = State(initialValue: result.vendorName ?? "")
            _totalAmountText = State(initialValue: result.totalAmount.map { String(format: "%.2f", $0) } ?? "")
            _draftItems = State(initialValue: result.lineItems.filter(\.isLineItem).map {
                DraftItem(name: $0.name, price: $0.amount, assignedTo: [], sourceReceiptId: receipt.id)
            })
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd"
            _billDate = State(initialValue: result.docDate.flatMap(formatter.date(from:)) ?? Date())
        }
    }

    var totalAmount: Double {
        if usesPerReceiptSplit { return receipts.reduce(0) { $0 + payableTotal(for: $1) } }
        return manualTaxCalculation?.total ?? 0
    }

    private var enteredAmount: Double { Double(totalAmountText.replacingOccurrences(of: ",", with: "")) ?? 0 }

    private func taxCalculation(for receipt: ScannedReceipt) -> SplitVATCalculation? {
        let items = draftItems.filter { $0.sourceReceiptId == receipt.id }
        let selected = items.filter(\.isIncluded).reduce(0) { $0 + $1.price }
        let source = items.reduce(0) { $0 + $1.price }
        return SplitBillVAT.calculate(base: items.isEmpty ? (receipt.result.totalAmount ?? 0) : selected,
            mode: receipt.vatMode, rate: SplitBillVAT.rate(from: receipt.vatRateText),
            referenceTotal: receipt.result.totalAmount, referenceBase: items.isEmpty ? nil : source)
    }

    private func payableTotal(for receipt: ScannedReceipt) -> Double { taxCalculation(for: receipt)?.total ?? 0 }

    private var manualTaxCalculation: SplitVATCalculation? {
        let selected = draftItems.filter(\.isIncluded).reduce(0) { $0 + $1.price }
        return SplitBillVAT.calculate(base: draftItems.isEmpty ? enteredAmount : selected,
            mode: manualVATMode, rate: SplitBillVAT.rate(from: manualVATRate),
            referenceTotal: enteredAmount, referenceBase: draftItems.isEmpty ? nil : draftItems.reduce(0) { $0 + $1.price })
    }

    private var hasValidTaxConfiguration: Bool {
        usesPerReceiptSplit ? receipts.allSatisfy { taxCalculation(for: $0) != nil } : manualTaxCalculation != nil
    }

    private var hasCompleteAssignments: Bool {
        let active = Set(participants.map(\.id))
        return draftItems.filter { item in
            guard item.isIncluded else { return false }
            if let id = item.sourceReceiptId { return receipts.first { $0.id == id }?.splitMode == .item }
            return !usesPerReceiptSplit && splitMode == .item
        }.allSatisfy { !$0.assignedTo.isEmpty && Set($0.assignedTo).isSubset(of: active) }
    }

    /// Once at least one bill is scanned, each one carries its own split
    /// mode (see ScannedReceipt) — the global splitMode/items UI only
    /// applies to the no-receipt manual-entry path.
    private var usesPerReceiptSplit: Bool { !receipts.isEmpty }

    private var assignedTotal: Double {
        guard !usesPerReceiptSplit else {
            return participants.reduce(0) { $0 + aggregatedAmount(for: $1) }
        }
        switch splitMode {
        case .equal: return totalAmount
        case .custom: return participants.reduce(0) { $0 + $1.amount }
        case .percentage: return participants.reduce(0) { $0 + amountFor($1) }
        // Sum per-participant (not draftItems directly) so this stays in
        // sync with itemAmountFor(_:), which now folds VAT into each
        // person's share — summing raw item prices here would under-count
        // against that by exactly the VAT amount.
        case .item: return participants.reduce(0) { $0 + itemAmountFor($1) }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                splitCreateBackground.ignoresSafeArea()
                VStack(spacing: 0) {
                    splitCreateHeader
                    stepProgress
                        .padding(.horizontal, 28)
                        .padding(.top, 18)
                        .padding(.bottom, 20)

                    ScrollView(showsIndicators: false) {
                        stepContent
                            .padding(.horizontal, 18)
                            .padding(.bottom, 118)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }

                VStack {
                    Spacer()
                    VStack(spacing: 16) {
                        if let err = validationError {
                            Text(err)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 18)
                        }
                        bottomActionButton
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 16)
                    .background(
                        LinearGradient(
                            colors: [Color.white.opacity(0), Color.background],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .ignoresSafeArea()
                    )
                }
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showAddParticipant) {
                SplitFriendPickerSheet(accountID: authVM.session?.user.id.uuidString ?? "") { name, amount in
                    let pct = participants.isEmpty ? 100.0 : 0.0
                    participants.append(DraftParticipant(name: name, amount: amount, percentage: pct, items: []))
                    for index in receipts.indices where receipts[index].splitMode == .percentage {
                        normalizeReceiptPercentages($receipts[index])
                    }
                    if splitMode == .equal { recalcEqual() }
                    if splitMode == .percentage { normalizePercentages() }
                }
            }
            .sheet(isPresented: $showAddItem) {
                AddItemSheet { name, price in
                    draftItems.append(DraftItem(name: name, price: price, assignedTo: [], sourceReceiptId: addingItemToReceiptId))
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("เสร็จ", systemImage: "keyboard.chevron.compact.down") {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                    .accessibilityIdentifier("split.dismissKeyboard")
                }
            }
            .sheet(isPresented: $showShareSheet, onDismiss: { dismiss() }) {
                if let token = createdShareToken {
                    ShareBillSheet(shareToken: token)
                        .presentationDetents([.medium])
                }
            }
            .sheet(isPresented: $showCameraPicker) {
                CameraImagePicker { image in
                    pendingReviewImages = [image]
                    showImageReview = true
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $showPhotoPicker, selection: $selectedPhotoItems,
                          maxSelectionCount: max(1, maxReceiptCount - receipts.count),
                          matching: .images, photoLibrary: .shared())
            .onChange(of: selectedPhotoItems) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    var loaded: [UIImage] = []
                    for item in items {
                        guard receipts.count + loaded.count < maxReceiptCount else { break }
                        if let data = try? await item.loadTransferable(type: Data.self),
                           let image = UIImage(data: data) {
                            loaded.append(image)
                        }
                    }
                    selectedPhotoItems = []
                    guard !loaded.isEmpty else { return }
                    pendingReviewImages = loaded
                    showImageReview = true
                }
            }
            .fullScreenCover(isPresented: $showImageReview) {
                ImageReviewSheet(images: pendingReviewImages) { confirmed in
                    Task {
                        // Sequential, same reasoning as before — isScanning
                        // stays a meaningful "doing one thing at a time" signal.
                        for img in confirmed { await runOCR(on: img) }
                    }
                }
            }
        }
    }

    // MARK: – Create flow shell

    private var splitCreateBackground: some View {
        LinearGradient(
            colors: [
                Color.background,
                Color.surfaceMuted,
                Color.surface
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var splitCreateHeader: some View {
        HStack {
            Button {
                if createStep == .details { dismiss() }
                else { withAnimation(.spring(response: 0.25)) { createStep = previousStep } }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            VStack(spacing: 2) {
                Text("สร้างการหารบิล")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
            }

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var stepProgress: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(CreateSplitStep.allCases, id: \.self) { step in
                VStack(spacing: 8) {
                    ZStack {
                        Circle()
                            .fill(step.rawValue <= createStep.rawValue ? Color.brand500 : Color.border)
                            .frame(width: 30, height: 30)
                        Text("\(step.rawValue)")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(step.rawValue <= createStep.rawValue ? .white : Color.textSecondary)
                    }
                    Text(step.title)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(step == createStep ? Color.brand500 : Color.textSecondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .background {
            GeometryReader { geometry in
                Rectangle().fill(Color.border)
                    .frame(width: geometry.size.width * 2 / 3, height: 2)
                    .position(x: geometry.size.width / 2, y: 15)
            }
            .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch createStep {
        case .details:
            VStack(spacing: 16) {
                billDetailsCard
                amountCard
                categoryAndModeRow
                if !usesPerReceiptSplit && splitMode == .item {
                    compactItemsCard
                } else if !draftItems.isEmpty {
                    compactItemsCard
                }
                if !receipts.isEmpty { scannedReceiptsCard }
            }
        case .friends:
            VStack(spacing: 16) {
                participantsCard
                addItemControl.frame(maxWidth: .infinity, alignment: .leading)
                if usesPerReceiptSplit {
                    ForEach($receipts) { receipt in
                        VStack(alignment: .leading, spacing: 14) {
                            Text(receipt.wrappedValue.result.vendorName ?? "ใบเสร็จ")
                                .font(.system(size: 15, weight: .semibold))
                            receiptSplitEditor(receipt)
                            vatEditor(mode: receipt.vatMode, rate: receipt.vatRateText,
                                      calculation: taxCalculation(for: receipt.wrappedValue))
                        }
                        .padding(14)
                        .background(Color.surface, in: RoundedRectangle(cornerRadius: 8))
                    }
                } else {
                    splitModeCard
                    if !draftItems.isEmpty { assignmentRows(indices: Array(draftItems.indices), receiptId: nil) }
                    vatEditor(mode: $manualVATMode, rate: $manualVATRate, calculation: manualTaxCalculation)
                }
            }
        case .review:
            VStack(spacing: 16) {
                reviewBillCard
                participantsCard
                summaryCard
            }
        }
    }

    private var nextStep: CreateSplitStep {
        switch createStep {
        case .details: return .friends
        case .friends: return .review
        case .review: return .review
        }
    }

    private var previousStep: CreateSplitStep {
        switch createStep {
        case .details: return .details
        case .friends: return .details
        case .review: return .friends
        }
    }

    private var bottomActionButton: some View {
        Button {
            hapticLight()
            advanceOrSave()
        } label: {
            HStack(spacing: 12) {
                if isSaving {
                    ProgressView().tint(.white)
                } else {
                    Text(createStep == .review ? "บันทึกการหารบิล" : "ถัดไป: \(nextStep.title)")
                        .font(.system(size: 15, weight: .semibold))
                    Image(systemName: createStep == .review ? "checkmark" : "chevron.right")
                        .font(.system(size: 17, weight: .bold))
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                LinearGradient(
                    colors: [Color(hex: "#6d4df6"), Color(hex: "#5636e9")],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .shadow(color: Color.brand500.opacity(0.32), radius: 16, x: 0, y: 10)
        }
        .disabled(isSaving)
        .accessibilityIdentifier("split.next")
    }

    // MARK: – Receipt scan card

    private var receiptScanCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.brand500.opacity(0.1))
                        .frame(width: 44, height: 44)
                    Image(systemName: "doc.text.viewfinder")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(Color.brand500)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("สแกนใบเสร็จ")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                    Text("AI อ่านยอดและรายการให้อัตโนมัติ")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }
                Spacer()
                if isScanning {
                    ProgressView().tint(Color.brand500)
                }
            }
            .padding(16)

            if let err = scanError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12)).foregroundColor(.orange)
                    Text(err).font(.system(size: 12)).foregroundColor(.orange)
                    Spacer()
                    Button { scanError = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 11)).foregroundColor(Color.textSecondary)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 12)
            }

            Divider()

            HStack(spacing: 0) {
                scanSourceButton(icon: "camera.fill", label: "ถ่ายรูป") {
                    hapticLight(); showCameraPicker = true
                }
                Divider().frame(height: 44)
                scanSourceButton(icon: "photo.on.rectangle", label: "เลือกรูป") {
                    hapticLight(); showPhotoPicker = true
                }
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func scanSourceButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        let reachedLimit = receipts.count >= maxReceiptCount
        return Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 14))
                Text(reachedLimit ? "ครบ \(maxReceiptCount) บิลแล้ว" : label).font(.system(size: 13, weight: .medium))
            }
            .foregroundColor((isScanning || reachedLimit) ? Color.textSecondary : Color.brand500)
            .frame(maxWidth: .infinity).frame(height: 44)
        }
        .disabled(isScanning || reachedLimit)
    }

    /// Lists every scanned bill — each removable on its own — plus the
    /// combined total across all of them. Scanning again (camera/photo
    /// button above) adds another receipt instead of replacing this one.
    private var scannedReceiptsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green).font(.system(size: 14))
                Text("\(receipts.count) บิลที่สแกนแล้ว")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textPrimary)
                Spacer()
                Text("รวม \(fmtTHB(receiptsTotal))")
                    .font(.system(size: 13, weight: .bold)).foregroundColor(Color.brand500)
            }

            VStack(spacing: 8) {
                ForEach($receipts) { $receipt in
                    receiptRow($receipt)
                }
            }

            Text("แตะที่บิลเพื่อเลือกรูปแบบการหารของบิลนั้น — แต่ละบิลกำหนดแยกกันได้ แล้วระบบจะรวมยอดของทุกคนให้ทีหลัง")
                .font(.system(size: 11)).foregroundColor(Color.textSecondary)
        }
        .padding(14)
        .background(Color.green.opacity(0.06))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.green.opacity(0.25), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func receiptRow(_ receipt: Binding<ScannedReceipt>) -> some View {
        let result = receipt.wrappedValue.result
        let isExpanded = expandedReceiptId == receipt.wrappedValue.id
        let receiptId = receipt.wrappedValue.id
        return VStack(spacing: 0) {
            Button {
                hapticLight()
                withAnimation(.spring(response: 0.25)) {
                    expandedReceiptId = isExpanded ? nil : receipt.wrappedValue.id
                }
            } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(result.vendorName ?? "ไม่ทราบชื่อร้าน")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textPrimary)
                            .lineLimit(1)
                        HStack(spacing: 10) {
                            scanTag(icon: "banknote", value: result.totalAmount.map { fmtTHB($0) } ?? "-")
                            scanTag(icon: receipt.wrappedValue.splitMode.icon, value: receipt.wrappedValue.splitMode.label)
                            if !result.lineItems.isEmpty {
                                scanTag(icon: "list.bullet", value: "\(result.lineItems.count) รายการ")
                            }
                        }
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                    Button {
                        hapticLight()
                        withAnimation { removeReceipt(receipt.wrappedValue) }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18)).foregroundColor(Color.textSecondary.opacity(0.5))
                    }
                }
                .padding(10)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                HStack {
                    Spacer()
                    Button {
                        hapticLight()
                        editingReceiptId = receiptId
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "square.and.pencil").font(.system(size: 11))
                            Text("แก้ไขข้อมูล/รายการ").font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundColor(Color.brand500)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Color.brand500.opacity(0.1))
                        .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 10).padding(.top, 8)

                receiptSplitEditor(receipt)
                    .padding(10)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .sheet(item: Binding(
            get: { editingReceiptId == receiptId ? receipt.wrappedValue : nil },
            set: { _ in editingReceiptId = nil }
        )) { current in
            OCRFullDetailView(extraction: current.result, originalImage: current.image) { updated in
                applyEditedExtraction(updated, to: receiptId)
            }
        }
    }

    /// Per-bill mode picker + the matching per-participant editor — same 4
    /// modes as the global picker, just scoped to one receipt's total.
    @ViewBuilder
    private func receiptSplitEditor(_ receipt: Binding<ScannedReceipt>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("วิธีหารบิลนี้", selection: receipt.splitMode) {
                ForEach(SplitMode.allCases, id: \.self) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.menu)
            .font(.system(size: 14))
            .onChange(of: receipt.wrappedValue.splitMode) { _, mode in
                if mode == .percentage {
                    normalizeReceiptPercentages(receipt)
                }
            }

            ForEach(participants) { p in
                HStack {
                    Text(p.name).font(.system(size: 13)).foregroundColor(Color.textPrimary)
                    Spacer()
                    switch receipt.wrappedValue.splitMode {
                    case .equal:
                        Text(fmtTHB(roundedReceiptAmount(for: p, in: receipt.wrappedValue), decimals: 2))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)

                    case .custom:
                        SplitAmountField("จำนวนเงิน", value: Binding(
                            get: { receipt.wrappedValue.customAmounts[p.id] ?? 0 },
                            set: { receipt.wrappedValue.customAmounts[p.id] = $0 }
                        ))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .frame(width: 80)

                    case .percentage:
                        HStack(spacing: 4) {
                            SplitAmountField("สัดส่วน", value: Binding(
                                get: { receipt.wrappedValue.percentages[p.id] ?? 0 },
                                set: { receipt.wrappedValue.percentages[p.id] = $0 }
                            ))
                                .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                .frame(width: 44)
                            Text("%").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                        }

                    case .item:
                        Text(fmtTHB(roundedReceiptAmount(for: p, in: receipt.wrappedValue), decimals: 2))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                    }
                }
            }

            receiptItemsList(receipt)

            let diff = payableTotal(for: receipt.wrappedValue)
                - participants.reduce(0) { $0 + amount(for: $1, in: receipt.wrappedValue) }
            if participants.count > 1 {
                Text(abs(diff) < 0.01 ? "แบ่งครบยอดแล้ว ✓" : "เหลือ \(fmtTHB(diff)) ยังไม่ได้แบ่ง")
                    .font(.system(size: 11)).foregroundColor(abs(diff) < 0.01 ? Color.statusApproved : .orange)
            }
        }
    }

    private func receiptItemsList(_ receipt: Binding<ScannedReceipt>) -> some View {
        let indices = draftItems.indices.filter { draftItems[$0].sourceReceiptId == receipt.wrappedValue.id }
        return assignmentRows(indices: indices, receiptId: receipt.wrappedValue.id)
    }

    private func assignmentRows(indices: [Int], receiptId: UUID?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("รายการที่นำมาหาร (\(indices.filter { draftItems[$0].isIncluded }.count)/\(indices.count))")
                .font(.system(size: 14, weight: .semibold))
            ForEach(indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 10) {
                        Button { draftItems[index].isIncluded.toggle() } label: {
                            Image(systemName: draftItems[index].isIncluded ? "checkmark.square.fill" : "square")
                                .font(.system(size: 21)).foregroundStyle(Color.brand500)
                                .frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("นำ \(draftItems[index].name) มาหาร")
                        .accessibilityIdentifier("split.item.include.\(index)")
                        .accessibilityValue(draftItems[index].isIncluded ? "เลือกแล้ว" : "ไม่เลือก")
                        Text(draftItems[index].name)
                            .font(.system(size: 14)).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(fmtTHB(draftItems[index].price, decimals: 2))
                            .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                    }
                    if draftItems[index].isIncluded {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), alignment: .leading)], alignment: .leading, spacing: 6) {
                            ForEach(participants) { participant in
                                let selected = draftItems[index].assignedTo.contains(participant.id)
                                Button {
                                    if selected { draftItems[index].assignedTo.removeAll { $0 == participant.id } }
                                    else { draftItems[index].assignedTo.append(participant.id) }
                                    if let receiptId, let slot = receipts.firstIndex(where: { $0.id == receiptId }) {
                                        receipts[slot].splitMode = .item
                                    } else { splitMode = .item }
                                } label: {
                                    HStack(alignment: .top, spacing: 6) {
                                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                        Text(participant.name).fixedSize(horizontal: false, vertical: true)
                                    }
                                    .font(.system(size: 13))
                                    .foregroundStyle(selected ? Color.brand500 : Color.textSecondary)
                                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                                }
                                .accessibilityLabel("\(participant.name) จ่าย \(draftItems[index].name)")
                                .accessibilityIdentifier("split.assignment.\(index).\(participants.firstIndex(where: { $0.id == participant.id }) ?? 0)")
                                .accessibilityValue(selected ? "เลือกแล้ว" : "ไม่เลือก")
                            }
                        }
                        if !participants.isEmpty && draftItems[index].assignedTo.isEmpty {
                            Text("ยังไม่ได้เลือกผู้ร่วมจ่าย").font(.system(size: 12)).foregroundStyle(Color.textSecondary)
                        }
                    }
                }
                Divider()
            }
        }
    }

    private func vatEditor(mode: Binding<SplitVATMode>, rate: Binding<String>, calculation: SplitVATCalculation?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("การคำนวณ VAT").font(.system(size: 12)).foregroundStyle(Color.textSecondary)
            Menu {
                ForEach(SplitVATMode.allCases) { option in
                    Button(option.title) { mode.wrappedValue = option }
                }
            } label: {
                HStack {
                    Text(mode.wrappedValue.title).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Image(systemName: "chevron.down")
                }
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            }
            .font(.system(size: 14))
            .accessibilityIdentifier("split.vat.mode")
            if mode.wrappedValue.needsRate {
                HStack {
                    Text("อัตรา VAT").font(.system(size: 13)).foregroundStyle(Color.textSecondary)
                    TextField("ระบุอัตรา VAT", text: rate)
                        .font(.system(size: 14)).keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("split.vat.rate")
                    Text("%").font(.system(size: 14))
                }
            }
            if let calculation {
                if let net = calculation.net { reviewRow("ยอดก่อน VAT", fmtTHB(net, decimals: 2)) }
                if let tax = calculation.vat { reviewRow("VAT", fmtTHB(tax, decimals: 2)) }
                HStack {
                    Text("ยอดที่นำมาหาร").font(.system(size: 13))
                    Spacer()
                    Text(fmtTHB(calculation.total, decimals: 2))
                        .font(.system(size: 15, weight: .semibold)).monospacedDigit()
                        .accessibilityIdentifier("split.vat.total")
                }
            } else {
                Text("ระบุอัตรา VAT เป็นตัวเลขระหว่าง 0–100%")
                    .font(.system(size: 13)).foregroundStyle(.red)
            }
        }
        .foregroundStyle(Color.textPrimary)
    }

    private func normalizeReceiptPercentages(_ receipt: Binding<ScannedReceipt>) {
        guard !participants.isEmpty else { return }
        let each = 100.0 / Double(participants.count)
        for p in participants { receipt.wrappedValue.percentages[p.id] = each }
    }

    /// One participant's share of one receipt, in that receipt's own mode.
    private func amount(for participant: DraftParticipant, in receipt: ScannedReceipt) -> Double {
        let total = payableTotal(for: receipt)
        switch receipt.splitMode {
        case .equal:
            guard let index = participants.firstIndex(where: { $0.id == participant.id }) else { return 0 }
            let shares = SplitBillAmounts.equalShares(total: total, count: participants.count)
            return shares.indices.contains(index) ? shares[index] : 0
        case .custom:
            return receipt.customAmounts[participant.id] ?? 0
        case .percentage:
            return total * (receipt.percentages[participant.id] ?? 0) / 100.0
        case .item:
            return itemModeAmount(for: participant.id, in: receipt)
        }
    }

    /// Allocate the actual paid total by item weights; never add guessed VAT
    /// to a receipt whose printed prices may already include it.
    private func itemModeAmount(for participantId: UUID, in receipt: ScannedReceipt) -> Double {
        let items = draftItems.filter { $0.sourceReceiptId == receipt.id && $0.isIncluded }
        let participantSubtotal = items.filter { $0.assignedTo.contains(participantId) }
            .reduce(0) { $0 + $1.price / Double(max(1, $1.assignedTo.count)) }
        return SplitBillAmounts.itemShare(subtotal: participantSubtotal,
            itemsSubtotal: items.reduce(0) { $0 + $1.price }, total: payableTotal(for: receipt))
    }

    private func roundedReceiptAmount(for participant: DraftParticipant, in receipt: ScannedReceipt) -> Double {
        guard let index = participants.firstIndex(where: { $0.id == participant.id }) else { return 0 }
        let raw = participants.map { amount(for: $0, in: receipt) }
        let rounded = SplitBillAmounts.roundedShares(raw, total: payableTotal(for: receipt))
        return rounded?[index] ?? raw[index]
    }

    /// A participant's combined total across every scanned receipt — this is
    /// what actually gets saved once any bills have been scanned.
    private func aggregatedAmount(for participant: DraftParticipant) -> Double {
        receipts.reduce(0) { $0 + roundedReceiptAmount(for: participant, in: $1) }
    }

    private var hasBalancedReceipts: Bool {
        guard usesPerReceiptSplit else { return true }
        return receipts.allSatisfy { receipt in
            let shares = participants.map { amount(for: $0, in: receipt) }
            return shares.allSatisfy { $0.isFinite && $0 >= 0 }
                && abs(shares.reduce(0, +) - payableTotal(for: receipt)) < 0.005
        }
    }

    private func scanTag(icon: String, value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundColor(Color.brand500)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(Color.textPrimary)
                .lineLimit(1)
        }
    }

    // MARK: – OCR scan

    private func preserveManualItemsBeforeFirstReceipt() {
        guard receipts.isEmpty, !draftItems.isEmpty else { return }
        let allItemsTotal = draftItems.reduce(0) { $0 + $1.price }
        let sourceTotal = manualVATMode == .receiptTotal ? enteredAmount :
            (SplitBillVAT.calculate(base: allItemsTotal, mode: manualVATMode,
                                   rate: SplitBillVAT.rate(from: manualVATRate))?.total ?? enteredAmount)
        let result = SlipExtraction(vendorName: "รายการที่กรอกเอง", totalAmount: sourceTotal,
            lineItems: draftItems.map { LineItem(name: $0.name, amount: $0.price) }, confidence: 1)
        var group = ScannedReceipt(result: result, image: nil, splitMode: splitMode)
        group.vatMode = manualVATMode
        group.vatRateText = manualVATRate
        group.customAmounts = Dictionary(uniqueKeysWithValues: participants.map { ($0.id, $0.amount) })
        group.percentages = Dictionary(uniqueKeysWithValues: participants.map { ($0.id, $0.percentage) })
        for index in draftItems.indices { draftItems[index].sourceReceiptId = group.id }
        receipts.append(group)
    }

    @MainActor
    private func runOCR(on image: UIImage) async {
        isScanning = true
        scanError = nil
        defer { isScanning = false }

        let result = await Task.detached(priority: .userInitiated) {
            await SlipOCRService.extract(from: image)
        }.value

        guard result.confidence > 0 || result.totalAmount != nil else {
            scanError = "อ่านข้อมูลไม่ได้ กรุณาลองใหม่หรือกรอกเอง"
            return
        }

        // Auto-fill title from the first receipt only — later receipts in
        // the same split shouldn't keep renaming it.
        if title.isEmpty, let vendor = result.vendorName {
            title = vendor
        }

        preserveManualItemsBeforeFirstReceipt()
        guard receipts.count < maxReceiptCount else {
            scanError = "เพิ่มได้ไม่เกิน \(maxReceiptCount) บิล"
            return
        }
        let receipt = ScannedReceipt(result: result, image: image)
        receipts.append(receipt)

        // Populate line items, tagged to this receipt so removing it later
        // can clean these back up. Skips items the user marked as not a
        // real line item in OCRFullDetailView (e.g. เงินสด/เงินทอน) —
        // pulling those into "ตามรายการ" mode would let them get assigned
        // to a participant and double-count toward the split total.
        let realLineItems = result.lineItems.filter(\.isLineItem)
        if !realLineItems.isEmpty {
            let newItems = realLineItems.map {
                DraftItem(name: $0.name, price: $0.amount, assignedTo: [], sourceReceiptId: receipt.id)
            }
            draftItems.append(contentsOf: newItems)
        }

        recomputeTotalFromReceipts()
        hapticSuccess()
    }

    /// Combined total across every scanned receipt.
    private var receiptsTotal: Double {
        receipts.reduce(0) { $0 + ($1.result.totalAmount ?? 0) }
    }

    /// Per-receipt shares and the displayed total must use the same amounts.
    private func recomputeTotalFromReceipts() {
        guard !receipts.isEmpty else { return }
        isProgrammaticTotalUpdate = true
        totalAmountText = String(format: "%.2f", receiptsTotal)
        recalcEqual()
        recalcPercentage()
    }

    /// Applies an edit made in OCRFullDetailView back onto one receipt —
    /// previously this screen never opened that editor at all, so a bill's
    /// items (vendor name, total, which lines actually count) could only
    /// ever be fixed for the main document-upload flow, not here.
    private func applyEditedExtraction(_ updated: SlipExtraction, to receiptId: UUID) {
        guard let idx = receipts.firstIndex(where: { $0.id == receiptId }) else { return }
        receipts[idx].result = updated

        // Re-sync this receipt's items in "ตามรายการ" mode: drop the old
        // ones and re-add from the corrected lineItems (skipping anything
        // marked not-a-real-line-item), same filter as initial import.
        draftItems.removeAll { $0.sourceReceiptId == receiptId }
        let realLineItems = updated.lineItems.filter(\.isLineItem)
        for item in realLineItems {
            draftItems.append(DraftItem(name: item.name, price: item.amount, assignedTo: [], sourceReceiptId: receiptId))
        }
        recomputeTotalFromReceipts()
    }

    private func removeReceipt(_ receipt: ScannedReceipt) {
        receipts.removeAll { $0.id == receipt.id }
        draftItems.removeAll { $0.sourceReceiptId == receipt.id }
        if receipts.isEmpty && !totalManuallyEdited {
            isProgrammaticTotalUpdate = true
            totalAmountText = ""
            recalcEqual()
            recalcPercentage()
        } else {
            recomputeTotalFromReceipts()
        }
    }

    // MARK: – Mockup-styled details

    private var billDetailsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("รายละเอียดบิล")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Color.textPrimary)
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 10)

            detailInputRow(
                icon: "receipt.fill",
                tint: Color.brand500,
                label: "ชื่อบิล",
                trailing: title.isEmpty ? nil : "xmark.circle.fill"
            ) {
                TextField("ระบุชื่อบิล", text: $title,
                          prompt: Text("ระบุชื่อบิล").foregroundColor(Color.textTertiary))
                    .accessibilityIdentifier("split.title")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Color.textPrimary)
            } trailingAction: {
                title = ""
            }

            Divider().padding(.leading, 66)

            detailInputRow(icon: "calendar", tint: Color(hex: "#ec4899"), label: "วันที่และเวลา") {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        DatePicker("", selection: $billDate, displayedComponents: .date).labelsHidden()
                        Text("·").foregroundColor(Color.textSecondary)
                        DatePicker("", selection: $billDate, displayedComponents: .hourAndMinute).labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        DatePicker("", selection: $billDate, displayedComponents: .date).labelsHidden()
                        DatePicker("", selection: $billDate, displayedComponents: .hourAndMinute).labelsHidden()
                    }
                }
            }

            Divider().padding(.leading, 66)

            detailInputRow(icon: "mappin.circle.fill", tint: Color(hex: "#3b9df4"), label: "สถานที่") {
                TextField("ระบุร้านหรือสถานที่ (ไม่บังคับ)", text: $location,
                          prompt: Text("ระบุร้านหรือสถานที่ (ไม่บังคับ)").foregroundColor(Color.textTertiary))
                    .font(.system(size: 14))
                    .foregroundColor(Color.textPrimary)
            }

            Divider().padding(.leading, 66)

            detailInputRow(icon: "clipboard.fill", tint: Color(hex: "#fb923c"), label: "โน้ต (ไม่บังคับ)") {
                TextField("เพิ่มโน้ตหรือรายละเอียดเพิ่มเติม...", text: $note,
                          prompt: Text("เพิ่มโน้ตหรือรายละเอียดเพิ่มเติม...").foregroundColor(Color.textTertiary))
                    .font(.system(size: 14))
                    .foregroundColor(Color.textPrimary)
            }
        }
        .background(Color.surface.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: Color.brand600.opacity(0.06), radius: 20, x: 0, y: 10)
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(receipts.isEmpty ? "ยอดเงินที่ระบุ" : "ยอดสุทธิตามใบเสร็จ")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Color.textPrimary)

            HStack(spacing: 12) {
                TextField("ระบุยอดเงิน", text: $totalAmountText,
                          prompt: Text("ระบุยอดเงิน").foregroundColor(Color.textTertiary))
                    .accessibilityIdentifier("split.total")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .keyboardType(.decimalPad)
                    .disabled(receipts.count > 1)
                    .onChange(of: totalAmountText) { _, _ in
                        if isProgrammaticTotalUpdate { isProgrammaticTotalUpdate = false }
                        else {
                            totalManuallyEdited = true
                        }
                        if receipts.count == 1 { receipts[0].result.totalAmount = enteredAmount }
                        if splitMode == .equal { recalcEqual() }
                        if splitMode == .percentage { recalcPercentage() }
                    }
                Divider().frame(height: 42)
                Text("฿")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Color.textPrimary)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: "#d7d3f4"), lineWidth: 1.2))

            Button {
                hapticLight()
                showImageSourceMenu.toggle()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 34, height: 30)
                        .background(Color.brand500)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text(receipts.isEmpty ? "เพิ่มสลิป / ใบเสร็จ" : "เพิ่มสลิปอีกใบ")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(Color.brand500)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .confirmationDialog("เพิ่มสลิป / ใบเสร็จ", isPresented: $showImageSourceMenu, titleVisibility: .visible) {
                Button("ถ่ายรูป") { showCameraPicker = true }
                Button("เลือกรูป") { showPhotoPicker = true }
                Button("ยกเลิก", role: .cancel) {}
            }

            if isScanning {
                HStack(spacing: 8) {
                    ProgressView().tint(Color.brand500)
                    Text("กำลังอ่านใบเสร็จ...")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color.textSecondary)
                }
            }

            if let err = scanError {
                Text(err)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.orange)
            }
        }
        .padding(20)
        .background(
            LinearGradient(
                colors: [Color.surface.opacity(0.98), Color.surfaceMuted],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: Color.brand600.opacity(0.06), radius: 20, x: 0, y: 10)
    }

    private var categoryAndModeRow: some View {
        VStack(spacing: 10) {
            menuSelectCard(label: "หมวดหมู่", value: category?.rawValue ?? "เลือกหมวดหมู่", icon: category?.icon ?? "square.grid.2x2", tint: category?.tint ?? Color.textSecondary) {
                ForEach(SplitBillCategory.allCases, id: \.self) { option in
                    Button(option.rawValue) { category = option }
                }
            }

            menuSelectCard(label: "วิธีหารบิล", value: splitDescription, icon: splitMode.icon, tint: Color.brand500) {
                ForEach(SplitMode.allCases, id: \.self) { mode in
                    Button(mode.label) {
                        splitMode = mode
                        for index in receipts.indices {
                            receipts[index].splitMode = mode
                            if mode == .percentage { normalizeReceiptPercentages($receipts[index]) }
                        }
                        if mode == .equal { recalcEqual() }
                        if mode == .percentage { normalizePercentages() }
                    }
                }
            }
        }
    }

    private var compactItemsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("รายการในบิล")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                addItemControl
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 8)

            if draftItems.isEmpty {
                Text("ยังไม่มีรายการ")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 18)
            } else {
                ForEach(Array(draftItems.enumerated()), id: \.element.id) { offset, item in
                    compactItemRow(item)
                    if offset < draftItems.count - 1 {
                        Divider().padding(.leading, 90)
                    }
                }
            }
        }
        .background(Color.surface.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: Color.brand600.opacity(0.05), radius: 18, x: 0, y: 8)
    }

    private var reviewBillCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ตรวจสอบก่อนบันทึก")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Color.textPrimary)
            reviewRow("ชื่อบิล", title.trimmingCharacters(in: .whitespaces).isEmpty ? "-" : title)
            reviewRow("วันที่", splitDateLabel)
            reviewRow("สถานที่", location.isEmpty ? "-" : location)
            reviewRow("หมวดหมู่", category?.rawValue ?? "ไม่ระบุ")
            reviewRow("ยอดรวม", fmtTHB(totalAmount, decimals: 2))
            reviewRow("วิธีหารบิล", splitDescription)
            reviewRow("รายการที่เลือก", "\(draftItems.filter(\.isIncluded).count) จาก \(draftItems.count) รายการ")
            if usesPerReceiptSplit {
                ForEach(receipts) { receipt in
                    reviewRow("VAT · \(receipt.result.vendorName ?? "ใบเสร็จ")", receipt.vatMode.title)
                    if let vat = taxCalculation(for: receipt)?.vat { reviewRow("VAT", fmtTHB(vat, decimals: 2)) }
                }
            } else {
                reviewRow("VAT", manualVATMode.title)
                if let vat = manualTaxCalculation?.vat { reviewRow("ยอด VAT", fmtTHB(vat, decimals: 2)) }
            }
        }
        .padding(20)
        .background(Color.surface.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: Color.brand600.opacity(0.05), radius: 18, x: 0, y: 8)
    }

    @ViewBuilder private var addItemControl: some View {
        if receipts.isEmpty {
            Button {
                addingItemToReceiptId = nil
                showAddItem = true
            } label: { Label("เพิ่มรายการ", systemImage: "plus") }
                .font(.system(size: 14, weight: .medium))
        } else {
            Menu {
                ForEach(Array(receipts.enumerated()), id: \.element.id) { index, receipt in
                    Button("ใบที่ \(index + 1) · \(receipt.result.vendorName ?? "ใบเสร็จ")") {
                        addingItemToReceiptId = receipt.id
                        showAddItem = true
                    }
                }
            } label: { Label("เพิ่มรายการ", systemImage: "plus") }
                .font(.system(size: 14, weight: .medium))
        }
    }

    private func detailInputRow<Content: View>(
        icon: String,
        tint: Color,
        label: String,
        trailing: String? = nil,
        @ViewBuilder content: () -> Content,
        trailingAction: (() -> Void)? = nil
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(tint.opacity(0.14)).frame(width: 34, height: 34)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(tint)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                content()
            }

            Spacer(minLength: 8)

            if let trailing {
                Button {
                    trailingAction?()
                } label: {
                    Image(systemName: trailing)
                        .font(.system(size: trailing == "chevron.right" ? 18 : 20, weight: .bold))
                        .foregroundColor(Color.textSecondary)
                }
                .disabled(trailingAction == nil)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private func menuSelectCard<Content: View>(
        label: String,
        value: String,
        icon: String,
        tint: Color,
        @ViewBuilder menu: () -> Content
    ) -> some View {
        Menu {
            menu()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color.textSecondary)
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(tint.opacity(0.16)).frame(width: 30, height: 30)
                        Image(systemName: icon)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(tint)
                    }
                    Text(value)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color.textSecondary)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.surface.opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.surfaceMuted, lineWidth: 1))
        }
    }

    private func compactItemRow(_ item: DraftItem) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.warningSurface)
                    .frame(width: 32, height: 32)
                Image(systemName: "fork.knife")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color(hex: "#fb923c"))
            }
            Text(item.name)
                .font(.system(size: 14))
                .foregroundColor(Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
            Text(fmtTHB(item.price, decimals: 2))
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Color.textPrimary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }

    private func reviewRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textSecondary)
            Spacer(minLength: 20)
            Text(value)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private var splitDateLabel: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "th_TH")
        formatter.dateFormat = "d MMM yy · HH:mm"
        return formatter.string(from: billDate)
    }

    // MARK: – Basic info

    private var basicInfoCard: some View {
        VStack(spacing: 0) {
            fieldRow(label: "ชื่อรายการ", placeholder: "เช่น ข้าวกลางวัน, ทริปเชียงใหม่") {
                TextField("", text: $title).font(.system(size: 15)).foregroundColor(Color.textPrimary)
            }
            Divider().padding(.leading, 16)
            fieldRow(label: "ยอดรวม (฿)", placeholder: "0.00") {
                TextField("", text: $totalAmountText)
                    .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                    .keyboardType(.decimalPad)
                    .disabled(receipts.count > 1)
                    .onChange(of: totalAmountText) { _, _ in
                        if isProgrammaticTotalUpdate { isProgrammaticTotalUpdate = false }
                        else { totalManuallyEdited = true }
                        if receipts.count == 1 { receipts[0].result.totalAmount = totalAmount }
                        if splitMode == .equal { recalcEqual() }
                        if splitMode == .percentage { recalcPercentage() }
                    }
            }
            Divider().padding(.leading, 16)
            fieldRow(label: "หมายเหตุ", placeholder: "ไม่บังคับ") {
                TextField("", text: $note).font(.system(size: 15)).foregroundColor(Color.textPrimary)
            }
        }
        .sectionCard()
    }

    // MARK: – Split mode selector

    private var splitModeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("รูปแบบการหาร")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .padding(.horizontal, 16).padding(.top, 14)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SplitMode.allCases, id: \.self) { mode in
                        modeChip(mode)
                    }
                }
                .padding(.horizontal, 16)
            }

            // Description of current mode
            HStack(spacing: 8) {
                Image(systemName: splitMode.icon)
                    .font(.system(size: 12))
                    .foregroundColor(Color.brand500)
                Text(splitMode.description)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
            }
            .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    private func modeChip(_ mode: SplitMode) -> some View {
        let active = splitMode == mode
        return Button {
            hapticLight()
            withAnimation(.spring(response: 0.25)) {
                splitMode = mode
                if mode == .equal { recalcEqual() }
                if mode == .percentage { normalizePercentages() }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: mode.icon).font(.system(size: 12))
                Text(mode.label).font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .foregroundColor(active ? .white : Color.textSecondary)
            .background(active ? Color.brand500 : Color.surface)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(active ? Color.brand500 : Color.border, lineWidth: 1))
        }
    }

    // MARK: – Participants

    private var participantsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("ผู้เข้าร่วม (\(participants.count) คน)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.textSecondary)
                Spacer()
                if splitMode == .equal && participants.count >= 2 {
                    Button {
                        hapticLight(); recalcEqual()
                    } label: {
                        Label("หารใหม่", systemImage: "arrow.clockwise")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.brand500)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)

            ForEach($participants) { $p in
                participantRow($p)
                if p.id != participants.last?.id { Divider().padding(.leading, 56) }
            }

            Button {
                hapticLight(); showAddParticipant = true
            } label: {
                HStack(spacing: 8) {
                    ZStack {
                        Circle().fill(Color.brand500.opacity(0.12)).frame(width: 32, height: 32)
                        Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.brand500)
                    }
                    Text("เพิ่มผู้เข้าร่วม")
                        .font(.system(size: 14, weight: .medium)).foregroundColor(Color.brand500)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    @ViewBuilder
    private func participantRow(_ p: Binding<DraftParticipant>) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.brand500.opacity(0.12)).frame(width: 36, height: 36)
                Text(String(p.name.wrappedValue.prefix(1)))
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.brand500)
            }

            Text(p.name.wrappedValue)
                .font(.system(size: 14)).foregroundColor(Color.textPrimary)

            Spacer()

            if usesPerReceiptSplit {
                // Each bill sets its own mode (see scannedReceiptsCard) —
                // here we only show the combined result across all of them.
                Text(fmtTHB(displayAmount(for: p.wrappedValue), decimals: 2))
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            } else {
                switch splitMode {
                case .equal:
                    Text(fmtTHB(displayAmount(for: p.wrappedValue), decimals: 2))
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)

                case .custom:
                    SplitAmountField("จำนวนเงิน", value: p.amount)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.brand500)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)

                case .percentage:
                    HStack(spacing: 4) {
                        SplitAmountField("สัดส่วน", value: p.percentage)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color.brand500)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 50)
                            .onChange(of: p.percentage.wrappedValue) { _, _ in recalcPercentage() }
                        Text("%").font(.system(size: 13)).foregroundColor(Color.textSecondary)
                        Text("=").font(.system(size: 11)).foregroundColor(Color.textSecondary)
                        Text(fmtTHB(displayAmount(for: p.wrappedValue), decimals: 2))
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(Color.textPrimary)
                    }

                case .item:
                    Text(fmtTHB(displayAmount(for: p.wrappedValue), decimals: 2))
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                }
            }

            Button {
                let removedID = p.wrappedValue.id
                for index in draftItems.indices { draftItems[index].assignedTo.removeAll { $0 == removedID } }
                participants.removeAll { $0.id == removedID }
                for index in receipts.indices {
                    receipts[index].customAmounts.removeValue(forKey: removedID)
                    receipts[index].percentages.removeValue(forKey: removedID)
                    if receipts[index].splitMode == .percentage { normalizeReceiptPercentages($receipts[index]) }
                }
                if splitMode == .equal { recalcEqual() }
                if splitMode == .percentage { normalizePercentages() }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18)).foregroundColor(Color.textSecondary.opacity(0.4))
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    // MARK: – Items (for .item mode)

    private var itemsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("รายการสินค้า/บริการ")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                Spacer()
                Text("รวม \(fmtTHB(draftItems.reduce(0) { $0 + $1.price }))")
                    .font(.system(size: 12)).foregroundColor(Color.brand500)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)

            ForEach(draftItems.indices, id: \.self) { idx in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(draftItems[idx].name)
                            .font(.system(size: 14)).foregroundColor(Color.textPrimary)
                        Spacer()
                        Text(fmtTHB(draftItems[idx].price))
                            .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                        Button { draftItems.remove(at: idx) } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16)).foregroundColor(Color.textSecondary.opacity(0.4))
                        }
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(participants) { p in
                                let assigned = draftItems[idx].assignedTo.contains(p.id)
                                Button {
                                    if assigned {
                                        draftItems[idx].assignedTo.removeAll { $0 == p.id }
                                    } else {
                                        draftItems[idx].assignedTo.append(p.id)
                                    }
                                } label: {
                                    Text(p.name)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(assigned ? .white : Color.textSecondary)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(assigned ? Color.brand500 : Color.border.opacity(0.5))
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                if idx < draftItems.count - 1 { Divider().padding(.leading, 16) }
            }

            Button {
                hapticLight(); showAddItem = true
            } label: {
                HStack(spacing: 8) {
                    ZStack {
                        Circle().fill(Color.brand500.opacity(0.12)).frame(width: 32, height: 32)
                        Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.brand500)
                    }
                    Text("เพิ่มรายการ")
                        .font(.system(size: 14, weight: .medium)).foregroundColor(Color.brand500)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
        .sheet(isPresented: $showAddItem) {
            AddItemSheet { name, price in
                draftItems.append(DraftItem(name: name, price: price, assignedTo: []))
            }
        }
    }

    // MARK: – Summary

    private var summaryCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("ยอดรวม").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                Text(fmtTHB(totalAmount)).font(.system(size: 16, weight: .bold)).foregroundColor(Color.textPrimary)
            }
            Spacer()
            VStack(alignment: .center, spacing: 4) {
                Text("รูปแบบ").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                Text(usesPerReceiptSplit ? "แยกตามบิล (\(receipts.count))" : splitMode.label)
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("แบ่งแล้ว").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                let diff = totalAmount - assignedTotal
                Text(fmtTHB(assignedTotal))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(abs(diff) < 0.01 ? Color.statusApproved : .red)
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    // MARK: – Save button

    private var saveButton: some View {
        Button { hapticLight(); save() } label: {
            Group {
                if isSaving { ProgressView().tint(.white) }
                else {
                    Text("บันทึกรายการหารบิล")
                        .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 16)
        }
        .background(Color.brand500)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .disabled(isSaving)
    }

    // MARK: – Computations

    private func amountFor(_ p: DraftParticipant) -> Double {
        totalAmount * (p.percentage / 100.0)
    }

    /// Manual bills use the entered grand total with the same allocation rule.
    private func itemAmountFor(_ p: DraftParticipant) -> Double {
        let subtotal = draftItems.filter { $0.isIncluded && $0.assignedTo.contains(p.id) }
            .reduce(0) { $0 + $1.price / Double(max(1, $1.assignedTo.count)) }
        return SplitBillAmounts.itemShare(subtotal: subtotal,
            itemsSubtotal: draftItems.filter(\.isIncluded).reduce(0) { $0 + $1.price }, total: totalAmount)
    }

    private func recalcEqual() {
        let shares = SplitBillAmounts.equalShares(total: totalAmount, count: participants.count)
        guard shares.count == participants.count else { return }
        for i in participants.indices { participants[i].amount = shares[i] }
    }

    private func recalcPercentage() {
        let totalPct = participants.reduce(0) { $0 + $1.percentage }
        guard totalPct > 0 else { return }
        for i in participants.indices {
            participants[i].amount = totalAmount * (participants[i].percentage / totalPct)
        }
    }

    private func normalizePercentages() {
        guard !participants.isEmpty else { return }
        let each = 100.0 / Double(participants.count)
        for i in participants.indices { participants[i].percentage = each }
        recalcPercentage()
    }

    private func effectiveAmounts() -> [(name: String, amount: Double)] {
        let raw: [(name: String, amount: Double)]
        if usesPerReceiptSplit {
            raw = participants.map { ($0.name, aggregatedAmount(for: $0)) }
        } else {
            switch splitMode {
            case .equal:
                let shares = SplitBillAmounts.equalShares(total: totalAmount, count: participants.count)
                raw = participants.indices.map { (participants[$0].name, shares[$0]) }
            case .custom: raw = participants.map { ($0.name, $0.amount) }
            case .percentage: raw = participants.map { ($0.name, amountFor($0)) }
            case .item: raw = participants.map { ($0.name, itemAmountFor($0)) }
            }
        }
        guard let rounded = SplitBillAmounts.roundedShares(raw.map(\.amount), total: totalAmount) else { return raw }
        return raw.indices.map { (raw[$0].name, rounded[$0]) }
    }

    private func displayAmount(for participant: DraftParticipant) -> Double {
        guard let index = participants.firstIndex(where: { $0.id == participant.id }) else { return 0 }
        return effectiveAmounts()[index].amount
    }

    // MARK: – Field helpers

    private func fieldRow<Content: View>(label: String, placeholder: String,
                                         @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                .frame(width: 110, alignment: .leading)
            content()
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }

    private func advanceOrSave() {
        validationError = nil
        switch createStep {
        case .details:
            guard validateDetails() else { return }
            withAnimation(.spring(response: 0.25)) { createStep = .friends }
        case .friends:
            guard validateFriends() else { return }
            withAnimation(.spring(response: 0.25)) { createStep = .review }
        case .review:
            save()
        }
    }

    private func validateDetails() -> Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else {
            validationError = "กรุณาใส่ชื่อบิล"
            return false
        }
        let sourceTotal = usesPerReceiptSplit ? receiptsTotal : enteredAmount
        guard sourceTotal.isFinite, sourceTotal > 0 || draftItems.contains(where: { $0.price > 0 }) else {
            validationError = "กรุณาใส่ยอดรวมที่ถูกต้อง"
            return false
        }
        return true
    }

    private func validateFriends() -> Bool {
        guard hasValidTaxConfiguration else {
            validationError = "กรุณาระบุอัตรา VAT ให้ถูกต้อง หรือเลือกใช้ยอดสุทธิจากใบเสร็จ"
            return false
        }
        guard totalAmount.isFinite, totalAmount > 0, hasCompleteAssignments else {
            validationError = "กรุณาเลือกรายการและกำหนดผู้ร่วมจ่ายให้ครบทุกรายการที่นำมาหาร"
            return false
        }
        guard !participants.isEmpty else {
            validationError = "กรุณาเพิ่มผู้เข้าร่วมอย่างน้อย 1 คน"
            return false
        }
        guard hasBalancedReceipts else {
            validationError = "ยอดแบ่งของแต่ละใบเสร็จไม่ตรง กรุณาตรวจสอบทุกใบแยกกัน"
            return false
        }
        let amounts = effectiveAmounts().map(\.amount)
        guard amounts.allSatisfy({ $0.isFinite && $0 >= 0 }),
              abs(amounts.reduce(0, +) - totalAmount) < 0.005 else {
            validationError = "ยอดแบ่งของผู้ร่วมบิลไม่ตรงกับยอดรวม กรุณาตรวจสอบจำนวนเงินและรายการที่เลือก"
            return false
        }
        return true
    }

    private var persistedNote: String? {
        var lines: [String] = []
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNote.isEmpty { lines.append(trimmedNote) }

        lines.append("วันที่และเวลา: \(splitDateLabel)")
        lines.append("หมวดหมู่: \(category?.rawValue ?? "ไม่ระบุ")")
        lines.append("วิธีหารบิล: \(splitDescription)")
        if usesPerReceiptSplit {
            for receipt in receipts {
                lines.append("VAT \(receipt.result.vendorName ?? "ใบเสร็จ"): \(receipt.vatMode.title)\(receipt.vatMode.needsRate ? " (\(receipt.vatRateText)%)" : "")")
            }
        } else {
            lines.append("VAT: \(manualVATMode.title)\(manualVATMode.needsRate ? " (\(manualVATRate)%)" : "")")
        }
        if !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("สถานที่: \(location.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
        if !draftItems.isEmpty {
            lines.append("รายการที่นำมาหาร:")
            for item in draftItems where item.isIncluded {
                let mode = item.sourceReceiptId.flatMap { id in receipts.first { $0.id == id }?.splitMode } ?? splitMode
                let names = participants.filter { item.assignedTo.contains($0.id) }.map(\.name)
                let allocation = mode == .item ? names.joined(separator: ", ") : mode.label
                lines.append("\(item.name) · \(fmtTHB(item.price, decimals: 2)) · \(allocation)")
            }
        }
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }

    private var splitDescription: String {
        guard usesPerReceiptSplit else { return splitMode.label }
        if Set(receipts.map(\.splitMode)).count == 1 { return receipts[0].splitMode.label }
        return "แยกวิธีตามใบเสร็จ"
    }

    // MARK: – Save

    private func save() {
        validationError = nil
        guard validateDetails(), validateFriends() else { return }

        let amounts = effectiveAmounts()
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                guard let orgId = authVM.org?.id, let userId = authVM.session?.user.id.uuidString else { return }
                let shareToken = try await vm.createBill(
                    orgId: orgId, userId: userId,
                    title: title.trimmingCharacters(in: .whitespaces),
                    totalAmount: totalAmount,
                    note: persistedNote,
                    documentID: receipts.compactMap(\.sourceDocumentID).first,
                    participants: amounts.map { ($0.name, $0.amount) }
                )
                hapticSuccess()
                await vm.load(orgId: orgId)
                if let token = shareToken {
                    createdShareToken = token
                    showShareSheet = true
                } else {
                    dismiss()
                }
            } catch { validationError = error.localizedDescription }
        }
    }
}

// MARK: – Add Participant Sheet

#if DEBUG
extension CreateSplitView {
    static func redesignPreview(vm: SplitViewModel, step: CreateSplitStep) -> CreateSplitView {
        let result = SlipExtraction(vendorName: "มื้ออาหารร่วมกัน", totalAmount: 214,
            lineItems: [LineItem(name: "อาหารจานหลัก", amount: 100),
                        LineItem(name: "เครื่องดื่ม", amount: 20),
                        LineItem(name: "เครื่องดื่ม", amount: 20),
                        LineItem(name: "ของหวาน", amount: 20),
                        LineItem(name: "อาหารทานเล่น", amount: 20),
                        LineItem(name: "รายการสุดท้าย", amount: 20)], confidence: 1)
        var view = CreateSplitView(vm: vm)
        let receipt = ScannedReceipt(result: result, image: nil, splitMode: .item)
        view._receipts = State(initialValue: [receipt])
        view._draftItems = State(initialValue: result.lineItems.map {
            DraftItem(name: $0.name, price: $0.amount, assignedTo: [], sourceReceiptId: receipt.id)
        })
        view._participants = State(initialValue: ["คุณเอ", "คุณบี", "เพื่อนที่มีชื่อยาวสำหรับตรวจข้อความ"].map {
            DraftParticipant(name: $0, amount: 0, percentage: 0, items: [])
        })
        view._title = State(initialValue: result.vendorName!)
        view._totalAmountText = State(initialValue: "214.00")
        view._createStep = State(initialValue: step)
        return view
    }
}
#endif

private struct SplitAmountField: View {
    let placeholder: String
    @Binding var value: Double
    @State private var text: String
    @FocusState private var focused: Bool

    init(_ placeholder: String, value: Binding<Double>) {
        self.placeholder = placeholder
        _value = value
        _text = State(initialValue: value.wrappedValue == 0 ? "" : String(format: "%.2f", value.wrappedValue))
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(.decimalPad)
            .focused($focused)
            .accessibilityLabel(placeholder)
            .onChange(of: text) { _, input in
                let cleaned = input.replacingOccurrences(of: ",", with: "")
                value = cleaned.isEmpty ? 0 : Double(cleaned) ?? .nan
            }
            .onChange(of: value) { _, updated in
                guard !focused else { return }
                text = updated == 0 || !updated.isFinite ? "" : String(format: "%.2f", updated)
            }
    }
}

struct AddParticipantSheet: View {
    let onAdd: (String, Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amountText = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                VStack(spacing: 16) {
                    VStack(spacing: 0) {
                        HStack {
                            Text("ชื่อ")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                                .frame(width: 80, alignment: .leading)
                            TextField("ชื่อผู้เข้าร่วม", text: $name)
                                .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        Divider().padding(.leading, 16)
                        HStack {
                            Text("จำนวน (฿)")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                                .frame(width: 80, alignment: .leading)
                            TextField("จำนวนเงิน (ไม่บังคับ)", text: $amountText)
                                .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                                .keyboardType(.decimalPad)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                    }
                    .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 14))
                    .shadow(color: .black.opacity(0.05), radius: 6, y: 2)

                    if let err = error {
                        Text(err).font(.system(size: 13)).foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        let trimmed = name.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty else { error = "กรุณาใส่ชื่อ"; return }
                        let amount = Double(amountText.replacingOccurrences(of: ",", with: "")) ?? 0
                        onAdd(trimmed, amount)
                        dismiss()
                    } label: {
                        Text("เพิ่มผู้เข้าร่วม")
                            .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 16)
                            .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("เพิ่มผู้เข้าร่วม").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) {
                Button("ยกเลิก") { dismiss() }.foregroundColor(Color.textSecondary)
            }}
        }
        .presentationDetents([.medium])
    }
}

// MARK: – Add Item Sheet

struct AddItemSheet: View {
    let onAdd: (String, Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var priceText = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                VStack(spacing: 16) {
                    VStack(spacing: 0) {
                        HStack {
                            Text("ชื่อรายการ")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                                .frame(width: 90, alignment: .leading)
                            TextField("ระบุชื่อรายการ", text: $name)
                                .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        Divider().padding(.leading, 16)
                        HStack {
                            Text("ราคา (฿)")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                                .frame(width: 90, alignment: .leading)
                            TextField("ระบุราคารายการ", text: $priceText)
                                .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                                .keyboardType(.decimalPad)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                    }
                    .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 14))
                    .shadow(color: .black.opacity(0.05), radius: 6, y: 2)

                    Button {
                        let trimmed = name.trimmingCharacters(in: .whitespaces)
                        let price = Double(priceText.replacingOccurrences(of: ",", with: "")) ?? 0
                        guard !trimmed.isEmpty, price > 0 else { return }
                        onAdd(trimmed, price)
                        dismiss()
                    } label: {
                        Text("เพิ่มรายการ")
                            .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 16)
                            .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("เพิ่มรายการ").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) {
                Button("ยกเลิก") { dismiss() }.foregroundColor(Color.textSecondary)
            }}
        }
        .presentationDetents([.medium])
    }
}

// MARK: – Image Review Sheet (confirm + rotate before OCR)

/// Shown after picking photo(s) — lets the user view each one full-size
/// (gallery thumbnails are too small to tell receipts apart reliably),
/// rotate any that came in sideways/upside-down, drop ones they didn't mean
/// to pick, and only then send the confirmed set on to OCR.
struct ImageReviewSheet: View {
    @State var images: [UIImage]
    let onConfirm: ([UIImage]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedIndex = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if images.indices.contains(selectedIndex) {
                    Image(uiImage: images[selectedIndex])
                        .resizable()
                        .scaledToFit()
                        .cornerRadius(16)
                        .padding(.horizontal, 20)
                        .shadow(color: .black.opacity(0.1), radius: 12, x: 0, y: 4)
                } else {
                    Spacer()
                    Text("ไม่มีรูปเหลือแล้ว").foregroundColor(Color.textSecondary)
                    Spacer()
                }

                HStack(spacing: 16) {
                    reviewButton(icon: "rotate.left")  { rotate(by: -90) }
                    reviewButton(icon: "rotate.right") { rotate(by: 90) }
                    reviewButton(icon: "trash", tint: .red) { removeCurrent() }
                }

                if images.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(images.indices, id: \.self) { i in
                                Image(uiImage: images[i])
                                    .resizable().scaledToFill()
                                    .frame(width: 56, height: 72)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8)
                                        .stroke(i == selectedIndex ? Color.brand500 : Color.clear, lineWidth: 2))
                                    .onTapGesture { selectedIndex = i }
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }

                Spacer()

                Button {
                    hapticSuccess()
                    onConfirm(images)
                    dismiss()
                } label: {
                    Text(images.isEmpty ? "ไม่มีรูปให้ใช้" : "ใช้รูปนี้ (\(images.count))")
                        .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(images.isEmpty ? Color.gray : Color.brand500)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(images.isEmpty)
                .padding(.horizontal, 20)
            }
            .padding(.top, 16).padding(.bottom, 20)
            .navigationTitle("ตรวจสอบรูปก่อนสแกน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("ยกเลิก") { dismiss() }.foregroundColor(Color.textSecondary)
                }
            }
        }
    }

    private func rotate(by degrees: CGFloat) {
        guard images.indices.contains(selectedIndex) else { return }
        hapticLight()
        images[selectedIndex] = images[selectedIndex].rotated(by: degrees)
    }

    private func removeCurrent() {
        guard images.indices.contains(selectedIndex) else { return }
        hapticMedium()
        images.remove(at: selectedIndex)
        selectedIndex = min(selectedIndex, max(0, images.count - 1))
    }

    private func reviewButton(icon: String, tint: Color = Color.brand500, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: 44, height: 44)
                .background(tint.opacity(0.1))
                .clipShape(Circle())
        }
        .disabled(images.isEmpty)
    }
}

// MARK: – Camera Image Picker

/// Camera capture wrapper.
///
/// Dismissal goes through SwiftUI's `@Environment(\.dismiss)` — NOT
/// `picker.dismiss()`. Both call sites present this via `.sheet` /
/// `.fullScreenCover(isPresented:)`, so dismissing the UIKit controller
/// imperatively would tear down the presentation while leaving the `isPresented`
/// binding stuck `true`. That desync made the camera re-present after capture,
/// and pairing it with a manual `binding = false` fired *two* dismissals for one
/// presentation — SwiftUI then dismissed the parent sheet too, so the whole
/// add-document screen vanished on "Use Photo". One binding-driven dismissal
/// keeps UIKit and SwiftUI in agreement.
struct CameraImagePicker: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismissAction
    let onImage: (UIImage) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let vc = UIImagePickerController()
        vc.sourceType = .camera
        vc.delegate = context.coordinator
        context.coordinator.dismiss = { dismissAction() }
        return vc
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {
        // Keep the closure bound to the current environment.
        context.coordinator.dismiss = { dismissAction() }
    }

    class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let onImage: (UIImage) -> Void
        var dismiss: () -> Void = {}
        init(onImage: @escaping (UIImage) -> Void) { self.onImage = onImage }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let img = info[.editedImage] as? UIImage ?? info[.originalImage] as? UIImage
            dismiss()
            if let img { onImage(img) }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}

// MARK: – Share Bill Sheet

struct ShareBillSheet: View {
    let shareToken: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    private var joinURL: String { Config.webAppURL.appendingPathComponent("split/join/\(shareToken)").absoluteString }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                VStack(spacing: 24) {
                    ZStack {
                        Circle().fill(Color.brand500.opacity(0.12)).frame(width: 72, height: 72)
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 36)).foregroundColor(Color.brand500)
                    }
                    VStack(spacing: 6) {
                        Text("สร้างบิลเรียบร้อย! 🎉")
                            .font(.system(size: 20, weight: .bold)).foregroundColor(Color.textPrimary)
                        Text("แชร์ลิงก์นี้ให้ผู้เข้าร่วมกดยืนยัน")
                            .font(.system(size: 14)).foregroundColor(Color.textSecondary)
                    }
                    HStack(spacing: 10) {
                        Text(joinURL)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Color.textPrimary).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            UIPasteboard.general.string = joinURL
                            hapticSuccess(); copied = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                        } label: {
                            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(copied ? .green : Color.brand500)
                        }
                    }
                    .padding(12).background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border, lineWidth: 1))

                    Button {
                        let av = UIActivityViewController(activityItems: [joinURL], applicationActivities: nil)
                        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                           let vc = scene.windows.first?.rootViewController {
                            vc.present(av, animated: true)
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "square.and.arrow.up"); Text("แชร์ลิงก์")
                        }
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    Button("เสร็จแล้ว") { dismiss() }
                        .font(.system(size: 15, weight: .medium)).foregroundColor(Color.textSecondary)
                }
                .padding(24)
            }
            .navigationTitle("แชร์บิล").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("เสร็จ") { dismiss() }
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(Color.brand500)
                }
            }
        }
    }
}
