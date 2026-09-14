import UIKit
import UniformTypeIdentifiers
import PDFKit

// Share Extension — receives images/PDFs from Notes, Files, Photos, etc.
// Saves pages to the App Group shared container, then opens the main app.
final class ShareViewController: UIViewController {

    private let appGroupID  = "group.app.slippy.shared"
    private let pendingDir  = "pending_share"

    // MARK: – UI

    private lazy var spinner: UIActivityIndicatorView = {
        let v = UIActivityIndicatorView(style: .large)
        v.translatesAutoresizingMaskIntoConstraints = false
        v.color = UIColor(red: 0.4, green: 0.38, blue: 0.98, alpha: 1)
        return v
    }()
    private lazy var label: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "กำลังเตรียมเอกสาร…"
        l.textAlignment = .center
        l.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        l.textColor = .secondaryLabel
        return l
    }()
    private lazy var iconView: UIImageView = {
        let cfg = UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)
        let img = UIImage(systemName: "arrow.up.doc.fill", withConfiguration: cfg)
        let iv  = UIImageView(image: img)
        iv.translatesAutoresizingMaskIntoConstraints = false
        iv.tintColor = UIColor(red: 0.4, green: 0.38, blue: 0.98, alpha: 1)
        return iv
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        [iconView, spinner, label].forEach(view.addSubview)
        NSLayoutConstraint.activate([
            iconView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -48),
            spinner.topAnchor.constraint(equalTo: iconView.bottomAnchor, constant: 24),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
        spinner.startAnimating()
        Task { await processItems() }
    }

    // MARK: – Processing

    private func processItems() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            finish(success: false); return
        }

        var images: [UIImage] = []

        for item in items {
            for provider in (item.attachments ?? []) {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    if let img = await loadImage(provider) { images.append(img) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    images.append(contentsOf: await loadPDF(provider))
                }
            }
        }

        guard !images.isEmpty else { finish(success: false); return }
        saveImages(images)

        await MainActor.run {
            label.text = "กำลังเปิด Slippy…"
            openMainApp()
        }
    }

    private func loadImage(_ provider: NSItemProvider) async -> UIImage? {
        await withCheckedContinuation { (cont: CheckedContinuation<UIImage?, Never>) in
            provider.loadObject(ofClass: UIImage.self) { obj, _ in
                cont.resume(returning: obj as? UIImage)
            }
        }
    }

    private func loadPDF(_ provider: NSItemProvider) async -> [UIImage] {
        let url: URL? = await withCheckedContinuation { cont in
            provider.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { item, _ in
                cont.resume(returning: item as? URL)
            }
        }
        guard let url, let doc = PDFDocument(url: url) else { return [] }
        var pages: [UIImage] = []
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let scale: CGFloat = 2.0
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            let renderer = UIGraphicsImageRenderer(size: size)
            pages.append(renderer.image { ctx in
                UIColor.white.set()
                ctx.fill(CGRect(origin: .zero, size: size))
                let cg = ctx.cgContext
                cg.translateBy(x: 0, y: size.height)
                cg.scaleBy(x: scale, y: -scale)
                page.draw(with: .mediaBox, to: cg)
            })
        }
        return pages
    }

    // MARK: – Shared container I/O

    private func saveImages(_ images: [UIImage]) {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID) else { return }
        let dir = container.appendingPathComponent(pendingDir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Wipe previous pending batch
        (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?.forEach {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent($0))
        }
        for (i, img) in images.enumerated() {
            guard let data = img.jpegData(compressionQuality: 0.92) else { continue }
            try? data.write(to: dir.appendingPathComponent("\(i).jpg"))
        }
    }

    private func openMainApp() {
        guard let url = URL(string: "slippy://import-shared") else { finish(success: true); return }
        extensionContext?.open(url) { [weak self] _ in self?.finish(success: true) }
    }

    private func finish(success: Bool) {
        if success {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            extensionContext?.cancelRequest(withError: URLError(.cancelled))
        }
    }
}
