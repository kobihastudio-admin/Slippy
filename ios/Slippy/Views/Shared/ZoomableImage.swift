import SwiftUI

/// Pinch-to-zoom + pan + double-tap, for a local `UIImage` already in memory
/// (as opposed to `ReceiptImageViewer` in DocumentDetailView.swift, which
/// loads from a remote URL via AsyncImage) — same gesture logic, reused here
/// so CameraPickerView's "ตรวจสอบก่อนอัพโหลด" preview doesn't have to load
/// anything to let the user check a receipt's fine print before uploading.
struct ZoomableImage: View {
    let image: UIImage

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    SimultaneousGesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = max(1, min(5, lastScale * value))
                            }
                            .onEnded { _ in
                                lastScale = scale
                                if scale <= 1 {
                                    withAnimation(.easeOut(duration: 0.2)) {
                                        scale = 1; lastScale = 1
                                        offset = .zero; lastOffset = .zero
                                    }
                                } else {
                                    offset = clampedOffset(offset, scale: scale, in: geo.size)
                                    lastOffset = offset
                                }
                            },
                        DragGesture()
                            .onChanged { value in
                                guard scale > 1 else { return }
                                let proposed = CGSize(
                                    width: lastOffset.width + value.translation.width,
                                    height: lastOffset.height + value.translation.height
                                )
                                offset = clampedOffset(proposed, scale: scale, in: geo.size)
                            }
                            .onEnded { _ in lastOffset = offset }
                    )
                )
                .onTapGesture(count: 2) {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        if scale > 1 {
                            scale = 1; lastScale = 1
                            offset = .zero; lastOffset = .zero
                        } else {
                            scale = 2.5; lastScale = 2.5
                        }
                    }
                }
        }
    }

    /// Keeps pan offset within the bounds of the zoomed image so it can't be dragged off-screen.
    private func clampedOffset(_ proposed: CGSize, scale: CGFloat, in size: CGSize) -> CGSize {
        let maxX = max(0, (size.width * (scale - 1)) / 2)
        let maxY = max(0, (size.height * (scale - 1)) / 2)
        return CGSize(
            width: min(max(proposed.width, -maxX), maxX),
            height: min(max(proposed.height, -maxY), maxY)
        )
    }
}

/// Full-screen black backdrop wrapper, matching ReceiptImageViewer's look —
/// used as a `.fullScreenCover` so pinch/pan never competes with an outer
/// ScrollView's drag gesture.
struct ZoomableImageViewer: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ZoomableImage(image: image)
            VStack {
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 40, height: 40)
                            .background(.white.opacity(0.15))
                            .clipShape(Circle())
                    }
                    .padding(.trailing, 16).padding(.top, 8)
                }
                Spacer()
            }
        }
    }
}

/// Full-screen image viewer: pinch to zoom, drag when zoomed, double-tap to
/// toggle, swipe down or tap the close button to leave. Shows a remote photo
/// (`url`) or a bundled asset (`assetName`). `footer` adds actions, such as
/// "change photo", above the caption.
struct ProfileImageViewer<Footer: View>: View {
    var url: URL?
    var assetName: String?
    var title: String?
    private let footer: Footer

    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    init(url: URL? = nil, assetName: String? = nil, title: String? = nil, @ViewBuilder footer: () -> Footer) {
        self.url = url
        self.assetName = assetName
        self.title = title
        self.footer = footer()
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black.ignoresSafeArea()

                if let assetName {
                    zoomable(Image(assetName), in: geo.size)
                } else if let url {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            zoomable(image, in: geo.size)
                        case .failure:
                            VStack(spacing: 8) {
                                Image(systemName: "photo.badge.exclamationmark").font(.system(size: 40))
                                Text("โหลดรูปไม่สำเร็จ").font(.system(size: 14))
                            }
                            .foregroundColor(.white.opacity(0.8))
                        default:
                            ProgressView().tint(.white)
                        }
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                }

                VStack {
                    HStack {
                        Spacer()
                        Button {
                            reset()
                            ImageViewerOrientation.rotate(to: geo.size.width > geo.size.height ? .portrait : .landscape)
                        } label: {
                            Image(systemName: "rotate.right")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("สลับแนวหน้าจอ")
                        Button { dismiss() } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 30))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .white.opacity(0.28))
                        }
                        .accessibilityLabel("ปิด")
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    Spacer()
                    footer.padding(.bottom, 8)
                    if let title, !title.isEmpty {
                        Text(title)
                            .font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(.black.opacity(0.45), in: Capsule())
                            .padding(.bottom, 24)
                    }
                }
            }
            .onChange(of: geo.size) { _, _ in reset() }
        }
        .statusBarHidden()
        .onAppear { ImageViewerOrientation.open() }
        .onDisappear { ImageViewerOrientation.close() }
    }

    private func zoomable(_ image: Image, in size: CGSize) -> some View {
        image
            .resizable()
            .scaledToFit()
            .frame(width: size.width, height: size.height)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(zoomGesture(in: size))
            .onTapGesture(count: 2) {
                withAnimation(.easeInOut(duration: 0.25)) {
                    if scale > 1 { reset() } else { scale = 2.5; lastScale = 2.5 }
                }
            }
    }

    private func reset() {
        scale = 1; lastScale = 1
        offset = .zero; lastOffset = .zero
    }

    private func zoomGesture(in size: CGSize) -> some Gesture {
        SimultaneousGesture(
            MagnificationGesture()
                .onChanged { scale = max(1, min(5, lastScale * $0)) }
                .onEnded { _ in
                    lastScale = scale
                    if scale <= 1 { withAnimation(.easeOut(duration: 0.2)) { reset() } }
                    else { offset = clamped(offset, in: size); lastOffset = offset }
                },
            DragGesture()
                .onChanged { value in
                    if scale > 1 {
                        offset = clamped(CGSize(width: lastOffset.width + value.translation.width,
                                                height: lastOffset.height + value.translation.height), in: size)
                    } else if value.translation.height > 0 {
                        offset = CGSize(width: 0, height: value.translation.height)   // swipe-down feedback
                    }
                }
                .onEnded { value in
                    if scale <= 1 {
                        if value.translation.height > 120 { dismiss() }
                        else { withAnimation(.easeOut(duration: 0.2)) { offset = .zero } }
                    }
                    lastOffset = offset
                }
        )
    }

    private func clamped(_ proposed: CGSize, in size: CGSize) -> CGSize {
        let maxX = max(0, size.width * (scale - 1) / 2)
        let maxY = max(0, size.height * (scale - 1) / 2)
        return CGSize(width: min(max(proposed.width, -maxX), maxX), height: min(max(proposed.height, -maxY), maxY))
    }
}

extension ProfileImageViewer where Footer == EmptyView {
    init(url: URL? = nil, assetName: String? = nil, title: String? = nil) {
        self.init(url: url, assetName: assetName, title: title) { EmptyView() }
    }
}
