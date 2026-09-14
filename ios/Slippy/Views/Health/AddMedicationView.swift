import SwiftUI

private let healthGreen = Color(hex: "#10b981")

struct AddMedicationView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @ObservedObject var vm: HealthViewModel
    @Environment(\.dismiss) private var dismiss

    /// Pre-fill from a scanned label — still just a starting point, every
    /// field below stays editable, and nothing is written until Save. Same
    /// role as web's AddMedicationModal `scanned` prop.
    var scanned: ScannedMedication? = nil
    var scanIssues: [String] = []

    /// Set to edit an existing medication in place, instead of creating one.
    /// Mutually exclusive with `scanned` — editing an existing row is never
    /// also a fresh scan review.
    var editing: Medication? = nil

    @State private var name: String
    @State private var brandName: String
    @State private var dosageForm: String
    @State private var strength: String
    @State private var purpose: String
    @State private var notes = ""
    @State private var selectedProvider: MedicalProvider?
    @State private var doctorName: String
    @State private var doctorInstructions: String
    @State private var locCode: String
    @State private var lotNo: String
    @State private var qtyPerPack: String
    @State private var alreadyTaken = ""
    @State private var showProviderPicker = false
    @State private var isSaving = false
    @State private var errorMsg: String?

    // Schedule + inventory — without these there is nothing for
    // HealthViewModel.syncReminderNotifications to schedule, and no daily
    // rate to estimate a run-out date from.
    @State private var times: [String]
    @State private var doseQty: String
    @State private var mealRelation: String
    @State private var reminderEnabled = true
    @State private var isBedtime = false
    @State private var lowStockAlert = "7"
    @State private var hasExpiry: Bool
    @State private var expiryDate: Date

    init(vm: HealthViewModel, scanned: ScannedMedication? = nil, scanIssues: [String] = [], editing: Medication? = nil) {
        self.vm = vm
        self.scanned = scanned
        self.scanIssues = scanIssues
        self.editing = editing
        let sched = editing?.primarySchedule
        let inv = editing?.inventory
        _name        = State(initialValue: editing?.name ?? scanned?.name ?? "")
        _brandName   = State(initialValue: editing?.brandName ?? scanned?.brandName ?? "")
        _dosageForm  = State(initialValue: editing?.dosageForm ?? scanned?.dosageForm ?? "tablet")
        _strength    = State(initialValue: editing?.strength ?? scanned?.strength ?? "")
        _purpose     = State(initialValue: editing?.purpose ?? scanned?.purpose ?? "")
        _notes       = State(initialValue: editing?.notes ?? "")
        _doctorName         = State(initialValue: editing?.doctorName ?? scanned?.prescribingDoctor ?? "")
        _doctorInstructions = State(initialValue: editing?.doctorInstructions ?? scanned?.instructionsVerbatim ?? "")
        _locCode            = State(initialValue: inv?.locCode ?? "")
        _lotNo              = State(initialValue: inv?.lotNo ?? scanned?.lotNo ?? "")
        // Editing must reproduce the CURRENT stock by default, not silently
        // reset it to a full pack — packSizeSeed falls back to qtyRemaining
        // (never blank when there's an existing inventory row), and
        // alreadyTaken is derived so computedRemaining == qtyRemaining
        // unless the user actually touches the calculator.
        let packSizeSeed = inv?.qtyPerPack ?? scanned?.qtyTotal ?? inv?.qtyRemaining
        _qtyPerPack         = State(initialValue: packSizeSeed.map { String(Int($0)) } ?? "")
        _alreadyTaken       = State(initialValue: inv.map { String(Int(max((packSizeSeed ?? $0.qtyRemaining) - $0.qtyRemaining, 0))) } ?? "")
        _times       = State(initialValue: (sched?.times.isEmpty == false ? sched?.times
                              : (scanned?.times.isEmpty == false ? scanned?.times : nil)) ?? ["08:00"])
        _doseQty     = State(initialValue: String(sched?.doseQty ?? scanned?.doseQty ?? 1))
        _mealRelation = State(initialValue: sched?.mealRelation ?? scanned?.mealRelation ?? "after")
        _reminderEnabled = State(initialValue: sched?.reminderEnabled ?? true)
        _isBedtime = State(initialValue: sched?.isBedtime ?? false)
        _lowStockAlert = State(initialValue: inv.map { String(Int($0.lowStockAlert)) } ?? "7")
        let expiry = (inv?.expiryDate ?? scanned?.expiryDate).flatMap(Self.date(fromISODate:))
        _hasExpiry   = State(initialValue: expiry != nil)
        _expiryDate  = State(initialValue: expiry ?? Date())
    }

    private let mealOptions: [(value: String, label: String)] = [
        ("before", "ก่อนอาหาร"), ("after", "หลังอาหาร"), ("with", "พร้อมอาหาร"), ("any", "ไม่ระบุ"),
    ]

    private let dosageForms: [(value: String, label: String)] = [
        ("tablet",    "💊 เม็ด"),
        ("capsule",   "💊 แคปซูล"),
        ("liquid",    "🧴 น้ำ"),
        ("inhaler",   "💨 พ่น"),
        ("injection", "💉 ฉีด"),
        ("patch",     "🩹 แผ่นแปะ"),
        ("cream",     "🧴 ครีม"),
        ("other",     "💊 อื่นๆ"),
    ]

    /// Clamped to 0 — a negative remaining count from a plausible input
    /// mistake (already-taken typed larger than the pack) degrades to "none
    /// left" rather than persisting a negative stock figure.
    private var computedRemaining: Double {
        max((Double(qtyPerPack) ?? 0) - (Double(alreadyTaken) ?? 0), 0)
    }

    /// Broken out of the schedule `VStack` — inlining it there pushed the
    /// surrounding ViewBuilder closure (ForEach + Toggle + Button) past
    /// what the type-checker will resolve in reasonable time.
    @ViewBuilder
    private var bedtimeToggle: some View {
        Toggle(isOn: $isBedtime) {
            Text("🌙 ยาก่อนนอน — ไม่ต้องระบุเวลาแม่นยำ")
                .font(.system(size: 12, weight: .medium))
        }
        .tint(healthGreen)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let scanned {
                        scanInfoBanner(scanned)
                    }

                    // Name field
                    fieldSection(title: "ชื่อยา *") {
                        TextField("เช่น Paracetamol", text: $name)
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }

                    // Brand name field
                    fieldSection(title: "ชื่อการค้า (ไม่บังคับ)") {
                        TextField("เช่น Tylenol, Sara", text: $brandName)
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "ความแรง") {
                            TextField("5mg, 500mg", text: $strength)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "ใช้สำหรับ") {
                            TextField("ลดความดัน, วิตามิน", text: $purpose)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }

                    // Source
                    fieldSection(title: "โรงพยาบาล/ร้านยา") {
                        Button {
                            showProviderPicker = true
                        } label: {
                            HStack {
                                Text(selectedProvider?.name ?? "ไม่ระบุ")
                                    .foregroundColor(selectedProvider == nil ? .textSecondary : .textPrimary)
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundColor(.textSecondary)
                            }
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "ชื่อแพทย์") {
                            TextField("เช่น นพ.สมชาย", text: $doctorName)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "HN") {
                            Text(selectedProvider?.hn ?? "—")
                                .font(.system(size: 15))
                                .foregroundColor(.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }

                    fieldSection(title: "รายละเอียดที่หมอกำหนด") {
                        TextField("เช่น ทาน 1 เม็ด เช้า-เย็น หลังอาหาร", text: $doctorInstructions, axis: .vertical)
                            .font(.system(size: 15))
                            .lineLimit(2, reservesSpace: true)
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "LOC") {
                            TextField("รหัสบนซอง", text: $locCode)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "LOT") {
                            TextField("เลขล็อต", text: $lotNo)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }

                    // Dosage form picker
                    fieldSection(title: "รูปแบบยา") {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(dosageForms, id: \.value) { form in
                                Button {
                                    hapticLight()
                                    dosageForm = form.value
                                } label: {
                                    Text(form.label)
                                        .font(.system(size: 13, weight: .medium))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                        .background(dosageForm == form.value ? healthGreen.opacity(0.15) : Color.background)
                                        .foregroundColor(dosageForm == form.value ? healthGreen : .textSecondary)
                                        .cornerRadius(10)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 10)
                                                .stroke(dosageForm == form.value ? healthGreen : Color.border, lineWidth: 1.5)
                                        )
                                }
                            }
                        }
                    }

                    // Reminder schedule
                    fieldSection(title: "เวลาแจ้งเตือน") {
                        VStack(spacing: 8) {
                            // Bedtime hides the picker rather than merely
                            // labeling it — "ไม่ต้องระบุเวลาแม่นยำ" means the
                            // user isn't asked to touch a clock at all. A real
                            // HH:mm is still stored (LINE reminders still fire
                            // on it); toggling on seeds a 22:00 default only
                            // if times is still at its untouched default, so
                            // an already-customized time survives the toggle.
                            if !isBedtime {
                                ForEach(times.indices, id: \.self) { i in
                                    HStack(spacing: 8) {
                                        DatePicker("", selection: Binding(
                                            get: { Self.time(from: times[i]) },
                                            set: { times[i] = Self.timeString(from: $0) }
                                        ), displayedComponents: .hourAndMinute)
                                        .labelsHidden()
                                        Spacer()
                                        if times.count > 1 {
                                            Button {
                                                times.remove(at: i)
                                            } label: {
                                                Image(systemName: "xmark.circle.fill")
                                                    .foregroundColor(.textSecondary)
                                            }
                                        }
                                    }
                                }
                            }
                            bedtimeToggle
                                .onChange(of: isBedtime) { newValue in
                                    if newValue && times == ["08:00"] { times = ["22:00"] }
                                }
                            if !isBedtime {
                                Button {
                                    hapticLight()
                                    times.append("12:00")
                                } label: {
                                    Label("เพิ่มเวลา", systemImage: "plus.circle")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(healthGreen)
                                }
                            }
                        }
                        .padding(12)
                        .background(Color.background)
                        .cornerRadius(10)
                    }

                    HStack(spacing: 12) {
                        fieldSection(title: "กี่เม็ดต่อครั้ง") {
                            TextField("1", text: $doseQty)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "ช่วงเวลาอาหาร") {
                            Picker("", selection: $mealRelation) {
                                ForEach(mealOptions, id: \.value) { Text($0.label).tag($0.value) }
                            }
                            .pickerStyle(.menu)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.background)
                            .cornerRadius(10)
                        }
                    }

                    Toggle(isOn: $reminderEnabled) {
                        Text("แจ้งเตือนบนมือถือ")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .tint(healthGreen)

                    // Inventory — pack size minus already-taken gives the
                    // remaining count. init() seeds both fields so opening
                    // this on an existing medication starts computedRemaining
                    // at the current qtyRemaining — saving without touching
                    // either field must never silently reset stock to a full
                    // pack.
                    HStack(spacing: 12) {
                        fieldSection(title: "จำนวนต่อกล่อง") {
                            TextField("30", text: $qtyPerPack)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                        fieldSection(title: "ทานไปแล้ว") {
                            TextField("0", text: $alreadyTaken)
                                .keyboardType(.decimalPad)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .cornerRadius(10)
                        }
                    }
                    HStack {
                        Text("คงเหลือ")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.textSecondary)
                        Spacer()
                        Text(computedRemaining.clean)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(healthGreen)
                    }
                    .padding(12)
                    .background(Color.background)
                    .cornerRadius(10)

                    fieldSection(title: "แจ้งเตือนเมื่อเหลือ") {
                        TextField("7", text: $lowStockAlert)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 15))
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(isOn: $hasExpiry) {
                            Text("วันหมดอายุ")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .tint(healthGreen)
                        if hasExpiry {
                            DatePicker("", selection: $expiryDate, displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                        }
                    }

                    // Notes field
                    fieldSection(title: scanned == nil ? "หมายเหตุ (ไม่บังคับ)" : "หมายเหตุจากฉลาก") {
                        TextField("เช่น ทานหลังอาหาร, ทาน 1 เม็ด เช้า-เย็น", text: $notes, axis: .vertical)
                            .font(.system(size: 15))
                            .lineLimit(3, reservesSpace: true)
                            .padding(12)
                            .background(Color.background)
                            .cornerRadius(10)
                        if scanned != nil {
                            Label("สแกนจากฉลาก · ตรวจสอบก่อนบันทึก", systemImage: "text.viewfinder")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(healthGreen)
                        }
                    }

                    if let err = errorMsg {
                        Text(err)
                            .font(.system(size: 12))
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Save button
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if isSaving {
                                ProgressView().tint(.white)
                            } else {
                                Text(editing != nil ? "บันทึกการแก้ไข" : "บันทึกยา")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(name.trimmingCharacters(in: .whitespaces).isEmpty ? Color.gray.opacity(0.3) : healthGreen)
                        .cornerRadius(14)
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                    .padding(.top, 4)
                }
                .padding(20)
            }
            .background(Color.surface.ignoresSafeArea())
            .navigationTitle(editing != nil ? "แก้ไขยา" : (scanned != nil ? "ตรวจสอบก่อนบันทึก" : "เพิ่มยา"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("ยกเลิก") { dismiss() }
                        .foregroundColor(.textSecondary)
                }
            }
            .sheet(isPresented: $showProviderPicker) {
                if let userId = authVM.session?.user.id.uuidString {
                    ProviderPickerView(vm: vm, userId: userId, selected: $selectedProvider)
                }
            }
            .task {
                guard selectedProvider == nil else { return }
                if let providerId = editing?.provider?.id {
                    selectedProvider = vm.providers.first { $0.id == providerId }
                } else if let hospitalName = scanned?.hospitalName, !hospitalName.isEmpty {
                    selectedProvider = vm.providers.first {
                        $0.name.caseInsensitiveCompare(hospitalName) == .orderedSame
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func fieldSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.textSecondary)
            content()
        }
    }

    private func save() async {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else { return }
        guard let userId = authVM.session?.user.id.uuidString else { return }

        isSaving = true
        errorMsg = nil
        defer { isSaving = false }

        do {
            if let editing {
                try await vm.updateMedication(
                    id: editing.id,
                    scheduleId: editing.primarySchedule?.id,
                    inventoryId: editing.inventory?.id,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    providerId: selectedProvider?.id,
                    doctorName: doctorName.trimmingCharacters(in: .whitespaces),
                    doctorInstructions: doctorInstructions.trimmingCharacters(in: .whitespaces),
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    isBedtime: isBedtime,
                    qtyRemaining: computedRemaining,
                    qtyUnit: "เม็ด",
                    qtyPerPack: Double(qtyPerPack),
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil,
                    locCode: locCode.trimmingCharacters(in: .whitespaces),
                    lotNo: lotNo.trimmingCharacters(in: .whitespaces)
                )
            } else {
                try await vm.addMedication(
                    userId: userId,
                    name: trimmedName,
                    brandName: brandName.trimmingCharacters(in: .whitespaces),
                    dosageForm: dosageForm,
                    notes: notes.trimmingCharacters(in: .whitespaces),
                    strength: strength.trimmingCharacters(in: .whitespaces),
                    purpose: purpose.trimmingCharacters(in: .whitespaces),
                    providerId: selectedProvider?.id,
                    doctorName: doctorName.trimmingCharacters(in: .whitespaces),
                    doctorInstructions: doctorInstructions.trimmingCharacters(in: .whitespaces),
                    instructionSource: scanned?.instructionsVerbatim == nil ? "user" : "label",
                    times: times,
                    doseQty: Double(doseQty) ?? 1,
                    mealRelation: mealRelation,
                    reminderEnabled: reminderEnabled,
                    isBedtime: isBedtime,
                    qtyTotal: computedRemaining,
                    qtyUnit: "เม็ด",
                    qtyPerPack: Double(qtyPerPack),
                    lowStockAlert: Double(lowStockAlert) ?? 7,
                    expiryDate: hasExpiry ? Self.isoDateString(from: expiryDate) : nil,
                    locCode: locCode.trimmingCharacters(in: .whitespaces),
                    lotNo: lotNo.trimmingCharacters(in: .whitespaces)
                )
            }
            if reminderEnabled {
                await vm.requestNotificationPermission()
            }
            hapticSuccess()
            dismiss()
        } catch {
            errorMsg = "เกิดข้อผิดพลาด: \(error.localizedDescription)"
        }
    }

    private static func time(from hhmm: String) -> Date {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.date(from: hhmm) ?? Date()
    }

    private static func timeString(from date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    private static func date(fromISODate iso: String) -> Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: iso)
    }

    private static func isoDateString(from date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    // MARK: – Scan info banner
    //
    // Read-only context from the label the machine could not turn into a
    // form field — mirrors web's scan banner in AddMedicationModal
    // (medications-client.tsx). Shown so the person reviewing has the same
    // information the model had, not just its conclusions.
    @ViewBuilder
    private func scanInfoBanner(_ scanned: ScannedMedication) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("อ่านจากฉลากยา — ตรวจให้ตรงกับซองยาก่อนบันทึก", systemImage: "text.viewfinder")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(healthGreen)

            if let verbatim = scanned.instructionsVerbatim, !verbatim.isEmpty {
                Text("“\(verbatim)”")
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }
            if scanned.hospitalName != nil || scanned.prescribingDoctor != nil {
                Text([scanned.hospitalName, scanned.prescribingDoctor].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundColor(.textSecondary)
            }
            if scanned.times.isEmpty {
                Label("อ่านช่วงเวลาไม่ได้ — ใส่เวลาแจ้งเตือนเองด้านล่าง", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.orange)
            }
            ForEach(scanIssues, id: \.self) { issue in
                Label(issue, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.orange)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(healthGreen.opacity(0.08))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(healthGreen.opacity(0.25), lineWidth: 1))
    }
}
