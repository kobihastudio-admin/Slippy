import SwiftUI

// Shown when the user taps "Share → Slippy" from Notes/Files/Photos.
// Previews the received pages and lets the user confirm or cancel before upload.
struct SharedImportView: View {
    @EnvironmentObject var authVM: AuthViewModel
    let images: [UIImage]
    let onDismiss: () -> Void

    @State private var selectedPage  = 0
    @State private var isUploading   = false
    @State private var uploadSuccess = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Page strip
                if images.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(images.indices, id: \.self) { i in
                                Image(uiImage: images[i])
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 60, height: 80)
                                    .clipped()
                                    .cornerRadius(8)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(i == selectedPage ? Color.brand500 : Color.clear, lineWidth: 2)
                                    )
                                    .onTapGesture { selectedPage = i }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                    .background(Color(hex: "#f1f5f9"))
                }

                // Main preview
                if let img = images.indices.contains(selectedPage) ? images[selectedPage] : nil {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFit()
                        .cornerRadius(12)
                        .padding(20)
                        .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 4)
                }

                Spacer()

                // Status messages
                if let error {
                    statusRow(icon: "exclamationmark.triangle.fill",
                              text: error, color: .red, bg: "#fef2f2")
                }
                if uploadSuccess {
                    statusRow(icon: "checkmark.circle.fill",
                              text: "อัพโหลดสำเร็จ! AI กำลังประมวลผล…",
                              color: Color(hex: "#16a34a"), bg: "#f0fdf4")
                }

                // Action buttons
                HStack(spacing: 12) {
                    Button("ยกเลิก") { onDismiss() }
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color.brand500)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.brand50)
                        .cornerRadius(14)
                        .disabled(isUploading)

                    Button {
                        Task { await upload() }
                    } label: {
                        Group {
                            if isUploading {
                                ProgressView().tint(.white)
                            } else {
                                Text("อัพโหลด \(images.count) หน้า")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.brand500)
                        .cornerRadius(14)
                    }
                    .disabled(isUploading || uploadSuccess)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .background(Color(hex: "#f8f9fc"))
            .navigationTitle("นำเข้าจาก Share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { onDismiss() }
                        .foregroundColor(Color.brand500)
                        .disabled(isUploading)
                }
            }
            .slippyLoading(isUploading, message: "กำลังอัพโหลด…")
        }
    }

    @ViewBuilder
    private func statusRow(icon: String, text: String, color: Color, bg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundColor(color)
            Text(text).font(.system(size: 13)).foregroundColor(color)
            Spacer()
        }
        .padding(12)
        .background(Color(hex: bg))
        .cornerRadius(10)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    // MARK: – Upload (same pipeline as CameraPickerView)
    private func upload() async {
        guard !images.isEmpty,
              let orgId  = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString
        else { error = "กรุณาเข้าสู่ระบบก่อนอัพโหลด"; return }

        isUploading = true; error = nil
        let stamp = Date().timeIntervalSince1970

        do {
            for (index, img) in images.enumerated() {
                guard let data = img.jpegData(compressionQuality: 0.94) else { continue }
                let suffix   = images.count > 1 ? "_p\(index + 1)" : ""
                let fileName = "\(userId)_\(stamp)\(suffix)_share.jpg"
                let path     = "\(orgId)/\(fileName)"

                try await SupabaseManager.shared.client
                    .storage.from(Config.storageBucket)
                    .upload(path, data: data, options: .init(upsert: false))

                let record: [String: String] = [
                    "organization_id": orgId,
                    "uploaded_by":     userId,
                    "file_path":       path,
                    "file_type":       "jpg",
                    "status":          "processing",
                    "source":          "share_extension"
                ]
                try await SupabaseManager.shared.client
                    .from("documents").insert(record).execute()
            }
            isUploading  = false
            uploadSuccess = true
            hapticSuccess()
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            onDismiss()
        } catch {
            isUploading  = false
            self.error   = error.localizedDescription
        }
    }
}
