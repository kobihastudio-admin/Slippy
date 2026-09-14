// ios/Slippy/Views/Health/ProviderPickerView.swift
import SwiftUI

private let healthGreen = Color(hex: "#10b981")

/// Type-to-filter an existing hospital/clinic/pharmacy, or add a new one on
/// the spot — inline rather than a separate management screen, since the
/// only thing this needs to do is "pick from a list, or grow the list".
struct ProviderPickerView: View {
    @ObservedObject var vm: HealthViewModel
    let userId: String
    @Binding var selected: MedicalProvider?
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var showingNew = false
    @State private var newName = ""
    @State private var newType = "hospital"
    @State private var newHN = ""
    @State private var isSaving = false

    private var filtered: [MedicalProvider] {
        query.isEmpty ? vm.providers : vm.providers.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("ค้นหาโรงพยาบาล/ร้านยา", text: $query)
                }
                Section {
                    Button {
                        selected = nil
                        dismiss()
                    } label: {
                        Text("ไม่ระบุ").foregroundColor(.textSecondary)
                    }
                    ForEach(filtered) { provider in
                        Button {
                            selected = provider
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(provider.name)
                                        .foregroundColor(.textPrimary)
                                    Text(provider.typeLabel)
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                }
                                Spacer()
                                if selected?.id == provider.id {
                                    Image(systemName: "checkmark").foregroundColor(healthGreen)
                                }
                            }
                        }
                    }
                }
                Section {
                    if showingNew {
                        TextField("ชื่อโรงพยาบาล/ร้านยา", text: $newName)
                        Picker("ประเภท", selection: $newType) {
                            Text("🏥 โรงพยาบาล").tag("hospital")
                            Text("🩺 คลินิก").tag("clinic")
                            Text("💊 ร้านยา").tag("pharmacy")
                        }
                        if newType == "hospital" {
                            TextField("HN", text: $newHN)
                        }
                        Button {
                            Task { await createProvider() }
                        } label: {
                            if isSaving { ProgressView() } else { Text("บันทึก").bold() }
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                    } else {
                        Button {
                            newName = query
                            showingNew = true
                        } label: {
                            Label("เพิ่มใหม่", systemImage: "plus.circle").foregroundColor(healthGreen)
                        }
                    }
                }
            }
            .navigationTitle("เลือกโรงพยาบาล/ร้านยา")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
        }
    }

    private func createProvider() async {
        isSaving = true
        defer { isSaving = false }
        guard let created = try? await vm.addProvider(
            userId: userId, name: newName.trimmingCharacters(in: .whitespaces),
            type: newType, hn: newType == "hospital" ? newHN : nil
        ) else { return }
        selected = created
        dismiss()
    }
}
