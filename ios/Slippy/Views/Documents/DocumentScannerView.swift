import SwiftUI
import VisionKit
import PDFKit
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// MARK: – Document Scanner (VisionKit)
//
// Replaces the old plain `UIImagePickerController` camera with Apple's native
// document scanner. This gives us, for free and at full hardware performance:
//   • Automatic edge / corner detection
//   • Automatic perspective ("keystone") correction & cropping
//   • Multi-page capture in one session
//   • Capture at the sensor's full resolution, optimised for flat documents
// All of which directly improves OCR/AI extraction accuracy downstream.
// ─────────────────────────────────────────────────────────────────────────────
/// Traces the scan → review handoff.
///
/// "Tap ✓ and nothing happens" has now come back five separate times, each with
/// a different cause (presenting before the host was in the window hierarchy, an
/// unbound dismiss closure, a handoff racing the cover teardown). Every one of
/// them looked identical from the outside and none left a trace, so each round
/// started from zero. This path stays instrumented: one run should now say which
/// hop is missing instead of costing another guess.
func scanLog(_ msg: String) {
    print("[scan-flow] \(msg)")
}

struct DocumentScannerView: UIViewControllerRepresentable {
    /// Closing goes through SwiftUI's `@Environment(\.dismiss)`, because callers
    /// present this via `.fullScreenCover(isPresented: $showScanner)`. Tearing
    /// the UIKit controller down on its own would leave `showScanner` stuck at
    /// `true`: SwiftUI would still believe the cover is up, and the
    /// quality alert / preview that `ingestScannedPages` shows after "Save"
    /// could never appear — the user is stranded with no way forward. Same class
    /// of bug that took down `CameraImagePicker`; same binding-driven fix.
    @Environment(\.dismiss) private var dismissAction

    /// Called with every page captured in the session, in order, once the
    /// user taps "Save". Empty array means the user cancelled.
    var onFinish: ([UIImage]) -> Void

