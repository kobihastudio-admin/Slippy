import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import QuickLook

/// The trip's document library — itinerary scans, passport, visa, insurance,
/// tickets, hotel confirmations. Store-and-view only; see
/// TripDocumentStorageAPI for why this is a private bucket, unlike the
/// gallery's.
struct TripDocumentsView: View {
    let trip: Trip

    @State private var documents: [TripDocument] = []
    @State private var loading = true
    @State private var errorText: String?
    @State private var showImporter = false
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var photoItem: PhotosPickerItem?
    /// True while a picked photo is being read / re-encoded, so a second pick cannot start meanwhile.
    @State private var preparing = false
    @State private var pendingFile: (data: Data, name: String, mime: String)?
    @State private var previewURL: URL?
    @State private var opening: String?
    @Environment(\.dismiss) private var dismiss

    private static var cameraAvailable: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return UIImagePickerController.isSourceTypeAvailable(.camera)
        #endif
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if documents.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(TripDocumentKind.allCases, id: \.self) { kind in
                            let list = documents.filter { $0.kind == kind }
                            if !list.isEmpty {
                                Section(kind.label) {
                                    ForEach(list) { doc in
                                        documentRow(doc)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("เอกสาร")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if preparing {
                        ProgressView()
                    } else {
                        Menu {
                            // The simulator's virtual camera cannot capture and some iPads have no camera: offer it only
                            // where it can work (the same rule DocumentScannerView applies).
                            if Self.cameraAvailable {
                                Button { showCamera = true } label: { Label("ถ่ายรูป", systemImage: "camera") }
                            }
                            Button { showPhotoPicker = true } label: { Label("เลือกจากรูปภาพ", systemImage: "photo.on.rectangle") }
                            Button { showImporter = true } label: { Label("เลือกไฟล์ (PDF / รูป)", systemImage: "folder") }
                        } label: { Image(systemName: "plus") }
                        .accessibilityLabel("เพิ่มเอกสาร")
                    }
                }
            }
            .alert("ทำรายการไม่สำเร็จ", isPresented: .constant(errorText != nil)) {
                Button("ตกลง") { errorText = nil }
            } message: { Text(errorText ?? "") }
            .fileImporter(isPresented: $showImporter,
                          allowedContentTypes: [.pdf, .jpeg, .png, .heic],
                          onCompletion: handlePick)
            .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task { await handlePhoto(item) }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraImagePicker { image in handleCamera(image) }
                    .ignoresSafeArea()
            }
            .sheet(item: Binding(
                get: { pendingFile.map(PendingFileBox.init) },
                set: { pendingFile = $0?.value }
            )) { box in
                UploadDocumentSheet(journeyId: trip.id, file: box.value) { doc in
                    documents.insert(doc, at: 0)
                    pendingFile = nil
                }
            }
            .quickLookPreview($previewURL)
            .task { await load() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "folder").font(.system(size: 30)).foregroundColor(Color.textSecondary)
            Text("ยังไม่มีเอกสาร").font(.system(size: 15, weight: .semibold))
            Text("แตะ + เพื่อถ่ายรูป เลือกรูป หรือเลือกไฟล์ ตั๋ว พาสปอร์ต ประกัน ใบจอง")
                .font(.system(size: 12)).foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func documentRow(_ doc: TripDocument) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 16))
                    .foregroundColor(Color.brand500)
                    .opacity(opening == doc.id ? 0 : 1)
                if opening == doc.id {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(width: 34, height: 34)
            .background(Color.brand500.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(doc.title).font(.system(size: 14, weight: .medium)).lineLimit(1)
                Text(doc.fileType.uppercased() + (doc.fileSize.map { " · \($0 / 1024) KB" } ?? ""))
                    .font(.system(size: 11)).foregroundColor(Color.textSecondary)
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture { Task { await open(doc) } }
        .swipeActions {
            Button(role: .destructive) { Task { await remove(doc) } } label: { Label("ลบ", systemImage: "trash") }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do { documents = try await TripDocumentStorageAPI.list(journeyId: trip.id) }
        catch { errorText = TripDocumentUploadRules.friendlyError(error.localizedDescription) }
    }

    private func handlePick(_ result: Result<URL, Error>) {
        switch result {
        case .failure(let error):
            errorText = error.localizedDescription
        case .success(let url):
            guard url.startAccessingSecurityScopedResource() else {
                errorText = "เปิดไฟล์ไม่ได้"
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }
            guard let data = try? Data(contentsOf: url) else {
                errorText = "อ่านไฟล์ไม่ได้"
                return
            }
            if let problem = TripDocumentUploadRules.sizeProblem(bytes: data.count) {
                errorText = problem
                return
            }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            pendingFile = (data, url.lastPathComponent, mime)
        }
    }

    /// A photo from the library: HEIC / PNG / JPEG originals are kept; anything else, or an original over the
    /// limit, is re-encoded as JPEG (see TripDocumentUploadRules).
    private func handlePhoto(_ item: PhotosPickerItem) async {
        preparing = true
        defer { preparing = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), !data.isEmpty else {
                errorText = "อ่านรูปไม่ได้"
                return
            }
            let format = TripDocumentUploadRules.storedPhotoFormat(typeIdentifiers: item.supportedContentTypes.map(\.identifier))
            if format != .convertToJPEG, data.count <= TripDocumentUploadRules.maxBytes {
                stage(data: data, format: format)
            } else if let image = UIImage(data: data), let jpeg = Self.encodeJPEG(image) {
                stage(data: jpeg, format: .convertToJPEG)
            } else {
                errorText = TripDocumentUploadRules.sizeProblem(bytes: data.count) ?? "อ่านรูปไม่ได้"
            }
        } catch {
            errorText = TripDocumentUploadRules.friendlyError(error.localizedDescription)
        }
    }

    private func handleCamera(_ image: UIImage) {
        if let jpeg = Self.encodeJPEG(image) {
            stage(data: jpeg, format: .convertToJPEG)
        } else {
            errorText = "รูปใหญ่เกินไปแม้บีบอัดแล้ว ลองถ่ายใหม่หรือเลือกไฟล์ที่เล็กกว่า"
        }
    }

    private func stage(data: Data, format: TripDocumentUploadRules.PhotoFormat) {
        let name = TripDocumentUploadRules.photoFileName(date: Date(), ext: format.ext)
        pendingFile = (data, name, format.mime)
    }

    /// The first JPEG quality that fits the 15 MB limit, or `nil` if none does.
    private static func encodeJPEG(_ image: UIImage) -> Data? {
        for quality in TripDocumentUploadRules.jpegQualitySteps {
            if let data = image.jpegData(compressionQuality: quality),
               TripDocumentUploadRules.sizeProblem(bytes: data.count) == nil { return data }
        }
        return nil
    }

    private func open(_ doc: TripDocument) async {
        opening = doc.id
        defer { opening = nil }
        do { previewURL = try await TripDocumentStorageAPI.downloadForPreview(doc) }
        catch { errorText = TripDocumentUploadRules.friendlyError(error.localizedDescription) }
    }

    private func remove(_ doc: TripDocument) async {
        let before = documents
        documents.removeAll { $0.id == doc.id }
        do { try await TripDocumentStorageAPI.remove(document: doc) }
        catch { documents = before; errorText = TripDocumentUploadRules.friendlyError(error.localizedDescription) }
    }
}

