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
}

enum CreateSplitStep: Int, CaseIterable {
    case details = 1
    case friends = 2
    case review = 3

    var title: String {
        switch self {
        case .details: return "รายละเอียด"
        case .friends: return "เลือกเพื่อน"
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
        case .other: return Color(hex: "#64748b")
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
    /// Each bill has its own split pattern — only summed together across all
    /// receipts at the end (see CreateSplitView.aggregatedAmount).
    var splitMode: SplitMode = .equal
    var customAmounts: [UUID: Double] = [:]   // participant.id -> amount, .custom mode
    var percentages: [UUID: Double] = [:]     // participant.id -> percent, .percentage mode
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
    @State private var category: SplitBillCategory = .food

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

    var totalAmount: Double { Double(totalAmountText.replacingOccurrences(of: ",", with: "")) ?? 0 }

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
                            colors: [Color.white.opacity(0), Color(hex: "#fbfaff")],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .ignoresSafeArea()
                    )
                }
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showAddParticipant) {
                AddParticipantSheet { name, amount in
                    let pct = participants.isEmpty ? 100.0 : 0.0
                    participants.append(DraftParticipant(name: name, amount: amount, percentage: pct, items: []))
                    if splitMode == .equal { recalcEqual() }
                    if splitMode == .percentage { normalizePercentages() }
                }
            }
            .sheet(isPresented: $showAddItem) {
                AddItemSheet { name, price in
                    draftItems.append(DraftItem(name: name, price: price, assignedTo: []))
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
                Color(hex: "#fbfaff"),
                Color(hex: "#f6f3ff"),
                Color(hex: "#ffffff")
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
                    .foregroundColor(Color(hex: "#15164f"))
                    .frame(width: 44, height: 44)
            }

            Spacer()

            VStack(spacing: 2) {
                Text("สร้างการหารบิล")
                    .font(.system(size: 24, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#15164f"))
                Text("สร้างบิลใหม่ในไม่กี่ขั้นตอน")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color(hex: "#9aa0bf"))
            }

            Spacer()

            Button {
                hapticLight()
                save()
            } label: {
                Text("บันทึก")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color.brand500)
                    .frame(width: 44, height: 44)
            }
            .disabled(isSaving)
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
                            .fill(step.rawValue <= createStep.rawValue ? Color.brand500 : Color(hex: "#d8d8e8"))
                            .frame(width: 40, height: 40)
                        Text("\(step.rawValue)")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(.white)
                    }
                    Text(step.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(step == createStep ? Color.brand500 : Color(hex: "#9aa0bf"))
                }
                .frame(maxWidth: .infinity)
                .overlay(alignment: .topTrailing) {
                    if step != CreateSplitStep.allCases.last {
                        Rectangle()
                            .fill(Color(hex: "#dcddec"))
                            .frame(height: 2)
                            .offset(x: 44, y: 19)
                    }
                }
            }
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
                if !usesPerReceiptSplit {
                    splitModeCard
                }
                if !usesPerReceiptSplit && splitMode == .item {
                    itemsCard
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
                        .font(.system(size: 18, weight: .bold))
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
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .shadow(color: Color.brand500.opacity(0.32), radius: 16, x: 0, y: 10)
        }
        .disabled(isSaving)
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
            HStack(spacing: 6) {
                ForEach(SplitMode.allCases, id: \.self) { mode in
                    let active = receipt.wrappedValue.splitMode == mode
                    Button {
                        hapticLight()
                        withAnimation(.spring(response: 0.25)) {
                            receipt.wrappedValue.splitMode = mode
                            if mode == .percentage && receipt.wrappedValue.percentages.isEmpty {
                                normalizeReceiptPercentages(receipt)
                            }
                        }
                    } label: {
                        Image(systemName: mode.icon).font(.system(size: 12))
                            .foregroundColor(active ? .white : Color.textSecondary)
                            .frame(width: 30, height: 30)
                            .background(active ? Color.brand500 : Color.border.opacity(0.5))
                            .clipShape(Circle())
                    }
                }
                Spacer()
            }

            ForEach(participants) { p in
                HStack {
                    Text(p.name).font(.system(size: 13)).foregroundColor(Color.textPrimary)
                    Spacer()
                    switch receipt.wrappedValue.splitMode {
                    case .equal:
                        Text(fmtTHB(amount(for: p, in: receipt.wrappedValue)))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)

                    case .custom:
                        TextField("฿", value: Binding(
                            get: { receipt.wrappedValue.customAmounts[p.id] ?? 0 },
                            set: { receipt.wrappedValue.customAmounts[p.id] = $0 }
                        ), format: .number.precision(.fractionLength(2)))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .frame(width: 80)

                    case .percentage:
                        HStack(spacing: 4) {
                            TextField("0", value: Binding(
                                get: { receipt.wrappedValue.percentages[p.id] ?? 0 },
                                set: { receipt.wrappedValue.percentages[p.id] = $0 }
                            ), format: .number.precision(.fractionLength(1)))
                                .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.brand500)
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                .frame(width: 44)
                            Text("%").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                        }

                    case .item:
                        let items = draftItems.indices.filter { draftItems[$0].sourceReceiptId == receipt.wrappedValue.id }
                        Text(fmtTHB(itemAmountFor(p, itemIndices: items)))
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(Color.textSecondary)
                    }
                }
            }

            if receipt.wrappedValue.splitMode == .item {
                receiptItemsList(receipt)
            }

            let diff = (receipt.wrappedValue.result.totalAmount ?? 0)
                - participants.reduce(0) { $0 + amount(for: $1, in: receipt.wrappedValue) }
            if participants.count > 1 {
                Text(abs(diff) < 0.01 ? "แบ่งครบยอดแล้ว ✓" : "เหลือ \(fmtTHB(diff)) ยังไม่ได้แบ่ง")
                    .font(.system(size: 11)).foregroundColor(abs(diff) < 0.01 ? Color.statusApproved : .orange)
            }
        }
    }

    private func receiptItemsList(_ receipt: Binding<ScannedReceipt>) -> some View {
        let indices = draftItems.indices.filter { draftItems[$0].sourceReceiptId == receipt.wrappedValue.id }
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(indices, id: \.self) { idx in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(draftItems[idx].name).font(.system(size: 12)).foregroundColor(Color.textPrimary)
                        Spacer()
                        Text(fmtTHB(draftItems[idx].price)).font(.system(size: 12, weight: .semibold)).foregroundColor(Color.textPrimary)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(participants) { p in
                                let assigned = draftItems[idx].assignedTo.contains(p.id)
                                Button {
                                    if assigned { draftItems[idx].assignedTo.removeAll { $0 == p.id } }
                                    else { draftItems[idx].assignedTo.append(p.id) }
                                } label: {
                                    Text(p.name)
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundColor(assigned ? .white : Color.textSecondary)
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .background(assigned ? Color.brand500 : Color.border.opacity(0.5))
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func normalizeReceiptPercentages(_ receipt: Binding<ScannedReceipt>) {
        guard !participants.isEmpty else { return }
        let each = 100.0 / Double(participants.count)
        for p in participants { receipt.wrappedValue.percentages[p.id] = each }
    }

    /// One participant's share of one receipt, in that receipt's own mode.
    private func amount(for participant: DraftParticipant, in receipt: ScannedReceipt) -> Double {
        let total = receipt.result.totalAmount ?? 0
        switch receipt.splitMode {
        case .equal:
            return participants.isEmpty ? 0 : total / Double(participants.count)
        case .custom:
            return receipt.customAmounts[participant.id] ?? 0
        case .percentage:
            return total * (receipt.percentages[participant.id] ?? 0) / 100.0
        case .item:
            return itemModeAmount(for: participant.id, in: receipt)
        }
    }

    /// A participant's share of one receipt under "ตามรายการ" (item) mode —
    /// their assigned line items' subtotal PLUS their proportional share of
    /// that receipt's VAT, so the final split total actually matches what
    /// the group paid (subtotal + VAT), not just the pre-tax item prices.
    /// Falls back to Config.defaultVatRatePct when the receipt itself has no
    /// extracted VAT (e.g. manually-typed items with no real receipt behind
    /// them) — see Config.swift for why this lives in one central place.
    private func itemModeAmount(for participantId: UUID, in receipt: ScannedReceipt) -> Double {
        let items = draftItems.filter { $0.sourceReceiptId == receipt.id }
        let participantSubtotal = items.filter { $0.assignedTo.contains(participantId) }
            .reduce(0) { $0 + $1.price / Double(max(1, $1.assignedTo.count)) }
        guard participantSubtotal > 0 else { return 0 }

        if let vat = receipt.result.vatAmount, vat > 0 {
            let allItemsSubtotal = items.reduce(0) { $0 + $1.price }
            let vatShare = allItemsSubtotal > 0 ? (participantSubtotal / allItemsSubtotal) * vat : 0
            return participantSubtotal + vatShare
        }
        return participantSubtotal * (1 + Config.defaultVatRatePct / 100)
    }

    /// Same as itemAmountFor(_:) but scoped to one receipt's items only —
    /// the global one sums across ALL items regardless of receipt.
    private func itemAmountFor(_ p: DraftParticipant, itemIndices: [Int]) -> Double {
        itemIndices.map { draftItems[$0] }
            .filter { $0.assignedTo.contains(p.id) }
            .reduce(0) { $0 + $1.price / Double(max(1, $1.assignedTo.count)) }
    }

    /// A participant's combined total across every scanned receipt — this is
    /// what actually gets saved once any bills have been scanned.
    private func aggregatedAmount(for participant: DraftParticipant) -> Double {
        receipts.reduce(0) { $0 + amount(for: participant, in: $1) }
    }

    private func scanTag(icon: String, value: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundColor(Color.brand500)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(Color.textPrimary)
                .lineLimit(1)
        }
    }

    // MARK: – OCR scan

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
            for item in newItems {
                if !draftItems.contains(where: { $0.name == item.name }) {
                    draftItems.append(item)
                }
            }
        }

        recomputeTotalFromReceipts()
        hapticSuccess()
    }

    /// Combined total across every scanned receipt.
    private var receiptsTotal: Double {
        receipts.reduce(0) { $0 + ($1.result.totalAmount ?? 0) }
    }

    /// Refreshes ยอดรวม to match the sum of all scanned receipts — skipped
    /// once the user has typed into that field themselves, so we don't
    /// stomp on a deliberate manual override.
    private func recomputeTotalFromReceipts() {
        guard !totalManuallyEdited, !receipts.isEmpty else { return }
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
            if !draftItems.contains(where: { $0.name == item.name && $0.sourceReceiptId == receiptId }) {
                draftItems.append(DraftItem(name: item.name, price: item.amount, assignedTo: [], sourceReceiptId: receiptId))
            }
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
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#15164f"))
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 10)

            detailInputRow(
                icon: "receipt.fill",
                tint: Color.brand500,
                label: "ชื่อบิล",
                trailing: title.isEmpty ? nil : "xmark.circle.fill"
            ) {
                TextField("Dinner Chinatown", text: $title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(Color(hex: "#15164f"))
            } trailingAction: {
                title = ""
            }

            Divider().padding(.leading, 108)

            detailInputRow(icon: "calendar", tint: Color(hex: "#ec4899"), label: "วันที่และเวลา") {
                HStack(spacing: 12) {
                    DatePicker("", selection: $billDate, displayedComponents: .date)
                        .labelsHidden()
                    Text("·")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color(hex: "#9aa0bf"))
                    DatePicker("", selection: $billDate, displayedComponents: .hourAndMinute)
                        .labelsHidden()
                }
            }

            Divider().padding(.leading, 108)

            detailInputRow(icon: "mappin.circle.fill", tint: Color(hex: "#3b9df4"), label: "สถานที่") {
                TextField("China Town Bangkok", text: $location)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(Color(hex: "#15164f"))
            }

            Divider().padding(.leading, 108)

            detailInputRow(icon: "clipboard.fill", tint: Color(hex: "#fb923c"), label: "โน้ต (ไม่บังคับ)") {
                TextField("เพิ่มโน้ตหรือรายละเอียดเพิ่มเติม...", text: $note)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color(hex: "#15164f"))
            }
        }
        .background(Color.white.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color(hex: "#4f46e5").opacity(0.06), radius: 20, x: 0, y: 10)
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ยอดรวมของบิล")
                .font(.system(size: 17, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#15164f"))

            HStack(spacing: 12) {
                TextField("2,850.00", text: $totalAmountText)
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#15164f"))
                    .keyboardType(.decimalPad)
                    .onChange(of: totalAmountText) { _, _ in
                        if isProgrammaticTotalUpdate { isProgrammaticTotalUpdate = false }
                        else { totalManuallyEdited = true }
                        if splitMode == .equal { recalcEqual() }
                        if splitMode == .percentage { recalcPercentage() }
                    }
                Divider().frame(height: 42)
                Text("฿")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Color(hex: "#15164f"))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(Color.white)
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
                colors: [Color.white.opacity(0.98), Color(hex: "#f1ecff")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color(hex: "#4f46e5").opacity(0.06), radius: 20, x: 0, y: 10)
    }

    private var categoryAndModeRow: some View {
        HStack(spacing: 14) {
            menuSelectCard(label: "หมวดหมู่", value: category.rawValue, icon: category.icon, tint: category.tint) {
                ForEach(SplitBillCategory.allCases, id: \.self) { option in
                    Button(option.rawValue) { category = option }
                }
            }

            menuSelectCard(label: "ประเภทการจ่าย", value: splitMode.label, icon: splitMode.icon, tint: Color.brand500) {
                ForEach(SplitMode.allCases, id: \.self) { mode in
                    Button(mode.label) {
                        splitMode = mode
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
                    .font(.system(size: 18, weight: .black, design: .rounded))
                    .foregroundColor(Color(hex: "#15164f"))
                Text("(ไม่บังคับ)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color(hex: "#a0a3bd"))
                Spacer()
                Button {
                    hapticLight()
                    showAddItem = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                        Text("เพิ่มรายการ")
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(Color.brand500)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 8)

            if draftItems.isEmpty {
                Text("เพิ่มรายการอาหารหรือใช้ OCR จากใบเสร็จเพื่อให้เพื่อนเลือกจ่ายตามรายการได้")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 18)
            } else {
                ForEach(Array(draftItems.prefix(3).enumerated()), id: \.element.id) { offset, item in
                    compactItemRow(item)
                    if offset < min(draftItems.count, 3) - 1 {
                        Divider().padding(.leading, 90)
                    }
                }
                if draftItems.count > 3 {
                    Text("ดูทั้งหมด \(draftItems.count) รายการ")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color(hex: "#7b7fa0"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
            }
        }
        .background(Color.white.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color(hex: "#4f46e5").opacity(0.05), radius: 18, x: 0, y: 8)
    }

    private var reviewBillCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ตรวจสอบก่อนบันทึก")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#15164f"))
            reviewRow("ชื่อบิล", title.trimmingCharacters(in: .whitespaces).isEmpty ? "-" : title)
            reviewRow("วันที่", splitDateLabel)
            reviewRow("สถานที่", location.isEmpty ? "-" : location)
            reviewRow("หมวดหมู่", category.rawValue)
            reviewRow("ยอดรวม", fmtTHB(totalAmount, decimals: 2))
            reviewRow("ประเภทการจ่าย", usesPerReceiptSplit ? "แยกตามบิล (\(receipts.count))" : splitMode.label)
            reviewRow("รายการในบิล", "\(draftItems.count) รายการ")
        }
        .padding(20)
        .background(Color.white.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color(hex: "#4f46e5").opacity(0.05), radius: 18, x: 0, y: 8)
    }

    private func detailInputRow<Content: View>(
        icon: String,
        tint: Color,
        label: String,
        trailing: String? = "chevron.right",
        @ViewBuilder content: () -> Content,
        trailingAction: (() -> Void)? = nil
    ) -> some View {
        HStack(spacing: 18) {
            ZStack {
                Circle().fill(tint.opacity(0.14)).frame(width: 62, height: 62)
                Image(systemName: icon)
                    .font(.system(size: 25, weight: .bold))
                    .foregroundColor(tint)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(label)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color(hex: "#7b7fa0"))
                content()
            }

            Spacer(minLength: 8)

            if let trailing {
                Button {
                    trailingAction?()
                } label: {
                    Image(systemName: trailing)
                        .font(.system(size: trailing == "chevron.right" ? 18 : 20, weight: .bold))
                        .foregroundColor(Color(hex: "#a4a7c0"))
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
            VStack(alignment: .leading, spacing: 10) {
                Text(label)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color(hex: "#7b7fa0"))
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(tint.opacity(0.16)).frame(width: 42, height: 42)
                        Image(systemName: icon)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(tint)
                    }
                    Text(value)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(Color(hex: "#15164f"))
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color(hex: "#a4a7c0"))
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.white.opacity(0.96))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: "#ececf5"), lineWidth: 1))
        }
    }

    private func compactItemRow(_ item: DraftItem) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hex: "#fff7ed"))
                    .frame(width: 54, height: 54)
                Image(systemName: "fork.knife")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(Color(hex: "#fb923c"))
            }
            Text(item.name)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color(hex: "#15164f"))
                .lineLimit(1)
            Spacer()
            Text(fmtTHB(item.price, decimals: 2))
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(Color(hex: "#15164f"))
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
                .foregroundColor(Color(hex: "#15164f"))
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
                    .onChange(of: totalAmountText) { _, _ in
                        if isProgrammaticTotalUpdate { isProgrammaticTotalUpdate = false }
                        else { totalManuallyEdited = true }
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
                Text(fmtTHB(aggregatedAmount(for: p.wrappedValue)))
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            } else {
                switch splitMode {
                case .equal:
                    Text(fmtTHB(p.amount.wrappedValue))
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)

                case .custom:
                    TextField("฿", value: p.amount, format: .number.precision(.fractionLength(2)))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.brand500)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)

                case .percentage:
                    HStack(spacing: 4) {
                        TextField("0", value: p.percentage, format: .number.precision(.fractionLength(1)))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color.brand500)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 50)
                            .onChange(of: p.percentage.wrappedValue) { _, _ in recalcPercentage() }
                        Text("%").font(.system(size: 13)).foregroundColor(Color.textSecondary)
                        Text("=").font(.system(size: 11)).foregroundColor(Color.textSecondary)
                        Text(fmtTHB(amountFor(p.wrappedValue)))
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(Color.textPrimary)
                    }

                case .item:
                    Text(fmtTHB(itemAmountFor(p.wrappedValue)))
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                }
            }

            Button {
                participants.removeAll { $0.id == p.id }
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

    /// Manual-entry path (no scanned receipt behind it, so no extracted VAT
    /// to allocate proportionally) — apply the central default rate directly.
    private func itemAmountFor(_ p: DraftParticipant) -> Double {
        let subtotal = draftItems.filter { $0.assignedTo.contains(p.id) }
            .reduce(0) { $0 + $1.price / Double(max(1, $1.assignedTo.count)) }
        guard subtotal > 0 else { return 0 }
        return subtotal * (1 + Config.defaultVatRatePct / 100)
    }

    private func recalcEqual() {
        guard !participants.isEmpty, totalAmount > 0 else { return }
        let each = (totalAmount / Double(participants.count) * 100).rounded() / 100
        for i in participants.indices { participants[i].amount = each }
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
        guard !usesPerReceiptSplit else {
            return participants.map { ($0.name, aggregatedAmount(for: $0)) }
        }
        switch splitMode {
        case .equal:
            return participants.map { ($0.name, $0.amount) }
        case .custom:
            return participants.map { ($0.name, $0.amount) }
        case .percentage:
            return participants.map { ($0.name, amountFor($0)) }
        case .item:
            return participants.map { ($0.name, itemAmountFor($0)) }
        }
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
        guard totalAmount > 0 else {
            validationError = "กรุณาใส่ยอดรวมที่ถูกต้อง"
            return false
        }
        return true
    }

    private func validateFriends() -> Bool {
        guard !participants.isEmpty else {
            validationError = "กรุณาเพิ่มผู้เข้าร่วมอย่างน้อย 1 คน"
            return false
        }
        return true
    }

    private var persistedNote: String? {
        var lines: [String] = []
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNote.isEmpty { lines.append(trimmedNote) }

        lines.append("วันที่และเวลา: \(splitDateLabel)")
        lines.append("หมวดหมู่: \(category.rawValue)")
        lines.append("ประเภทการจ่าย: \(usesPerReceiptSplit ? "แยกตามบิล (\(receipts.count))" : splitMode.label)")
        if !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("สถานที่: \(location.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
        if !draftItems.isEmpty {
            lines.append("รายการในบิล: \(draftItems.map { "\($0.name) \(fmtTHB($0.price, decimals: 2))" }.joined(separator: ", "))")
        }
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
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
                            TextField("0 (เว้นว่างเพื่อหารเท่ากัน)", text: $amountText)
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
                            TextField("เช่น ข้าวผัด, เบียร์", text: $name)
                                .font(.system(size: 15)).foregroundColor(Color.textPrimary)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        Divider().padding(.leading, 16)
                        HStack {
                            Text("ราคา (฿)")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                                .frame(width: 90, alignment: .leading)
                            TextField("0.00", text: $priceText)
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
