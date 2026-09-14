import SwiftUI

struct PlayerSetupView: View {
    @State private var profile = PlayerSportProfile.placeholder
    @State private var saved   = false
    @Environment(\.dismiss) private var dismiss

    private let storeKey = "slippy_sport_profile"

    var body: some View {
        NavigationStack {
            Form {
                Section("ข้อมูลผู้เล่น") {
                    TextField("ชื่อที่แสดง", text: $profile.displayName)

                    Picker("มือถนัด", selection: $profile.dominantHand) {
                        ForEach(DominantHand.allCases, id: \.self) {
                            Text($0.displayName).tag($0)
                        }
                    }

                    Picker("ระดับฝีมือ", selection: $profile.skillLevel) {
                        ForEach(SkillLevel.allCases, id: \.self) {
                            Text($0.displayName).tag($0)
                        }
                    }

                    TextField("ชื่อก๊วน (ถ้ามี)", text: Binding(
                        get: { profile.clubName ?? "" },
                        set: { profile.clubName = $0.isEmpty ? nil : $0 }
                    ))
                }

                Section {
                    Button("บันทึกโปรไฟล์") {
                        saveProfile()
                        saved = true
                        dismiss()
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .foregroundColor(Color(hex: "#16a34a"))
                    .bold()
                }
            }
            .navigationTitle("โปรไฟล์นักกีฬา")
            .onAppear { loadProfile() }
        }
    }

    private func saveProfile() {
        guard let data = try? JSONEncoder().encode(profile) else { return }
        UserDefaults.standard.set(data, forKey: storeKey)
    }

    private func loadProfile() {
        guard let data    = UserDefaults.standard.data(forKey: storeKey),
              let decoded = try? JSONDecoder().decode(PlayerSportProfile.self, from: data)
        else { return }
        profile = decoded
    }
}
