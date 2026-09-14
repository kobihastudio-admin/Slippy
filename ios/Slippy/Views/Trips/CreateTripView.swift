import SwiftUI

struct CreateTripView: View {
    let onSaved: () -> Void

    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = TripsViewModel()

    @State private var title = ""
    @State private var tripType = "travel"
    @State private var useEventDate = false
    @State private var eventDate = Date()
    @State private var endDate = Date()
    @State private var destination = ""
    @State private var baseCurrency = "THB"
    @State private var venue = ""
    @State private var notes = ""
    @State private var isSaving = false
    @State private var errorMsg: String?

    private let tripTypes: [(String, String)] = [
        ("travel",     "✈️ ท่องเที่ยว"),
        ("sport",      "🏟️ กีฬา"),
        ("food_order", "🍽️ อาหาร"),
        ("general",    "📌 ทั่วไป"),
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Title
                        formSection(title: "ชื่อทริป") {
                            TextField("เช่น ทริปเชียงใหม่ปีใหม่", text: $title)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        // Type picker
                        formSection(title: "ประเภท") {
                            VStack(spacing: 0) {
                                ForEach(tripTypes, id: \.0) { type, label in
                                    Button {
                                        hapticLight()
                                        tripType = type
                                    } label: {
                                        HStack {
                                            Text(label)
                                                .font(.system(size: 15))
                                                .foregroundColor(Color.textPrimary)
                                            Spacer()
                                            if tripType == type {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundColor(Color.brand500)
                                            }
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 12)
                                    }
                                    if type != "general" {
                                        Divider().padding(.horizontal, 12)
                                    }
                                }
                            }
                            .background(Color.background)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        // Event date
                        formSection(title: "วันที่") {
                            VStack(spacing: 0) {
                                Toggle("ระบุวันที่", isOn: $useEventDate)
                                    .font(.system(size: 15))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 12)
                                    .tint(Color.brand500)

                                if useEventDate {
                                    Divider().padding(.horizontal, 12)
                                    DatePicker("", selection: $eventDate, displayedComponents: .date)
                                        .datePickerStyle(.graphical)
                                        .tint(Color.brand500)
                                        .padding(.horizontal, 8)
                                    DatePicker("วันสิ้นสุด", selection: $endDate, in: eventDate..., displayedComponents: .date)
                                        .tint(Color.brand500).padding(12)
                                }
                            }
                            .background(Color.background)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        formSection(title: "จุดหมาย") {
                            TextField("เช่น Kyoto, Japan", text: $destination)
                                .font(.system(size: 15)).padding(12).background(Color.background)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        formSection(title: "สกุลเงินหลัก") {
                            Picker("สกุลเงินหลัก", selection: $baseCurrency) {
                                ForEach(["THB", "JPY", "USD", "EUR", "GBP", "SGD"], id: \.self) { Text($0).tag($0) }
                            }
                            .pickerStyle(.segmented)
                        }

                        // Venue
                        formSection(title: "สถานที่") {
                            TextField("เช่น เชียงใหม่, ภูเก็ต", text: $venue)
                                .font(.system(size: 15))
                                .padding(12)
                                .background(Color.background)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        // Notes
                        formSection(title: "หมายเหตุ (ไม่บังคับ)") {
                            TextField("บันทึกเพิ่มเติม", text: $notes, axis: .vertical)
                                .font(.system(size: 15))
                                .lineLimit(3...5)
                                .padding(12)
                                .background(Color.background)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }

                        if let err = errorMsg {
                            Text(err)
                                .font(.system(size: 13))
                                .foregroundColor(.red)
                                .padding(.horizontal, 4)
                        }

                        // Save button
                        Button {
                            save()
                        } label: {
                            HStack {
                                if isSaving {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("สร้างทริป")
                                        .font(.system(size: 16, weight: .semibold))
                                }
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(title.isEmpty ? Color.brand500.opacity(0.4) : Color.brand500)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .disabled(title.isEmpty || isSaving)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
            .navigationTitle("สร้างทริปใหม่")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                        .foregroundColor(Color.textSecondary)
                }
            }
        }
    }

    @ViewBuilder
    private func formSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .padding(.horizontal, 4)
            content()
        }
    }

    private func save() {
        guard let orgId = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString else {
            errorMsg = "ไม่พบข้อมูลผู้ใช้"
            return
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        guard !trimmedTitle.isEmpty else {
            errorMsg = "กรุณากรอกชื่อทริป"
            return
        }

        isSaving = true
        errorMsg = nil

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let eventDateStr: String? = useEventDate ? dateFormatter.string(from: eventDate) : nil
        let endDateStr: String? = useEventDate ? dateFormatter.string(from: endDate) : nil

        Task {
            do {
                try await vm.createTrip(
                    orgId: orgId,
                    userId: userId,
                    title: trimmedTitle,
                    tripType: tripType,
                    eventDate: eventDateStr,
                    endDate: endDateStr,
                    destination: destination.trimmingCharacters(in: .whitespaces).isEmpty ? nil : destination.trimmingCharacters(in: .whitespaces),
                    venue: venue.trimmingCharacters(in: .whitespaces).isEmpty ? nil : venue.trimmingCharacters(in: .whitespaces),
                    notes: notes.trimmingCharacters(in: .whitespaces).isEmpty ? nil : notes.trimmingCharacters(in: .whitespaces),
                    baseCurrency: baseCurrency
                )
                hapticSuccess()
                onSaved()
                dismiss()
            } catch {
                errorMsg = error.localizedDescription
            }
            isSaving = false
        }
    }
}
