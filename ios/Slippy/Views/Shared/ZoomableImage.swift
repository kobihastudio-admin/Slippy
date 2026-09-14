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
