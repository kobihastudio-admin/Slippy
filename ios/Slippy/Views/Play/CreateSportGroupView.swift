import SwiftUI

/// Create-group form — native port of the LIFF page's "สร้างกลุ่มกีฬาใหม่" view.
struct CreateSportGroupView: View {
    @ObservedObject var vm: SportGroupsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var sportType = ""
    @State private var venue = ""
    @State private var mapUrl = ""
    @State private var recurringDays: Set<Int> = []
    @State private var startTime = Date()
    @State private var endTime = Date()
    @State private var courtNo = ""
    @State private var maxPlayers = ""
    @State private var promptpayId = ""
    @State private var isSaving = false
    @State private var showVenuePicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    sportPicker
                    titleField
                    venueField
                    daysPicker
                    timeFields
                    courtField
                    maxPlayersField
                    promptpayField
                    saveButton
                }
                .padding(16)
                .padding(.bottom, 32)
            }
            .background(Color.background)
            .navigationTitle("สร้างกลุ่มกีฬาใหม่")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }.foregroundColor(Color.brand500)
                }
            }
        }
    }

    private var sportPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("เลือกชนิดกีฬา").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(sportOptions, id: \.label) { option in
                    Button {
                        hapticLight(); sportType = option.label
                        if title.isEmpty { title = option.label }
                    } label: {
                        VStack(spacing: 4) {
                            Text(option.emoji).font(.system(size: 22))
                            Text(option.label).font(.system(size: 11, weight: .medium))
                        }
                        .foregroundColor(sportType == option.label ? Color.brand500 : Color.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(sportType == option.label ? Color.brand500.opacity(0.1) : Color.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12)
                            .stroke(sportType == option.label ? Color.brand500 : Color.border, lineWidth: 1.5))
                    }
                }
            }
        }
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ชื่อกลุ่ม").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            TextField("เช่น แบดทุกวันพุธ", text: $title)
                .font(.system(size: 14)).foregroundColor(Color.textPrimary)
                .padding(12).background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
        }
    }

    private var venueField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("สนาม (ไม่บังคับ)").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            Button {
                hapticLight(); showVenuePicker = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: venue.isEmpty ? "mappin.and.ellipse" : "mappin.circle.fill")
                        .foregroundColor(venue.isEmpty ? Color.textSecondary : Color.brand500)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(venue.isEmpty ? "ค้นหาสนาม/สถานที่" : venue)
                            .font(.system(size: 14, weight: venue.isEmpty ? .regular : .medium))
                            .foregroundColor(venue.isEmpty ? Color.textSecondary : Color.textPrimary)
                        if !mapUrl.isEmpty {
                            Text(mapUrl).font(.system(size: 11)).foregroundColor(Color.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                }
                .padding(12).background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
            }
        }
        .sheet(isPresented: $showVenuePicker) {
            if let orgId = authVM.org?.id, let userId = authVM.session?.user.id.uuidString {
                VenuePickerView(orgId: orgId, userId: userId) { name, url in
                    venue = name; mapUrl = url
                }
            }
        }
    }

    private var daysPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("วันที่เล่นประจำ").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            HStack(spacing: 6) {
                ForEach(0..<7, id: \.self) { idx in
                    Button {
                        hapticLight()
                        if recurringDays.contains(idx) { recurringDays.remove(idx) } else { recurringDays.insert(idx) }
                    } label: {
                        Text(dayLabel(idx))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(recurringDays.contains(idx) ? Color.brand500 : Color.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(recurringDays.contains(idx) ? Color.brand500.opacity(0.1) : Color.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10)
                                .stroke(recurringDays.contains(idx) ? Color.brand500 : Color.border, lineWidth: 1.5))
                    }
                }
            }
            Text(recurringDays.isEmpty
                 ? "ไม่เลือกก็ได้ — แล้วค่อยเพิ่มเซสชันแบบครั้งเดียวทีหลัง"
                 : "ระบบจะสร้างเซสชันล่วงหน้า 4 สัปดาห์ให้อัตโนมัติ")
                .font(.system(size: 11)).foregroundColor(Color.textSecondary)
        }
    }

    private var timeFields: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("เวลาเริ่ม").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute)
                    .labelsHidden().datePickerStyle(.compact)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("เวลาเลิก").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
                DatePicker("", selection: $endTime, displayedComponents: .hourAndMinute)
                    .labelsHidden().datePickerStyle(.compact)
            }
        }
    }

    private var courtField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("คอร์ด/สนาม (ไม่บังคับ)").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            TextField("เช่น คอร์ด No.2", text: $courtNo)
                .font(.system(size: 14)).foregroundColor(Color.textPrimary)
                .padding(12).background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
        }
    }

    private var maxPlayersField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("จำนวนคนสูงสุด (ไม่บังคับ)").font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            TextField("เช่น 8", text: $maxPlayers)
                .keyboardType(.numberPad)
                .font(.system(size: 14)).foregroundColor(Color.textPrimary)
                .padding(12).background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
        }
    }

    private var promptpayField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("เบอร์ PromptPay สำหรับรับเงิน (ไม่บังคับ)")
                .font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            TextField("เช่น 0812345678", text: $promptpayId)
                .keyboardType(.numberPad)
                .font(.system(size: 14)).foregroundColor(Color.textPrimary)
                .padding(12).background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.border))
            Text("ระบบจะสร้าง QR PromptPay พร้อมยอดเงินให้สมาชิกสแกนโอนได้เลย")
                .font(.system(size: 11)).foregroundColor(Color.textSecondary)
        }
    }

    private var saveButton: some View {
        Button {
            Task { await save() }
        } label: {
            HStack {
                if isSaving { ProgressView().tint(.white) } else { Text("สร้างกลุ่ม →") }
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(sportType.isEmpty || isSaving ? Color.brand500.opacity(0.5) : Color.brand500)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .disabled(sportType.isEmpty || isSaving)
    }

    private func save() async {
        guard let orgId = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString else { return }
        isSaving = true; hapticLight()
        let fmt = DateFormatter(); fmt.dateFormat = "HH:mm"
        let group = await vm.createGroup(
            orgId: orgId, userId: userId,
            title: title.isEmpty ? sportType : title, sportType: sportType,
            venue: venue.isEmpty ? nil : venue, mapUrl: mapUrl.isEmpty ? nil : mapUrl,
            recurringDays: Array(recurringDays).sorted(),
            startTime: fmt.string(from: startTime), endTime: fmt.string(from: endTime),
            courtNo: courtNo.isEmpty ? nil : courtNo,
            maxPlayers: Int(maxPlayers), promptpayId: promptpayId.isEmpty ? nil : promptpayId
        )
        isSaving = false
        if group != nil {
            hapticSuccess()
            await vm.load(orgId: orgId)
            dismiss()
        }
    }
}
