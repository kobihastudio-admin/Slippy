import SwiftUI

// MARK: – View modifiers
extension View {
    func cardStyle() -> some View {
        self
            .background(Color.surface)
            .cornerRadius(16)
            .shadow(color: .black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    func sectionCard() -> some View {
        self
            .padding(16)
            .background(Color.surface)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.border, lineWidth: 1)
            )
    }
}

// MARK: – StatusBadge
struct StatusBadge: View {
    let status: String
    var body: some View {
        Text(statusLabel(status))
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(statusColor(for: status))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(statusColor(for: status).opacity(0.12))
            .clipShape(Capsule())
    }
}

private func statusLabel(_ status: String) -> String {
    switch status {
    case "pushed":    return "ส่งแล้ว"
    case "approved":  return "อนุมัติ"
    case "reviewing": return "ตรวจสอบ"
    case "processing":return "ประมวลผล"
    case "failed":    return "ผิดพลาด"
    case "rejected":  return "ปฏิเสธ"
    default:          return "รอดำเนินการ"
    }
}

// MARK: – Avatar with Initials
struct InitialsAvatar: View {
    let text: String
    var size: CGFloat = 44
    var color: Color  = .brand500

    var body: some View {
        ZStack {
            Circle().fill(color)
            Text(text)
                .font(.system(size: size * 0.35, weight: .heavy))
                .foregroundColor(.white)
        }
        .frame(width: size, height: size)
    }
}

// MARK: – Haptic feedback
func hapticLight()   { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
func hapticMedium()  { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
func hapticSuccess() { UINotificationFeedbackGenerator().notificationOccurred(.success) }

// MARK: – Notify the document's source (LINE etc.) of a status change
// Mirrors web's `POST /api/documents/[id]/notify-line` — same endpoint, same
// action strings ("approved" | "approved_pushed" | "rejected" | "deleted" | …),
// so both platforms push the identical message back to the uploader.
@MainActor
func notifyDocumentSource(documentId: String, action: String, authVM: AuthViewModel) async {
    guard let url = URL(string: "\(Config.webAppURL)/api/documents/\(documentId)/notify-line") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token = authVM.session?.accessToken {
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action])
    req.timeoutInterval = 30
    _ = try? await URLSession.shared.data(for: req)
}

// MARK: – Save image to the device Photo library
// NSPhotoLibraryAddUsageDescription is declared in Info.plist. Uses the
// add-only Photos API so we never request full library read access.
import Photos

enum PhotoSaver {
    enum SaveError: LocalizedError {
        case denied
        case failed(String)
        var errorDescription: String? {
            switch self {
            case .denied:          return "ไม่ได้รับสิทธิ์บันทึกรูปลงคลังภาพ — เปิดสิทธิ์ได้ในการตั้งค่า"
            case .failed(let msg): return "บันทึกรูปไม่สำเร็จ: \(msg)"
            }
        }
    }

    /// Saves an image to the user's Photos, requesting add-only permission if needed.
    static func save(_ image: UIImage) async throws {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        let granted: Bool
        switch status {
        case .authorized, .limited:
            granted = true
        case .notDetermined:
            granted = await withCheckedContinuation { cont in
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                    cont.resume(returning: newStatus == .authorized || newStatus == .limited)
                }
            }
        default:
            granted = false
        }
        guard granted else { throw SaveError.denied }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            } completionHandler: { success, error in
                if success { cont.resume() }
                else { cont.resume(throwing: SaveError.failed(error?.localizedDescription ?? "unknown")) }
            }
        }
    }
}

// MARK: – UIImage rotation
// For manually fixing photos that came in sideways/upside-down (common when
// a gallery photo's EXIF orientation doesn't match how the receipt itself
// was framed) — used by the rotate buttons in CameraPickerView's preview and
// CreateSplitView's ImageReviewSheet.
extension UIImage {
    /// Bakes `imageOrientation` into the pixel data and returns an `.up` image.
    /// `.cgImage` and `CIImage(cgImage:)` read the RAW sensor bitmap and ignore
    /// `imageOrientation`, so a portrait camera photo (EXIF `.right`) would come
    /// out sideways once it goes through the CoreImage enhance pass — and reads
    /// poorly in Vision OCR. Normalising up front fixes both. No-op when `.up`.
    func orientationNormalized() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: size)) }
    }

    func rotated(by degrees: CGFloat) -> UIImage {
        let radians = degrees * .pi / 180
        var newSize = CGRect(origin: .zero, size: size)
            .applying(CGAffineTransform(rotationAngle: radians)).size
        newSize.width = floor(newSize.width)
        newSize.height = floor(newSize.height)

        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { ctx in
            ctx.cgContext.translateBy(x: newSize.width / 2, y: newSize.height / 2)
            ctx.cgContext.rotate(by: radians)
            draw(in: CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height))
        }
    }
}

/// Lets a file URL drive `.sheet(item:)`.
///
/// A URL is already unique, so it is its own identity. Using `.sheet(item:)`
/// rather than `isPresented` matters here: the share sheet is built from the
/// item, so it cannot be presented before the file it shares exists.
extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// UIActivityViewController, for sharing a generated file.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension Double {
    /// Rounds to a fixed number of decimals.
    ///
    /// Shared rather than re-declared per file: money crosses into the database
    /// from several places here, and each one rounding its own way is how two
    /// figures that should agree stop agreeing.
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10.0, Double(places))
        return (self * factor).rounded() / factor
    }
}