/// `.sheet(item:)` needs an Identifiable — a plain tuple isn't one.
private struct PendingFileBox: Identifiable {
    let value: (data: Data, name: String, mime: String)
    var id: String { value.name }
}

private struct UploadDocumentSheet: View {
    let journeyId: String
    let file: (data: Data, name: String, mime: String)
    let onDone: (TripDocument) -> Void

    @State private var title: String
    @State private var kind: TripDocumentKind = .itinerary
    @State private var saving = false
    @State private var errorText: String?
    @Environment(\.dismiss) private var dismiss

    init(journeyId: String, file: (data: Data, name: String, mime: String), onDone: @escaping (TripDocument) -> Void) {
        self.journeyId = journeyId
        self.file = file
        self.onDone = onDone
        _title = State(initialValue: (file.name as NSString).deletingPathExtension)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("รายละเอียด") {
                    TextField("ชื่อเอกสาร", text: $title)
                    Picker("ประเภท", selection: $kind) {
                        ForEach(TripDocumentKind.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                }
                Section {
                    LabeledContent("ไฟล์") { Text(file.name).font(.system(size: 12)) }
                    LabeledContent("ขนาด") { Text("\(file.data.count / 1024) KB").font(.system(size: 12)) }
                }
                if let errorText {
                    Section { Text(errorText).foregroundColor(.red).font(.system(size: 12)) }
                }
            }
            .navigationTitle("อัปโหลดเอกสาร")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังอัปโหลด…" : "อัปโหลด") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let doc = try await TripDocumentStorageAPI.upload(
                journeyId: journeyId, data: file.data, fileName: file.name,
                contentType: file.mime, kind: kind, title: title.trimmingCharacters(in: .whitespaces)
            )
            hapticSuccess()
            onDone(doc)
            dismiss()
        } catch {
            errorText = TripDocumentUploadRules.friendlyError(error.localizedDescription)
        }
    }
}
