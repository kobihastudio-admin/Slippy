import SwiftUI
import PhotosUI
import VisionKit
import CoreImage
import CoreImage.CIFilterBuiltins
import UniformTypeIdentifiers

/// Adds documents and gets out of the way.
///
/// This screen used to keep a "ตรวจสอบก่อนอัพโหลด" stage that uploaded in the
/// background and then polled the server for up to four minutes while the user
/// watched — and leaving that stage deleted the document they had just taken.
/// The reading takes as long as it takes; making a person sit through it was
/// never buying them anything, because every field is editable afterwards in
/// DocumentDetailView anyway.
///
/// So capture now ends at capture: enhance, upload, hand the ids to
/// `UploadTracker`, dismiss. The dashboard shows the progress and announces the
/// outcome — including a document the server declines as non-financial, which
/// the old in-screen poll could not even recognise (it waited on
/// `extracted_at`, which a rejected document never gets).
struct CameraPickerView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    /// Called after a successful upload so the parent can refresh itself.
    /// Progress and outcome now come from `UploadTracker.shared`, so this is
    /// only a "something was added" nudge, not a completion signal.
    var onUploadSuccess: (() -> Void)? = nil

    @State private var showPhotoPicker    = false
    @State private var showScanner        = false
    /// Regenerated on every open so the document scanner is rebuilt from
    /// scratch — a reused VNDocumentCameraViewController comes back showing
    /// the previous session's captured page instead of a live camera.
    @State private var scannerSession     = UUID()
    @State private var showFileImport     = false
    @State private var showNotesScan      = false
    @State private var showGallery        = false
    @State private var showPlainCamera    = false
    @ObservedObject private var gallery   = GalleryStore.shared
    @State private var photoItems: [PhotosPickerItem] = []
    /// Cap on gallery multi-select — keeps concurrent on-device image
    /// enhancement (CIFilter on full-res photos) and the sequential
    /// per-image upload loop from overloading the device.
    private let maxGalleryPickCount = 10

    @State private var isEnhancing        = false
    @State private var isUploading        = false
    @State private var showSimulatorHint  = false
    @State private var error: String?

    // Quality gate — pages held back pending the user's "ถ่ายใหม่ / ใช้รูปนี้" choice
    @State private var pendingLowQualityPages: [UIImage]?
    @State private var lowQualityProblems: [String] = []

    var body: some View {
        NavigationStack {
            selectModeView
                .navigationTitle("เพิ่มเอกสาร")
                .navigationBarTitleDisplayMode(.inline)
                .slippyLoading(isEnhancing || isUploading,
                               message: isUploading ? "กำลังอัพโหลดเอกสาร..." : "กำลังปรับคุณภาพรูป...")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("ยกเลิก") { dismiss() }
                            .foregroundColor(Color.brand500)
                            .disabled(isEnhancing || isUploading)
                    }
                }
                .fullScreenCover(isPresented: $showScanner) {
                    DocumentScannerView { scannedPages in
                        Task { await ingestScannedPages(scannedPages) }
                    }
                    .id(scannerSession)
                    .ignoresSafeArea()
                }
                .fullScreenCover(isPresented: $showGallery) {
                    GalleryView().environmentObject(authVM)
                }
                .sheet(isPresented: $showNotesScan) {
                    NotesScansPickerView { picked in
                        Task { await ingestScannedPages(picked) }
                    }
                    .environmentObject(authVM)
                }
                .fileImporter(isPresented: $showFileImport,
                              allowedContentTypes: [.pdf, .image]) { result in
                    if case .success(let url) = result { handleFile(url: url) }
                }
                .alert("กล้องไม่พร้อมใช้งานบน Simulator", isPresented: $showSimulatorHint) {
                    Button("ใช้ภาพตัวอย่างทดสอบ") {
                        Task { await ingestScannedPages([SampleDocumentGenerator.makeReceipt()]) }
                    }
                    Button("เลือกจากคลังภาพแทน", role: .cancel) { showPhotoPicker = true }
                } message: {
                    Text("Simulator บน Mac ไม่มีกล้องจริง ระบบจะสร้างภาพเอกสารตัวอย่างให้ทดสอบได้ทันที")
                }
                .alert("อัพโหลดไม่สำเร็จ", isPresented: Binding(
                    get: { error != nil },
                    set: { if !$0 { error = nil } }
                )) {
                    Button("ตกลง", role: .cancel) { error = nil }
                } message: {
                    Text(error ?? "")
                }
                .photosPicker(isPresented: $showPhotoPicker, selection: $photoItems,
                              maxSelectionCount: maxGalleryPickCount, matching: .images)
        }
        .interactiveDismissDisabled(isEnhancing || isUploading)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                // Load sequentially (cheap I/O — the heavy CIFilter work happens
                // later in performIngest, which bounds its own concurrency).
                var images: [UIImage] = []
                for item in items {
                    guard let data  = try? await item.loadTransferable(type: Data.self),
                          let image = UIImage(data: data) else { continue }
                    images.append(image)
                }
                photoItems = []
                guard !images.isEmpty else { return }
                await ingestScannedPages(images)
            }
        }
    }

    // MARK: – Select Mode (compact icon-grid, matches reference mockup)

    private var selectModeView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("เลือกวิธีเพิ่มเอกสาร")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                    Text("เลือกแล้วระบบจะอัพโหลดให้ทันที แล้วอ่านต่อเบื้องหลัง")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 16) {
                    methodTile(icon: "camera.fill", label: "กล้องถ่ายรูป", sub: "ถ่ายเอกสารทันที",
                               bg: Color(hex: "#ede9fe"), fg: Color(hex: "#7c3aed")) {
                        hapticLight()
                        if UIImagePickerController.isSourceTypeAvailable(.camera) { showPlainCamera = true }
                        else { showSimulatorHint = true }
                    }
                    methodTile(icon: "viewfinder", label: "สแกนเอกสาร", sub: "สแกนด้วยเครื่อง",
                               bg: Color(hex: "#dbeafe"), fg: Color(hex: "#2563eb")) {
                        hapticLight()
                        if DocumentScannerView.isSupported { scannerSession = UUID(); showScanner = true }
                        else { showSimulatorHint = true }
                    }
                    methodTile(icon: "photo.fill", label: "เลือกจากแกลเลอรี", sub: "รูปภาพในเครื่อง",
                               bg: Color(hex: "#dcfce7"), fg: Color(hex: "#16a34a")) {
                        hapticLight()
                        showPhotoPicker = true
                    }
                    methodTile(icon: "folder.fill", label: "ไฟล์จากอุปกรณ์", sub: "เลือกไฟล์ที่บันทึกไว้",
                               bg: Color(hex: "#ffedd5"), fg: Color(hex: "#ea580c")) {
                        hapticLight()
                        showFileImport = true
                    }
                    methodTile(icon: "tray.full.fill", label: "คลังพัก",
                               sub: gallery.count > 0 ? "\(gallery.count) รายการรอส่ง" : "พักไว้ส่งทีหลัง",
                               bg: Color(hex: "#e0e7ff"), fg: Color(hex: "#4f46e5")) {
                        hapticLight()
                        showGallery = true
                    }
                }

                Button {
                    hapticLight()
                    showNotesScan = true
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "note.text").font(.system(size: 14))
                        // Was "ดึงเอกสารที่สแกนไว้จาก Apple Notes", which promised
                        // something iOS does not allow: there is no API to read
                        // Notes, and this button opened a photo-library picker.
                        Text("นำเข้าจาก Apple Notes")
                            .font(.system(size: 13, weight: .medium))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(Color.brand500)
                    .padding(14)
                    .background(Color.brand500.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }

                afterUploadHint
            }
            .padding(20)
        }
        .background(Color.background)
        .fullScreenCover(isPresented: $showPlainCamera) {
            // CameraImagePicker dismisses itself via @Environment(\.dismiss),
            // which resets this binding for us. Do NOT also set
            // showPlainCamera = false here — that fires a second dismissal for
            // one presentation and SwiftUI takes the parent sheet down with it
            // (the whole add-document screen vanished on "Use Photo").
            CameraImagePicker { img in
                Task { await ingestScannedPages([img]) }
            }
            .ignoresSafeArea()
        }
        .alert("คุณภาพรูปอาจไม่พอ", isPresented: Binding(
            get: { pendingLowQualityPages != nil },
            set: { if !$0 { pendingLowQualityPages = nil } }
        )) {
            Button("ถ่ายใหม่", role: .cancel) {
                pendingLowQualityPages = nil
                lowQualityProblems = []
            }
            Button("ใช้รูปนี้") {
                let pages = pendingLowQualityPages ?? []
                pendingLowQualityPages = nil
                lowQualityProblems = []
                Task { await performIngest(pages) }
            }
        } message: {
            Text(lowQualityProblems.joined(separator: "\n")
                 + "\n\nรูปที่ไม่ชัดทำให้ AI อ่านตัวเลขผิดได้ แนะนำให้ถ่ายใหม่")
        }
    }

    /// Sets the expectation before the upload rather than after it, so nobody
    /// goes looking for a review step that no longer exists.
    private var afterUploadHint: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 13))
                .foregroundColor(Color.brand500)
            VStack(alignment: .leading, spacing: 3) {
                Text("อัพโหลดแล้วกลับหน้าหลักได้เลย")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Text("ระบบจะอ่านเอกสารให้เบื้องหลัง แล้วอัพเดทข้อมูลที่หน้าหลักเมื่อเสร็จ "
                     + "แก้ชื่อร้าน หมวดหมู่ แท็ก หรือแชร์ได้ในหน้ารายละเอียดเอกสาร")
                    .font(.system(size: 11.5))
                    .foregroundColor(Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
    }

    private func methodTile(icon: String, label: String, sub: String, bg: Color, fg: Color,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle().fill(bg).frame(width: 56, height: 56)
                    Image(systemName: icon).font(.system(size: 20)).foregroundColor(fg)
                }
                VStack(spacing: 2) {
                    Text(label)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(sub)
                        .font(.system(size: 9.5))
                        .foregroundColor(Color.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PressScaleStyle())
    }

    // MARK: – Ingest pipeline

    /// Quality gate — check the capture BEFORE enhancing/uploading so a blurry,
    /// dark or glare-blown shot is caught while the receipt is still in hand.
    /// Mirrors the server's image-quality thresholds. The user can always
    /// override ("ใช้รูปนี้") — we advise, never block.
    private func ingestScannedPages(_ raw: [UIImage]) async {
        scanLog("ingestScannedPages: received \(raw.count) page(s)")
        guard !raw.isEmpty else {
            // Also the cancel path (onFinish([])), so it is not automatically a
            // bug — but if the user tapped ✓ and this is the last line logged,
            // the scanner handed back zero pages and the app did nothing at all.
            scanLog("ingestScannedPages: 0 pages — nothing to do, returning")
            return
        }

        guard let first = raw.first else { return }
        let quality = await Task.detached(priority: .userInitiated) {
            ImageQualityChecker.measure(first)
        }.value
        scanLog("quality: blur=\(quality.blurScore) bright=\(Int(quality.brightness)) "
                + "inkContrast=\(Int(quality.inkContrast)) \(quality.width)x\(quality.height) "
                + "→ acceptable=\(quality.isAcceptable) problems=\(quality.problems.count)")

        if !quality.isAcceptable {
            scanLog("branch: showing quality alert, waiting for user")
            await MainActor.run {
                pendingLowQualityPages = raw
                lowQualityProblems     = quality.problems
                hapticMedium()
            }
            return   // wait for the user's choice in the alert
        }

        scanLog("branch: quality ok → performIngest")
        await performIngest(raw)
    }

    /// Enhances the capture, reads whatever deterministic facts are printed on
    /// it, then uploads and leaves.
    private func performIngest(_ raw: [UIImage]) async {
        scanLog("performIngest: enter with \(raw.count) page(s)")
        guard !raw.isEmpty else { scanLog("performIngest: empty, returning"); return }
        isEnhancing = true

        // Bounded concurrency — enhancing many full-res photos at once (CIFilter)
        // can spike memory on older devices, so only a few run in parallel
        // regardless of how many images were picked.
        //
        // QR decoding rides along in the same bounded pass. It used to run
        // lazily, driven by the preview pager, which meant only the page the
        // user happened to look at contributed its QR facts; every other page
        // uploaded without the exact 13-digit tax id printed on it.
        let maxConcurrentEnhance = 3
        let prepared = await withTaskGroup(of: (Int, UIImage, SlipExtraction).self) { group -> [(UIImage, SlipExtraction)] in
            var results = [Int: (UIImage, SlipExtraction)]()
            var nextIndex = 0
            func enqueueNext() {
                guard nextIndex < raw.count else { return }
                let i = nextIndex
                nextIndex += 1
                group.addTask {
                    // Read the barcode from the UNTOUCHED capture, not from the
                    // enhanced copy. DocumentEnhancer raises contrast and applies
                    // an unsharp mask tuned for text strokes, which is the wrong
                    // treatment for a QR: it thickens modules until adjacent ones
                    // bleed together. A HomePro e-Tax Invoice QR that Vision reads
                    // fine off the raw frame could not be decoded at all from the
                    // enhanced, resized, re-compressed page.
                    let facts = SlipOCRService.quickFacts(from: raw[i])
                    return (i, DocumentEnhancer.enhance(raw[i]), facts)
                }
            }
            for _ in 0..<min(maxConcurrentEnhance, raw.count) { enqueueNext() }
            while let (i, img, facts) = await group.next() {
                results[i] = (img, facts)
                enqueueNext()
            }
            return (0..<raw.count).compactMap { results[$0] }
        }

        scanLog("performIngest: prepared \(prepared.count) page(s) → uploading")
        isEnhancing = false
        await upload(prepared)
    }

    // MARK: – Upload

    /// Uploads every page as its own document, hands the ids to `UploadTracker`
    /// and dismisses. Only the network round-trip blocks the screen (~1–3s);
    /// the AI read that follows is the tracker's problem, not the user's.
    private func upload(_ prepared: [(UIImage, SlipExtraction)]) async {
        guard !isUploading, !prepared.isEmpty,
              let orgId  = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString
        else { return }

        isUploading = true
        defer { isUploading = false }
        error = nil
        hapticLight()

        let batchStamp = Date().timeIntervalSince1970
        var uploadedIds: [String] = []

        do {
            for (index, page) in prepared.enumerated() {
                let (img, facts) = page
                guard let data = img.jpegData(compressionQuality: 0.94) else { continue }
                guard data.count <= 20 * 1024 * 1024 else {  // matches api/'s multipart limit
                    throw NSError(domain: "Slippy", code: 413, userInfo: [
                        NSLocalizedDescriptionKey: "ไฟล์รูปที่ \(index + 1) มีขนาดใหญ่เกิน 20MB"
                    ])
                }
                let suffix   = prepared.count > 1 ? "_p\(index + 1)" : ""
                let fileName = "\(userId)_\(batchStamp)\(suffix).jpg"
                let path     = "\(orgId)/\(fileName)"

                try await SupabaseManager.shared.client
                    .storage.from(Config.storageBucket)
                    .upload(path, data: data, options: .init(upsert: false))

                // Deterministic QR facts only. Everything else is the server's
                // job — the document lands as "processing" and the pipeline
                // fills it in, which is exactly what the tracker waits for.
                var record: [String: AnyEncodable] = [
                    "organization_id": AnyEncodable(orgId),
                    "uploaded_by":     AnyEncodable(userId),
                    "file_path":       AnyEncodable(path),
                    "file_type":       AnyEncodable("jpg"),
                    "source":          AnyEncodable("mobile"),
                    "status":          AnyEncodable("processing"),
                    "doc_type":        AnyEncodable(facts.docType),
                ]
                // A 13-digit run is not a tax id. One restaurant receipt reached
                // production carrying "0000000000000", which passes any length
                // check and, as a merchant key, silently merges unrelated shops.
                if let tax = facts.qr?.taxId, ThaiTaxID.isValid(tax) {
                    record["vendor_tax_id"] = AnyEncodable(tax)
                }
                if let ref = facts.qr?.invoiceRef { record["doc_number"]   = AnyEncodable(ref) }
                if let amt = facts.qr?.amount     { record["total_amount"] = AnyEncodable(amt) }

                let inserted: [SlippyDocument] = try await SupabaseManager.shared.client
                    .from("documents").insert(record).select().execute().value

                if let docId = inserted.first?.id {
                    uploadedIds.append(docId)
                    try? await triggerServerOCR(documentId: docId, facts: facts)
                }
            }
        } catch {
            self.error = error.localizedDescription
            // Whatever did upload is real and already being read — track it
            // rather than abandoning it, and stay on this screen so the user
            // sees which part failed.
            if !uploadedIds.isEmpty {
                UploadTracker.shared.track(documentIds: uploadedIds)
                onUploadSuccess?()
            }
            return
        }

        guard !uploadedIds.isEmpty else { return }
        UploadTracker.shared.track(documentIds: uploadedIds)
        hapticSuccess()
        dismiss()
        onUploadSuccess?()
    }

    /// Triggers the same server-side AI pipeline the web app uses.
    ///
    /// No on-device OCR hint is sent. It used to be injected into the model's
    /// prompt as a "second OCR reading", but Apple Vision's reading of a receipt
    /// was routinely wrong (vendor "GATEAUX HOUSE" → "STEAD"), and a wrong hint
    /// doesn't just fail to help — it drags the model toward the wrong answer.
    ///
    /// A Bill-Payment QR (tax invoice) is different: it yields an EXACT 13-digit
    /// Tax ID, and often the invoice ref and amount. Those go up as
    /// `userConfirmed` so the pipeline keeps them instead of overwriting them
    /// with its own (fallible) OCR.
    private func triggerServerOCR(documentId: String, facts: SlipExtraction) async throws {
        guard let url = URL(string: "\(Config.webAppURL)/api/documents/\(documentId)/process") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = authVM.session?.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.timeoutInterval = 30

        struct Body: Encodable {
            let localOcrHint: LocalOcrHintPayload?
            let userConfirmed: UserConfirmedPayload?
            /**
             * The barcode payload exactly as printed, whatever kind it is.
             *
             * Until now only EMVCo Bill-Payment QRs went anywhere: their tax id,
             * reference and amount were extracted and everything else was
             * dropped on the floor. But Thai receipts increasingly carry a
             * different QR — HomePro prints one labelled
             * "SCAN QR เพื่อออกใบกำกับภาษีเต็มรูปแบบ" — which points at the
             * merchant's own e-Tax Invoice. That is authoritative structured
             * data straight from the seller's system, and the app was throwing
             * the pointer to it away because it did not parse as EMVCo.
             *
             * Sent raw and unparsed on purpose: nothing is acted on yet. The
             * first thing to find out is what these actually contain, from real
             * receipts, before deciding what if anything to do with them.
             */
            let qrRaw: String?
        }
        struct UserConfirmedPayload: Encodable {
            let vendor_name: String?
            let doc_type: String
            let doc_number: String?
            let doc_date: String?
            let subtotal: Double?
            let vat_amount: Double?
            let wht_amount: Double?
            let total_amount: Double?
            let payment_method: String?
            let expense_category: String?
            let vendor_tax_id: String?
        }

        // Only a checksum-valid tax id is worth asserting to the pipeline —
        // `userConfirmed` tells it to KEEP the value rather than re-read it.
        let qrTaxId = ThaiTaxID.isValid(facts.qr?.taxId) ? facts.qr?.taxId : nil
        let confirmedPayload: UserConfirmedPayload? = qrTaxId == nil ? nil : UserConfirmedPayload(
            vendor_name:      nil,
            doc_type:         facts.docType,
            doc_number:       facts.qr?.invoiceRef,
            doc_date:         nil,
            subtotal:         nil,
            vat_amount:       nil,
            wht_amount:       nil,
            total_amount:     facts.qr?.amount,
            payment_method:   nil,
            expense_category: nil,
            vendor_tax_id:    qrTaxId
        )

        req.httpBody = try? JSONEncoder().encode(
            Body(localOcrHint: nil, userConfirmed: confirmedPayload, qrRaw: facts.qr?.raw)
        )

        _ = try? await URLSession.shared.data(for: req)
    }

    // MARK: – PDF / file import

    private func handleFile(url: URL) {
        guard url.pathExtension.lowercased() == "pdf" else {
            if let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
                Task { await ingestScannedPages([img]) }
            }
            return
        }
        Task {
            isEnhancing = true
            let rendered = PDFRenderer.renderPages(at: url, scale: 2.0)
            isEnhancing = false
            await ingestScannedPages(rendered)
        }
    }
}

// MARK: – Press scale button style
private struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.2), value: configuration.isPressed)
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return CameraPickerView().environmentObject(vm)
}
#endif
