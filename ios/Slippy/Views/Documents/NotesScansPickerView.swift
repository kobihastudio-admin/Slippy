import SwiftUI
import Photos

struct NotesScansPickerView: View {
    @Environment(\.dismiss) private var dismiss
    var onPick: ([UIImage]) -> Void

    @State private var assets:   [PHAsset]      = []
    @State private var selected  = Set<String>()
    @State private var thumbs    = [String: UIImage]()
    @State private var authStatus: PHAuthorizationStatus = .notDetermined
    @State private var isLoading  = true
    @State private var isFetching = false
    /// True only when a real scanned-documents album was found. Without this the
    /// screen silently showed the whole camera roll under a "Notes" title.
    @State private var foundScanAlbum = false
    /// The user explicitly chose to browse recent photos instead.
    @State private var browsingAllPhotos = false

    private let columns = [GridItem(.flexible(), spacing: 8),
                           GridItem(.flexible(), spacing: 8),
                           GridItem(.flexible(), spacing: 8)]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("กำลังโหลด…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if authStatus == .denied || authStatus == .restricted {
                    deniedView
                } else if !foundScanAlbum && !browsingAllPhotos {
                    // No album on this device, so there is nothing here that came
                    // from Notes. Show the route that actually works instead of a
                    // camera roll wearing a "Notes" label.
                    guideView
                } else if assets.isEmpty {
                    emptyView
                } else {
                    gridView
                }
            }
            .background(Color(hex: "#f8f9fc"))
            .navigationTitle(foundScanAlbum ? "เอกสารสแกนในคลังภาพ" : "นำเข้าจาก Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                        .foregroundColor(Color.brand500)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if !foundScanAlbum && !browsingAllPhotos {
                        EmptyView()
                    } else if isFetching {
                        ProgressView().tint(Color.brand500)
                    } else {
                        Button("นำเข้า (\(selected.count))") { fetchFullRes() }
                            .disabled(selected.isEmpty)
                            .foregroundColor(Color.brand500)
                    }
                }
            }
        }
        .task { await requestAndLoad() }
    }

    // MARK: – Sub-views

    private var gridView: some View {
        GeometryReader { outer in
            // 3 columns, 8pt gaps, 12pt outer padding — fixed square cell size
            let spacing: CGFloat = 8
            let hPad: CGFloat = 12
            let cellSize = (outer.size.width - hPad * 2 - spacing * 2) / 3

            ScrollView {
                LazyVGrid(columns: columns, spacing: spacing) {
                    ForEach(assets, id: \.localIdentifier) { asset in
                        let id = asset.localIdentifier
                        let sel = selected.contains(id)
                        ZStack(alignment: .topTrailing) {
                            Group {
                                if let thumb = thumbs[id] {
                                    Image(uiImage: thumb)
                                        .resizable()
                                        .scaledToFill()
                                } else {
                                    Rectangle()
                                        .fill(Color(hex: "#e5e7eb"))
                                        .overlay(ProgressView().scaleEffect(0.6))
                                }
                            }
                            .frame(width: cellSize, height: cellSize)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                hapticLight()
                                if sel { selected.remove(id) } else { selected.insert(id) }
                            }
                            .task { await loadThumb(asset) }

                            if sel {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(Color.brand500)
                                    .background(Circle().fill(.white).padding(2))
                                    .padding(6)
                            }
                        }
                        .frame(width: cellSize, height: cellSize)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(sel ? Color.brand500 : Color.clear, lineWidth: 3)
                        )
                    }
                }
                .padding(.horizontal, hPad)
                .padding(.vertical, 12)
            }
        }
    }

    private var guideView: some View {
        ScrollView {
            VStack(spacing: 14) {
                NotesImportGuide()

                Button {
                    hapticLight()
                    Task { await loadRecentPhotos() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "photo.on.rectangle.angled").font(.system(size: 13))
                        Text("หรือเลือกจากรูปล่าสุดในเครื่อง")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundColor(Color.brand500)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.brand500.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
            .padding(16)
        }
    }

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "doc.viewfinder")
                .font(.system(size: 52))
                .foregroundColor(Color(hex: "#d1d5db"))
            Text("ไม่พบเอกสารสแกน")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color(hex: "#6b7280"))
            Text("เปิด Notes แล้วสแกนเอกสาร จากนั้นบันทึกลงคลังภาพ\nหรือสแกนโดยตรงในแอป Slippy")
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "#9ca3af"))
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(40)
    }

    private var deniedView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 52))
                .foregroundColor(Color(hex: "#d1d5db"))
            Text("ไม่มีสิทธิ์เข้าถึงรูปภาพ")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color(hex: "#6b7280"))
            Button("ไปที่การตั้งค่า") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(Color.brand500)
            Spacer()
        }
        .padding(40)
    }

    // MARK: – Data

    private func requestAndLoad() async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        await MainActor.run { authStatus = status }
        guard status == .authorized || status == .limited else {
            await MainActor.run { isLoading = false }
            return
        }
        await loadAssets()
        await MainActor.run { isLoading = false }
    }

    private func loadAssets() async {
        let fetchOpts = PHFetchOptions()
        fetchOpts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        // Apple Notes never writes its scans here — a scan stays inside the note
        // as an attachment. This album only exists when the user exported one by
        // hand, or when another scanner app created it, so treat a miss as the
        // normal case rather than an error. Names vary by device language.
        let candidates = ["Scanned Documents", "Scans", "เอกสารที่สแกน", "เอกสารสแกน"]
        var result: [PHAsset] = []
        var found = false

        for title in candidates where !found {
            let albumOpts = PHFetchOptions()
            albumOpts.predicate = NSPredicate(format: "localizedTitle = %@", title)
            let collections = PHAssetCollection.fetchAssetCollections(
                with: .album, subtype: .albumRegular, options: albumOpts
            )
            guard let album = collections.firstObject else { continue }
            let fetch = PHAsset.fetchAssets(in: album, options: fetchOpts)
            guard fetch.count > 0 else { continue }
            for i in 0..<fetch.count { result.append(fetch.object(at: i)) }
            found = true
        }

        let snapshot = result
        await MainActor.run { assets = snapshot; foundScanAlbum = found }
    }

    /// Loads the camera roll — only ever called because the user asked for it.
    private func loadRecentPhotos() async {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let all = PHAsset.fetchAssets(with: .image, options: opts)
        var result: [PHAsset] = []
        for i in 0..<min(all.count, 100) { result.append(all.object(at: i)) }
        let snapshot = result
        await MainActor.run { assets = snapshot; browsingAllPhotos = true }
    }

    private func loadThumb(_ asset: PHAsset) async {
        let id = asset.localIdentifier
        guard thumbs[id] == nil else { return }

        let size = CGSize(width: 300, height: 300)
        let opts = PHImageRequestOptions()
        opts.isNetworkAccessAllowed = true
        opts.deliveryMode = .opportunistic
        opts.resizeMode = .fast

        let img: UIImage? = await withCheckedContinuation { cont in
            PHImageManager.default().requestImage(
                for: asset, targetSize: size,
                contentMode: .aspectFill, options: opts
            ) { img, info in
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                if !degraded { cont.resume(returning: img) }
            }
        }
        if let img { await MainActor.run { thumbs[id] = img } }
    }

    private func fetchFullRes() {
        let toFetch = assets.filter { selected.contains($0.localIdentifier) }
        isFetching = true

        let opts = PHImageRequestOptions()
        opts.isNetworkAccessAllowed = true
        opts.deliveryMode = .highQualityFormat

        var result = [(Int, UIImage)]()
        let group  = DispatchGroup()

        for (i, asset) in toFetch.enumerated() {
            group.enter()
            PHImageManager.default().requestImage(
                for: asset, targetSize: PHImageManagerMaximumSize,
                contentMode: .aspectFit, options: opts
            ) { img, _ in
                if let img { result.append((i, img)) }
                group.leave()
            }
        }

        group.notify(queue: .main) {
            isFetching = false
            let ordered = result.sorted { $0.0 < $1.0 }.map(\.1)
            onPick(ordered)
            dismiss()
        }
    }
}