    /// `VNDocumentCameraViewController.isSupported` reports `true` even on the
    /// Mac Simulator (Apple's API doesn't probe for a physical camera) — but
    /// actually presenting the scanner there fails at runtime with an
    /// "Unable to capture media" alert, since there's no camera hardware to
    /// back the capture session. Gate on the build target as well so the
    /// Simulator always falls through to the sample-document QA flow instead
    /// of showing a broken scanner sheet.
    static var isSupported: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return VNDocumentCameraViewController.isSupported
        #endif
    }

    /// An empty host. The scanner is *presented* from it rather than returned as
    /// the representable's own controller.
    ///
    /// `VNDocumentCameraViewController` drives its own capture session and
    /// internal navigation, and only starts them when it comes up through the
    /// normal modal-presentation path. Handed straight to `.fullScreenCover` as
    /// the cover's content it is merely *embedded*, and misbehaves in exactly
    /// the two ways reported: a blank screen with no live camera, or the review
    /// page from the previous scan instead of a fresh viewfinder. Presenting it
    /// ourselves — a brand-new instance per appearance — fixes both.
    func makeUIViewController(context: Context) -> ScannerHostController {
        let host = ScannerHostController()
        // Clear, never black: if presentation is ever delayed, the user sees the
        // sheet behind rather than a black wall.
        host.view.backgroundColor = .clear

        // Bind the dismissal HERE, not only in updateUIViewController. There is
        // no guarantee an update pass runs before the user finishes scanning,
        // and while this was unset it defaulted to an empty closure — so tapping
        // Save tore down the scanner, left `showScanner` true, and the flow
        // simply stopped with the cover still up.
        context.coordinator.dismiss = { dismissAction() }
        host.onReady = { [weak coordinator = context.coordinator] host in
            guard let coordinator, !coordinator.hasPresented else { return }
            coordinator.hasPresented = true

            let scanner = VNDocumentCameraViewController()
            scanner.delegate = coordinator
            scanner.modalPresentationStyle = .fullScreen
            coordinator.scanner = scanner
            host.present(scanner, animated: false)
        }
        return host
    }

    func updateUIViewController(_ host: ScannerHostController, context: Context) {
        // Keep the closure bound to the current environment.
        context.coordinator.dismiss = { dismissAction() }
    }

    /// Presents the scanner from `viewDidAppear`, not from
    /// `updateUIViewController`.
    ///
    /// This is what made the screen go black: presenting during the SwiftUI
    /// update pass happens before the host is in the window hierarchy, so UIKit
    /// silently refuses and the empty host is all that remains on screen. By
    /// `viewDidAppear` the host is guaranteed to be presentable.
    final class ScannerHostController: UIViewController {
        var onReady: ((ScannerHostController) -> Void)?
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            onReady?(self)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScannerView
        var dismiss: () -> Void = {}
        var hasPresented = false
        weak var scanner: VNDocumentCameraViewController?
        init(_ parent: DocumentScannerView) { self.parent = parent }

        /// Closes the scanner, then the SwiftUI cover (one binding-driven
        /// dismissal, so `showScanner` is reset), and only then hands the pages
        /// to the caller.
        ///
        /// The order is the whole point: `onFinish` typically wants to show
        /// something of its own (the quality alert, the review screen), and
        /// anything presented while this cover is still tearing down is silently
        /// swallowed — which is exactly how "tap Save and nothing happens"
        /// keeps coming back.
        private func close(then handoff: @escaping () -> Void) {
            let finish = dismiss
            guard let host = scanner?.presentingViewController else {
                scanLog("close: no presenting VC — closing cover directly")
                finish()      // nothing of ours is up — just close the cover
                handoff()
                return
            }
            scanLog("close: dismissing scanner from host")
            host.dismiss(animated: false) {
                scanLog("close: scanner dismissed → cover dismiss + handoff")
                finish()
                handoff()
            }
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                           didFinishWith scan: VNDocumentCameraScan) {
            var pages: [UIImage] = []
            pages.reserveCapacity(scan.pageCount)
            for i in 0..<scan.pageCount {
                // `imageOfPage` already returns the perspective-corrected,
                // cropped capture at full sensor resolution.
                pages.append(scan.imageOfPage(at: i))
            }
            scanLog("✓ tapped — scan.pageCount=\(scan.pageCount) pages=\(pages.count)")
            hapticSuccess()
            let onFinish = parent.onFinish
            close { onFinish(pages) }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            let onFinish = parent.onFinish
            close { onFinish([]) }
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                           didFailWithError error: Error) {
            print("[DocumentScanner] error:", error.localizedDescription)
            let onFinish = parent.onFinish
            close { onFinish([]) }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: – Image Quality Gate (on-device)
//
// Mirrors `api/src/pipeline/image-quality.ts` (same Laplacian-variance blur
// metric and brightness thresholds) but runs BEFORE upload, so a bad capture
// is caught while the receipt is still in front of the user instead of after a
// round-trip. Garbage in → garbage out: the ฿420 receipt that extracted as 523
// was degraded by glare, and no cloud model recovers from that.
// ─────────────────────────────────────────────────────────────────────────────
struct ImageQuality {
    let blurScore:  Double     // Laplacian variance — higher = sharper
    let brightness: Double     // mean luma 0…255
    /// How far the darkest text sits below the paper, in luma (0…255).
    /// See `isTooBright`.
    let inkContrast: Double
    let width:      Int
    let height:     Int

    // Thresholds kept in sync with image-quality.ts
    static let blurThreshold:   Double = 35
    static let darkThreshold:   Double = 40
    /// Below this paper-to-ink gap the text has been washed out beyond reading.
    /// Measured on simulated captures: solid black text ≈100, grey thermal ink
    /// ≈57, a faded old receipt under bright light ≈46, barely-legible ≈32,
    /// genuine glare ≈19. 25 clears every readable case and still catches glare.
    static let minInkContrast: Double = 25
    /// Shortest side below which Thai stops being readable.
    ///
    /// Was 700, and 700 let through the captures this check exists to stop: two
    /// 7-Eleven receipts came in at 762×800 and 908×778, cleared every gate on
    /// both the phone and the server, and came back with line items reading
    /// "ก๋วยสลอมหมอง" and "หนี้านริมลงตีแฟลร์". Digits survive far below the point
    /// where Thai does, so nothing downstream — including the model's own
    /// confidence — can tell that the words were invented. The only place this
    /// is cheap to fix is here, while the receipt is still in the user's hand.
    ///
    /// Kept equal to MIN_SHORT_SIDE in api/src/pipeline/image-quality.ts.
    static let minShortSide:    Int    = 1200

    var isBlurry:    Bool { blurScore  < Self.blurThreshold }
    var isTooDark:   Bool { brightness < Self.darkThreshold }
    /// Glare is only a problem when it has eaten the CONTRAST.
    ///
    /// Two earlier metrics both cried wolf on every photo. Mean brightness fires
    /// because a receipt IS white paper (a good shot averages 200–240). Counting
    /// pixels darker than a fixed level (150) fails for the opposite reason:
    /// thermal ink is grey, strokes are 2–3px wide, and downscaling averages
    /// them with the paper around them, so a perfectly readable bill scored 0.00%
    /// ink — the exact same score as real glare. An absolute cutoff cannot
    /// separate them at all.
    ///
    /// What survives glare is the GAP between paper and ink, which is a relative
    /// measurement and therefore immune to exposure, downscaling, and how much
    /// of the frame the receipt fills.
    var isTooBright: Bool { inkContrast < Self.minInkContrast }
    var isTooSmall:  Bool { min(width, height) < Self.minShortSide && width > 0 }

    /// User-facing Thai problems; empty means good enough to upload.
    var problems: [String] {
        var out: [String] = []
        if isBlurry    { out.append("ภาพเบลอ — จับกล้องให้นิ่งแล้วรอโฟกัส") }
        if isTooDark   { out.append("ภาพมืดเกินไป — หาที่ที่สว่างขึ้น") }
        if isTooBright { out.append("แสงสะท้อนจนตัวอักษรหาย — เอียงกระดาษเลี่ยงแสงตกกระทบตรงๆ") }
        if isTooSmall  { out.append("ความละเอียดต่ำ — ขยับกล้องเข้าใกล้ใบเสร็จ") }
        return out
    }

    var isAcceptable: Bool { problems.isEmpty }
}

enum ImageQualityChecker {
    /// Cheap enough to run inline on a background task (~512px grayscale pass).
    static func measure(_ image: UIImage) -> ImageQuality {
        let upright = image.orientationNormalized()
        guard let cg = upright.cgImage else {
            return ImageQuality(blurScore: 999, brightness: 128, inkContrast: 255, width: 0, height: 0)
        }
        let fullW = cg.width, fullH = cg.height

        // Downsample the long side to 512 — same as the server's resize.
        let maxSide = 512
        let ratio   = min(1.0, Double(maxSide) / Double(max(fullW, fullH, 1)))
        let w = max(1, Int(Double(fullW) * ratio))
        let h = max(1, Int(Double(fullH) * ratio))
        guard w >= 3, h >= 3 else {
            return ImageQuality(blurScore: 999, brightness: 128, inkContrast: 255, width: fullW, height: fullH)
        }

        var gray = [UInt8](repeating: 0, count: w * h)
        let drawn: Bool = gray.withUnsafeMutableBytes { raw -> Bool in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(data: base, width: w, height: h,
                                      bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue)
            else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else {
            return ImageQuality(blurScore: 999, brightness: 128, inkContrast: 255, width: fullW, height: fullH)
        }

        // Mean brightness + paper-to-ink contrast (see ImageQuality.isTooBright).
        // Percentiles come off a 256-bin histogram — one pass, no sorting.
        var lumaSum = 0
        var hist = [Int](repeating: 0, count: 256)
        for v in gray {
            lumaSum += Int(v)
            hist[Int(v)] += 1
        }
        let brightness = Double(lumaSum) / Double(gray.count)

        /// Luma at percentile `p` of the frame.
        func level(_ p: Double) -> Double {
            let target = max(1, Int(Double(gray.count) * p))
            var acc = 0
            for (v, count) in hist.enumerated() {
                acc += count
                if acc >= target { return Double(v) }
            }
            return 255
        }
        // p05 = the darkest strokes, p90 = the paper. Both ignore outliers, so a
        // single dark shadow or one blown highlight can't decide the verdict.
        let inkContrast = gray.isEmpty ? 255 : level(0.90) - level(0.05)

        // Laplacian variance with kernel [0,-1,0, -1,4,-1, 0,-1,0].
        // Clamped to 0…255 to match sharp's uint8 convolve output, so the
        // server's BLUR_THRESHOLD stays directly comparable.
        var sum = 0.0, sumSq = 0.0, n = 0.0
        for y in 1..<(h - 1) {
            let row = y * w
            for x in 1..<(w - 1) {
                let i = row + x
                let v = 4.0 * Double(gray[i])
                    - Double(gray[i - 1]) - Double(gray[i + 1])
                    - Double(gray[i - w]) - Double(gray[i + w])
                let c = min(255.0, max(0.0, v))
                sum += c; sumSq += c * c; n += 1
            }
        }
        let mean     = n > 0 ? sum / n : 0
        let variance = n > 0 ? max(0, sumSq / n - mean * mean) : 999
        let blurScore = (variance * 100).rounded() / 100

        return ImageQuality(blurScore: blurScore, brightness: brightness,
                            inkContrast: inkContrast, width: fullW, height: fullH)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: – OCR Image Enhancer
//
// A lightweight CoreImage pipeline tuned for scanned documents/receipts:
//   1. Boost contrast & slightly reduce brightness/saturation so faint
//      thermal-printer text becomes crisper for OCR
//   2. Sharpen luminance to recover edge detail lost in JPEG/sensor noise
//   3. Re-render at native scale into a clean, orientation-corrected UIImage
//
// Runs on a background queue via `Task.detached` so the UI never stutters
// even with multi-page scans.
// ─────────────────────────────────────────────────────────────────────────────
enum DocumentEnhancer {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    static func enhance(_ image: UIImage) -> UIImage {
        // CIImage(cgImage:) ignores imageOrientation, so a portrait camera photo
        // (EXIF .right) would be flattened sideways. Bake orientation in first.
        let image = image.orientationNormalized()
        guard let cg = image.cgImage else { return image }
        var ciImage = CIImage(cgImage: cg)

        // 1) Contrast / brightness tuned for printed documents & receipts
        let colorControls = CIFilter.colorControls()
        colorControls.inputImage = ciImage
        colorControls.contrast   = 1.12
        colorControls.brightness = 0.02
        colorControls.saturation = 1.0
        if let out = colorControls.outputImage { ciImage = out }

        // 2) Luminance sharpening — recovers fine text edges for OCR
        let sharpen = CIFilter.sharpenLuminance()
        sharpen.inputImage = ciImage
        sharpen.sharpness  = 0.55
        sharpen.radius     = 1.6
        if let out = sharpen.outputImage { ciImage = out }

        // 3) Mild noise reduction to avoid amplifying sensor grain after sharpening
        let noiseReduction = CIFilter.noiseReduction()
        noiseReduction.inputImage   = ciImage
        noiseReduction.noiseLevel   = 0.012
        noiseReduction.sharpness    = 0.4
        if let out = noiseReduction.outputImage { ciImage = out }

        guard let outCG = context.createCGImage(ciImage, from: ciImage.extent) else { return image }
        return UIImage(cgImage: outCG, scale: image.scale, orientation: .up)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: – PDF Renderer
//
// Rasterises every page of an imported PDF at high DPI so text stays crisp
// once it goes through the same enhancement pipeline as camera scans.
// `scale: 2.0` ≈ 144dpi which is comfortably above the ~120dpi threshold most
// OCR engines need for reliable small-font recognition.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MARK: – Sample Document Generator (Simulator testing aid)
//
// `VNDocumentCameraViewController.isSupported` is `false` on the Mac
// Simulator (no physical camera), so the scanner sheet would just present a
// black screen. Rather than block testing of the capture → enhance → upload
// pipeline on the Simulator, we synthesise a clean "receipt-like" document
// image on demand that flows through exactly the same code path as a real
// scan — keeping Simulator-based QA fully representative of on-device
// behaviour for everything downstream of the capture step.
// ─────────────────────────────────────────────────────────────────────────────
enum SampleDocumentGenerator {
    static func makeReceipt() -> UIImage {
        let size = CGSize(width: 1240, height: 1754) // ~A4 @150dpi portrait
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            let cg = ctx.cgContext
            UIColor.white.setFill()
            cg.fill(CGRect(origin: .zero, size: size))

            let margin: CGFloat = 90
            var y: CGFloat = 110

            func draw(_ text: String, size fontSize: CGFloat, weight: UIFont.Weight = .regular,
                      color: UIColor = .black, align: NSTextAlignment = .left, gap: CGFloat = 14) {
                let para = NSMutableParagraphStyle()
                para.alignment = align
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: fontSize, weight: weight),
                    .foregroundColor: color,
                    .paragraphStyle: para
                ]
                let rect = CGRect(x: margin, y: y, width: size.width - margin * 2, height: fontSize * 1.6)
                (text as NSString).draw(in: rect, withAttributes: attrs)
                y += fontSize * 1.6 + gap
            }

            draw("ใบเสร็จรับเงิน / RECEIPT", size: 40, weight: .bold, align: .center, gap: 28)
            draw("บริษัท Demo จำกัด (สำนักงานใหญ่)", size: 24, align: .center)
            draw("เลขประจำตัวผู้เสียภาษี 0-1055-58009-xx-x", size: 18, color: .darkGray, align: .center, gap: 36)

            cg.setStrokeColor(UIColor.lightGray.cgColor)
            cg.setLineWidth(2)
            cg.move(to: CGPoint(x: margin, y: y))
            cg.addLine(to: CGPoint(x: size.width - margin, y: y))
            cg.strokePath()
            y += 32

            draw("เลขที่ใบเสร็จ: SIM-2026-0607",  size: 20)
            draw("วันที่: 7 มิถุนายน 2569",        size: 20, gap: 32)

            let items: [(String, String)] = [
                ("ค่าบริการที่ปรึกษาบัญชี",  "3,500.00"),
                ("ค่าซอฟต์แวร์รายเดือน",     "990.00"),
                ("ค่าธรรมเนียมธนาคาร",      "35.00")
            ]
            for (name, price) in items {
                let para = NSMutableParagraphStyle(); para.alignment = .left
                (name as NSString).draw(
                    in: CGRect(x: margin, y: y, width: size.width * 0.6, height: 32),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 20), .paragraphStyle: para])
                let paraR = NSMutableParagraphStyle(); paraR.alignment = .right
                (("฿" + price) as NSString).draw(
                    in: CGRect(x: size.width * 0.55, y: y, width: size.width * 0.45 - margin, height: 32),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 20, weight: .medium), .paragraphStyle: paraR])
                y += 44
            }

            y += 16
            cg.move(to: CGPoint(x: margin, y: y))
            cg.addLine(to: CGPoint(x: size.width - margin, y: y))
            cg.strokePath()
            y += 32

            draw("รวมทั้งสิ้น: ฿4,525.00", size: 26, weight: .bold, align: .right, gap: 60)
            draw("— เอกสารตัวอย่างที่สร้างขึ้นสำหรับทดสอบบน Simulator —",
                 size: 15, color: .gray, align: .center)
        }
    }
}

enum PDFRenderer {
    static func renderPages(at url: URL, scale: CGFloat = 2.0) -> [UIImage] {
        guard let document = PDFDocument(url: url) else { return [] }
        var images: [UIImage] = []
        images.reserveCapacity(document.pageCount)

        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)

            let renderer = UIGraphicsImageRenderer(size: size)
            let img = renderer.image { ctx in
                UIColor.white.set()
                ctx.fill(CGRect(origin: .zero, size: size))

                let cgContext = ctx.cgContext
                cgContext.translateBy(x: 0, y: size.height)
                cgContext.scaleBy(x: scale, y: -scale)
                page.draw(with: .mediaBox, to: cgContext)
            }
            images.append(img)
        }
        return images
    }
}
