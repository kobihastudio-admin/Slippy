import SwiftUI
import PhotosUI

/// The trip's photo gallery — every check-in photo, all together. Public
/// bucket (TripPhotoAPI), so plain AsyncImage works with no signed URLs.
struct TripGalleryView: View {
    let trip: Trip
    let days: [TripItineraryDay]

    @State private var photos: [TripPhoto] = []
    @State private var loading = true
    @State private var errorText: String?
    @State private var lightbox: TripPhoto?
    @State private var photoItem: PhotosPickerItem?
    @State private var uploading = false
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 6)]

    private func dayLabel(for photo: TripPhoto) -> String? {
        guard let itemId = photo.itemId else { return nil }
        for day in days where (day.items ?? []).contains(where: { $0.id == itemId }) {
            return "วันที่ \(day.dayNumber)"
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if photos.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle").font(.system(size: 30)).foregroundColor(Color.textSecondary)
                        Text("ยังไม่มีรูปในทริปนี้").font(.system(size: 15, weight: .semibold))
                        Text("เช็คอินที่จุดใดจุดหนึ่งแล้วแนบรูปได้เลย")
                            .font(.system(size: 12)).foregroundColor(Color.textSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 6) {
                            ForEach(photos) { photo in
                                Button { lightbox = photo } label: {
                                    AsyncImage(url: TripPhotoAPI.publicURL(photo)) { phase in
                                        if let image = phase.image {
                                            image.resizable().scaledToFill()
                                        } else {
                                            Rectangle().fill(Color.surface)
                                        }
                                    }
                                    .frame(width: 104, height: 104)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .navigationTitle("แกลเลอรี")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        if uploading { ProgressView().controlSize(.small) } else { Image(systemName: "plus") }
                    }
                    .disabled(uploading)
                }
            }
            .alert("ทำรายการไม่สำเร็จ", isPresented: .constant(errorText != nil)) {
                Button("ตกลง") { errorText = nil }
            } message: { Text(errorText ?? "") }
            .sheet(item: $lightbox) { photo in
                LightboxView(photo: photo, dayLabel: dayLabel(for: photo)) {
                    Task { await remove(photo) }
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self) else {
                        errorText = "อ่านรูปไม่สำเร็จ"; photoItem = nil; return
                    }
                    await upload(data)
                    photoItem = nil
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do { photos = try await TripPhotoAPI.list(journeyId: trip.id) }
        catch { errorText = error.localizedDescription }
    }

    private func upload(_ data: Data) async {
        uploading = true
        defer { uploading = false }
        do {
            let photo = try await TripPhotoAPI.upload(journeyId: trip.id, itemId: nil, data: data)
            photos.insert(photo, at: 0)
            hapticSuccess()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func remove(_ photo: TripPhoto) async {
        let before = photos
        photos.removeAll { $0.id == photo.id }
        lightbox = nil
        do { try await TripPhotoAPI.remove(photo) }
        catch { photos = before; errorText = error.localizedDescription }
    }
}

private struct LightboxView: View {
    let photo: TripPhoto
    let dayLabel: String?
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                AsyncImage(url: TripPhotoAPI.publicURL(photo)) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                    } else {
                        ProgressView().tint(.white)
                    }
                }
                .padding()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }.tint(.white)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) { onDelete() } label: {
                        Image(systemName: "trash")
                    }
                    .tint(.white)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .overlay(alignment: .bottom) {
                if let dayLabel {
                    Text(dayLabel)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Capsule().fill(.black.opacity(0.5)))
                        .padding(.bottom, 20)
                }
            }
        }
    }
}
