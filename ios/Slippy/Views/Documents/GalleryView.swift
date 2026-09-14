import SwiftUI
import PhotosUI

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * GalleryView — คลังพักเอกสาร
 * =====================================================================
 * A staging inbox: scan or import document images to hold on-device, pre-tag a
 * category, then select and commit them into the system whenever you're ready.
 * Staging is 100% local ([[GalleryStore]]); only "ส่งเข้าระบบ" touches Supabase
 * — reusing the exact upload path (storage → documents insert → /process) the
 * normal add-document flow uses.
 */
struct GalleryView: View {
    @EnvironmentObject private var authVM: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @ObservedObject private var store = GalleryStore.shared
    @StateObject private var categoriesVM = DocumentCategoriesViewModel()

    @State private var isSelecting = false
    @State private var selection: Set<String> = []
    @State private var isCommitting = false
    @State private var committedCount = 0
    @State private var errorMessage: String?

    // Capture / import
    @State private var showScanner = false
    /// Regenerated on every open so the scanner is rebuilt from scratch.
    @State private var scannerSession = UUID()
    @State private var showSimulatorHint = false
    @State private var photoItems: [PhotosPickerItem] = []

    // Per-item detail
    @State private var detailItem: GalleryItem?
    @State private var categoryTargetItem: GalleryItem?

    // Export (ดาวน์โหลด) — Photos album, or anywhere via the system share sheet
    // (which is also how "Save to Files" / a folder is reached on iOS).
    @State private var shareItems: [Any] = []
    @State private var showShareSheet = false
    @State private var isSavingToPhotos = false
    @State private var exportNotice: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        NavigationStack {
            Group {
                if store.items.isEmpty { emptyState }
                else                   { grid }
            }
            .background(Color.background)
            .navigationTitle("คลังพักเอกสาร")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .safeAreaInset(edge: .bottom) { bottomBar }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScannerView { images in
                    guard !images.isEmpty else { return }
                    _ = store.add(images: images, source: "scan")
                }
                // Fresh identity per presentation. Without it SwiftUI reuses the
                // representable (and therefore the same VNDocumentCameraViewController),
                // which comes back still showing the previous session's captured
                // page instead of a live camera.
                .id(scannerSession)
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: photoPickerBinding, selection: $photoItems, matching: .images)
            .sheet(item: $detailItem) { item in itemDetailSheet(item) }
            .sheet(isPresented: $showShareSheet) {
                ActivityShareSheet(items: shareItems)
            }
            .alert("ดาวน์โหลด", isPresented: Binding(
                get: { exportNotice != nil }, set: { if !$0 { exportNotice = nil } })) {
                Button("ตกลง", role: .cancel) { exportNotice = nil }
            } message: { Text(exportNotice ?? "") }
            .confirmationDialog("เลือกหมวดหมู่", isPresented: categoryDialogBinding, titleVisibility: .visible) {
                if let target = categoryTargetItem {
                    ForEach(categoriesVM.categories) { cat in
                        Button(cat.name) { store.setCategory(cat.name, for: target) }
                    }
                    Button("ไม่มีหมวดหมู่", role: .destructive) { store.setCategory(nil, for: target) }
                }
            }
            .alert("เกิดข้อผิดพลาด", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("ตกลง", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
            .alert("กล้องไม่พร้อมใช้งานบน Simulator", isPresented: $showSimulatorHint) {
                Button("ตกลง", role: .cancel) {}
            } message: {
                Text("Simulator ไม่มีกล้องจริง — ใช้ 'ดึงจาก Photos' เพื่อทดสอบแทนได้")
            }
        }
        .task {
            if let orgId = authVM.org?.id { await categoriesVM.load(orgId: orgId) }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPickedPhotos(items) }
        }
    }

    // MARK: – Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("ปิด") { dismiss() }.foregroundColor(Color.brand500)
        }
        if !store.items.isEmpty {
            ToolbarItem(placement: .primaryAction) {
                Button(isSelecting ? "ยกเลิก" : "เลือก") {
                    hapticLight()
                    isSelecting.toggle()
                    if !isSelecting { selection.removeAll() }
                }
                .foregroundColor(Color.brand500)
            }
        }
    }

    // MARK: – Grid

    private var grid: some View {
        ScrollView {
            // Capture / import actions
            HStack(spacing: 10) {
                actionChip(icon: "viewfinder", label: "สแกนเพิ่ม") {
                    hapticLight()
                    if DocumentScannerView.isSupported { scannerSession = UUID(); showScanner = true } else { showSimulatorHint = true }
                }
                actionChip(icon: "photo.on.rectangle", label: "ดึงจาก Photos") {
                    hapticLight(); photoItems = []; showPhotoPicker = true
                }
            }
            .padding(.horizontal, 16).padding(.top, 14)

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(store.items) { item in gridCell(item) }
            }
            .padding(16)
        }
    }

    private func gridCell(_ item: GalleryItem) -> some View {
        let isSel = selection.contains(item.id)
        return Button {
            hapticLight()
            if isSelecting {
                if isSel { selection.remove(item.id) } else { selection.insert(item.id) }
            } else {
                detailItem = item
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                ZStack(alignment: .bottomLeading) {
                    if let img = store.firstImage(for: item) {
                        Image(uiImage: img)
                            .resizable().scaledToFill()
                            .frame(height: 150).frame(maxWidth: .infinity)
                            .clipped()
                    } else {
                        Rectangle().fill(Color.gray.opacity(0.15)).frame(height: 150)
                    }
                    HStack(spacing: 5) {
                        if item.category != nil {
                            CategoryIcon(category: item.category, size: 22)
                        }
                        if item.imageFilenames.count > 1 {
                            Label("\(item.imageFilenames.count)", systemImage: "doc.on.doc.fill")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .background(Capsule().fill(Color.black.opacity(0.55)))
                        }
                    }
                    .padding(6)
                }
                .frame(height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12)
                    .stroke(isSel ? Color.brand500 : Color.black.opacity(0.06), lineWidth: isSel ? 3 : 1))

                if isSelecting {
                    Image(systemName: isSel ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 22))
                        .foregroundColor(isSel ? Color.brand500 : .white)
                        .background(Circle().fill(Color.black.opacity(0.25)).padding(-1))
                        .padding(8)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func actionChip(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                Text(label).font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(Color.brand500)
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(Color.brand500.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: – Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray.full")
                .font(.system(size: 46)).foregroundColor(Color.brand500.opacity(0.5))
            Text("ยังไม่มีเอกสารในคลังพัก")
                .font(.system(size: 16, weight: .bold)).foregroundColor(Color.textPrimary)
            Text("สแกนหรือดึงรูปจาก Photos มาเก็บไว้ก่อน\nแล้วค่อยจัดหมวดหมู่และส่งเข้าระบบทีหลัง")
                .font(.system(size: 13)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 10) {
                actionChip(icon: "viewfinder", label: "สแกนเพิ่ม") {
                    hapticLight()
                    if DocumentScannerView.isSupported { scannerSession = UUID(); showScanner = true } else { showSimulatorHint = true }
                }
                actionChip(icon: "photo.on.rectangle", label: "ดึงจาก Photos") {
                    hapticLight(); photoItems = []; showPhotoPicker = true
                }
            }
            .padding(.horizontal, 40).padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: – Bottom commit bar

    @ViewBuilder
    private var bottomBar: some View {
        if isSelecting && !selection.isEmpty {
            VStack(spacing: 10) {
            // ดาวน์โหลดรายการที่เลือก
            HStack(spacing: 10) {
                exportButton(icon: "photo.badge.arrow.down", label: "Photos") {
                    Task { await saveToPhotos(images(for: selection)) }
                }
                exportButton(icon: "folder.badge.plus", label: "ไฟล์") {
                    exportToFiles(images(for: selection))
                }
            }
            Button {
                Task { await commitSelected() }
            } label: {
                HStack {
                    if isCommitting { ProgressView().tint(.white) }
                    else { Image(systemName: "tray.and.arrow.up.fill") }
                    Text(isCommitting ? "กำลังส่ง…" : "ส่งเข้าระบบ (\(selection.count))")
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Color.brand500)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(isCommitting)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }

    // MARK: – Item detail sheet

    private func itemDetailSheet(_ item: GalleryItem) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ForEach(Array(item.imageFilenames.enumerated()), id: \.offset) { _, name in
                        if let img = store.image(name) {
                            Image(uiImage: img).resizable().scaledToFit().cornerRadius(12)
                        }
                    }
                    Button {
                        categoryTargetItem = item
                    } label: {
                        HStack {
                            CategoryIcon(category: item.category, size: 28)
                            Text(item.category ?? "ตั้งหมวดหมู่")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(item.category == nil ? Color.textSecondary : Color.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundColor(Color.textSecondary)
                        }
                        .padding(12).background(Color.brand500.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    // ดาวน์โหลด — คลังภาพ หรือ ไฟล์/โฟลเดอร์
                    HStack(spacing: 10) {
                        exportButton(icon: "photo.badge.arrow.down", label: "บันทึกลง Photos") {
                            Task { await saveToPhotos(store.images(for: item)) }
                        }
                        exportButton(icon: "folder.badge.plus", label: "บันทึกลงไฟล์") {
                            exportToFiles(store.images(for: item))
                        }
                    }
                }
                .padding(16)
            }
            .background(Color.background)
            .navigationTitle("เอกสารในคลังพัก")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { detailItem = nil }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(role: .destructive) {
                        store.delete(item); detailItem = nil
                    } label: { Image(systemName: "trash").foregroundColor(.red) }
                }
            }
        }
    }

    // MARK: – Photos import

    @State private var showPhotoPicker = false
    private var photoPickerBinding: Binding<Bool> {
        Binding(get: { showPhotoPicker }, set: { showPhotoPicker = $0 })
    }
    private var categoryDialogBinding: Binding<Bool> {
        Binding(get: { categoryTargetItem != nil }, set: { if !$0 { categoryTargetItem = nil } })
    }

    private func importPickedPhotos(_ items: [PhotosPickerItem]) async {
        var images: [UIImage] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let img = UIImage(data: data) {
                images.append(img)
            }
        }
        photoItems = []
        guard !images.isEmpty else { return }
        // Each picked photo becomes its own staged item (independent receipts).
        for img in images { _ = store.add(images: [img], source: "photo") }
    }

    // MARK: – Export (ดาวน์โหลด)

    /// Images for the given items, in gallery order.
    private func images(for ids: Set<String>) -> [UIImage] {
        store.items.filter { ids.contains($0.id) }.flatMap { store.images(for: $0) }
    }

    /// Save straight into the user's Photos library (add-only permission).
    private func saveToPhotos(_ imgs: [UIImage]) async {
        guard !imgs.isEmpty else { return }
        isSavingToPhotos = true
        defer { isSavingToPhotos = false }
        do {
            for img in imgs { try await PhotoSaver.save(img) }
            hapticSuccess()
            exportNotice = imgs.count == 1
                ? "บันทึกลงคลังภาพเรียบร้อย"
                : "บันทึก \(imgs.count) รูปลงคลังภาพเรียบร้อย"
        } catch {
            exportNotice = error.localizedDescription
        }
    }

    /// Hand the images to the system share sheet — this is the route to
    /// "Save to Files" (a folder), AirDrop, Mail, and any other destination.
    private func exportToFiles(_ imgs: [UIImage]) {
        guard !imgs.isEmpty else { return }
        // Write real .jpg files first: sharing bare UIImages gives Files a
        // generic "Image" with no filename, which is useless for filing away.
        let dir = FileManager.default.temporaryDirectory
        let stamp = Int(Date().timeIntervalSince1970)
        var urls: [URL] = []
        for (i, img) in imgs.enumerated() {
            guard let data = img.jpegData(compressionQuality: 0.95) else { continue }
            let url = dir.appendingPathComponent("Slippy_\(stamp)_\(i + 1).jpg")
            if (try? data.write(to: url, options: .atomic)) != nil { urls.append(url) }
        }
        guard !urls.isEmpty else { exportNotice = "เตรียมไฟล์ไม่สำเร็จ"; return }
        shareItems = urls
        showShareSheet = true
        hapticLight()
    }

    private func exportButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(label).font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(Color.brand500)
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(Color.brand500.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(isSavingToPhotos)
    }

    // MARK: – Commit into the system (reuses the normal upload path)

    private func commitSelected() async {
        guard let orgId  = authVM.org?.id,
              let userId = authVM.session?.user.id.uuidString,
              let token  = authVM.session?.accessToken else {
            errorMessage = "ยังไม่ได้เข้าสู่ระบบ"; return
        }
        let targets = store.items.filter { selection.contains($0.id) }
        guard !targets.isEmpty else { return }

        isCommitting = true
        var committed: Set<String> = []
        var uploadedDocIds: [String] = []
        for item in targets {
            do {
                uploadedDocIds += try await commit(item, orgId: orgId, userId: userId, token: token)
                committed.insert(item.id)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
        // Same pipeline, same possible outcomes — including being declined as
        // non-financial. Without this, a document sent from คลังพัก would be
        // rejected and refunded in silence.
        if !uploadedDocIds.isEmpty { UploadTracker.shared.track(documentIds: uploadedDocIds) }
        store.delete(ids: committed)
        selection.subtract(committed)
        committedCount += committed.count
        isCommitting = false
        if selection.isEmpty { isSelecting = false }
        hapticSuccess()
    }

    /// Uploads an item's pages as documents (one per page, mirroring the normal
    /// upload flow) and triggers the server pipeline for each. Returns the
    /// created document ids so the caller can hand them to `UploadTracker`.
    @discardableResult
    private func commit(_ item: GalleryItem, orgId: String, userId: String, token: String) async throws -> [String] {
        let images = store.images(for: item)
        guard !images.isEmpty else { return [] }
        var created: [String] = []
        let batchStamp = Date().timeIntervalSince1970
        for (index, img) in images.enumerated() {
            guard let data = img.jpegData(compressionQuality: 0.94) else { continue }
            let suffix   = images.count > 1 ? "_p\(index + 1)" : ""
            let fileName = "\(userId)_\(batchStamp)\(suffix).jpg"
            let path     = "\(orgId)/\(fileName)"

            try await SupabaseManager.shared.client
                .storage.from(Config.storageBucket)
                .upload(path, data: data, options: .init(upsert: false))

            var record: [String: AnyEncodable] = [
                "organization_id": AnyEncodable(orgId),
                "uploaded_by":     AnyEncodable(userId),
                "file_path":       AnyEncodable(path),
                "file_type":       AnyEncodable("jpg"),
                "source":          AnyEncodable("gallery"),
                "status":          AnyEncodable("processing"),
                "doc_type":        AnyEncodable("receipt"),
            ]
            if let cat = item.category { record["expense_category"] = AnyEncodable(cat) }
            if let note = item.note, !note.trimmingCharacters(in: .whitespaces).isEmpty {
                record["notes"] = AnyEncodable(note)
            }

            let inserted: [SlippyDocument] = try await SupabaseManager.shared.client
                .from("documents").insert(record).select().execute().value

            if let docId = inserted.first?.id {
                created.append(docId)
                await triggerProcess(documentId: docId, token: token)
            }
        }
        return created
    }

    private func triggerProcess(documentId: String, token: String) async {
        guard let url = URL(string: "\(Config.webAppURL)/api/documents/\(documentId)/process") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = "{}".data(using: .utf8)
        _ = try? await URLSession.shared.data(for: req)
    }
}
