import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import QuickLook

/// Chat room for "แชทกับเพื่อน" (and the trip chat, which reuses it). No
/// realtime yet — polls on a short timer while the view is open, same tradeoff
/// DashboardView/SplitView make elsewhere in this app.
struct FriendChatRoomView: View {
    @ObservedObject var vm: MessagesViewModel
    let conversationId: String
    let currentUserId: String
    /// Set by the chat list for 1:1 chats. `nil` for other callers (the trip
    /// chat), which keep their own navigation title.
    var friendName: String? = nil
    var friendAvatarUrl: String? = nil
    /// Show the sender's avatar next to a run of messages. Only meaningful for 1:1 chats.
    var showsAvatars = false
    /// Set only for 1:1 chats so the trip chat is unchanged.
    var friendUserId: String? = nil
    var balanceViewModel: BalanceViewModel? = nil

    @State private var input = ""
    @State private var sendFailed = false
    @State private var submitting = false
    @FocusState private var inputFocused: Bool
    // Attachments
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var showCamera = false
    @State private var photoItem: PhotosPickerItem?
    /// True while a picked file is being read / re-encoded / uploaded, so a second one cannot start meanwhile.
    @State private var preparing = false
    @State private var attachError: String?
    @State private var notice: String?
    @State private var previewURL: URL?
    @State private var shareItems: ChatShareItems?
    @State private var forwarding: FriendMessage?
    /// The message whose file is being downloaded (shows a spinner on it).
    @State private var busyMessageId: String?
    private let refreshTimer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    private struct Row: Identifiable {
        let message: FriendMessage
        let layout: ChatPresentation.MessageLayout
        let time: String
        var id: String { message.id }
    }

    /// Only this conversation's messages. `vm.messages` is shared across rooms,
    /// and a poll that was started in the previous room can land after this
    /// one opened, so the filter (not just the clear on entry) keeps the
    /// previous conversation from showing up.
    private var visibleMessages: [FriendMessage] {
        vm.messages.filter { $0.conversationId == conversationId }
    }

    private var rows: [Row] {
        let messages = visibleMessages
        let dates = messages.map { ChatPresentation.parseISO($0.createdAt) }
        let layouts = ChatPresentation.layouts(
            items: zip(messages, dates).map { (senderId: $0.0.senderId, date: $0.1) },
            me: currentUserId)
        return zip(zip(messages, dates), layouts).map { pair, layout in
            Row(message: pair.0, layout: layout, time: pair.1.map { ChatPresentation.timeLabel($0) } ?? "")
        }
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !submitting && !vm.isSending
    }

    var body: some View {
        VStack(spacing: 0) {
            if let balanceViewModel, let friendUserId {
                BalanceChatLine(vm: balanceViewModel, friendId: friendUserId, friendName: friendName ?? "")
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if vm.hasOlder(conversationId) {
                            olderButton(proxy: proxy)
                        }
                        ForEach(rows) { row in
                            ChatMessageRow(
                                message: row.message,
                                layout: row.layout,
                                time: row.time,
                                isMe: ChatPresentation.isSameUser(row.message.senderId, currentUserId),
                                friendName: friendName ?? "",
                                friendAvatarUrl: friendAvatarUrl,
                                showsAvatars: showsAvatars,
                                isBusy: busyMessageId == row.message.id,
                                onOpen: { open(row.message) },
                                onShare: { share(row.message) },
                                onForward: { forwarding = row.message },
                                onCopy: { copy(row.message) })
                            .id(row.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                // Follow the NEWEST message only. Keying on the whole list scrolled to the bottom whenever older
                // messages were prepended, which threw the reader away from the page they had just asked for.
                .onChange(of: visibleMessages.last?.id) { _, newest in
                    guard let newest else { return }
                    withAnimation { proxy.scrollTo(newest, anchor: .bottom) }
                }
            }

            composer
        }
        .background(Color.surfaceMuted.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .modifier(OptionalNavigationTitle(title: friendName))
        .task {
            // Never flash the previously opened conversation's messages.
            if let first = vm.messages.first, first.conversationId != conversationId { vm.messages = [] }
            // Opening a room is always a first page (see resetRoom), even if it was loaded before.
            vm.resetRoom(conversationId)
            await vm.loadMessages(conversationId: conversationId)
            await balanceViewModel?.load()
        }
        .onReceive(refreshTimer) { _ in
            Task { await vm.loadMessages(conversationId: conversationId) }
        }
        .onChange(of: input) { _, _ in
            if sendFailed { sendFailed = false }
        }
        .onChange(of: sendFailed) { _, failed in
            if failed { AccessibilityNotification.Announcement("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่").post() }
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .any(of: [.images, .videos]))
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await handlePhoto(item) }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], onCompletion: handleFilePick)
        .fullScreenCover(isPresented: $showCamera) {
            CameraImagePicker { image in Task { await handleCamera(image) } }
                .ignoresSafeArea()
        }
        .quickLookPreview($previewURL)
        .sheet(item: $shareItems, onDismiss: nil) { request in
            ActivityShareSheet(items: request.items) { ChatRemoteFile.discard(request.cleanup) }
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $forwarding) { message in
            ChatForwardSheet(vm: vm, message: message, myId: currentUserId, excludeConversationId: conversationId) { error in
                if let error { attachError = error } else { flash("ส่งต่อแล้ว") }
            }
        }
        .alert("ส่งไฟล์ไม่ได้", isPresented: Binding(get: { attachError != nil }, set: { if !$0 { attachError = nil } })) {
            Button("ตกลง") { attachError = nil }
        } message: { Text(attachError ?? "") }
        .overlay(alignment: .top) {
            if let notice {
                Text(notice)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Color.black.opacity(0.75))
                    .clipShape(Capsule())
                    .padding(.top, 8)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: notice)
    }

    private static var cameraAvailable: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return UIImagePickerController.isSourceTypeAvailable(.camera)
        #endif
    }

    private func flash(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            if notice == text { notice = nil }
        }
    }

    /// "Load older messages" at the top of the list. After the page is prepended the view scrolls back to the
    /// message that used to be first, so the reader stays where they were.
    private func olderButton(proxy: ScrollViewProxy) -> some View {
        Button {
            let anchor = visibleMessages.first?.id
            Task {
                await vm.loadOlder(conversationId: conversationId)
                guard let anchor else { return }
                // Scrolling in the same pass as the insert lands on the lazy stack's ESTIMATED row heights and misses
                // the anchor (seen in the simulator: the old first message ended up near the bottom of the screen).
                // Let SwiftUI lay the new rows out first, then scroll, and once more after they have settled.
                await Task.yield()
                proxy.scrollTo(anchor, anchor: .top)
                try? await Task.sleep(nanoseconds: 120_000_000)
                proxy.scrollTo(anchor, anchor: .top)
            }
        } label: {
            HStack(spacing: 6) {
                if vm.isLoadingOlder { ProgressView().controlSize(.small) }
                Text(vm.isLoadingOlder ? "กำลังโหลด…" : "โหลดข้อความก่อนหน้า")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(Color.textSecondary)
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(Color.surface)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(vm.isLoadingOlder)
        .padding(.bottom, 4)
        .accessibilityLabel("โหลดข้อความก่อนหน้า")
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if sendFailed {
                Text("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.errorText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            HStack(alignment: .bottom, spacing: 8) {
                attachButton

                TextField("พิมพ์ข้อความ...", text: $input, axis: .vertical)
                    .focused($inputFocused)
                    .font(.system(size: 15))
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Color.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .lineLimit(1...4)

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(canSend ? Color.brand500 : Color.border)
                }
                .disabled(!canSend)
                .accessibilityLabel("ส่งข้อความ")
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
        .background(Color.surface)
    }

    /// "+" next to the text field: camera (only where one can capture), photos and videos, any file.
    private var attachButton: some View {
        Group {
            if preparing || vm.isSending {
                ProgressView().frame(width: 32, height: 32)
            } else {
                Menu {
                    if Self.cameraAvailable {
                        Button { showCamera = true } label: { Label("ถ่ายรูป", systemImage: "camera") }
                    }
                    Button { showPhotoPicker = true } label: { Label("รูปภาพและวิดีโอ", systemImage: "photo.on.rectangle") }
                    Button { showFileImporter = true } label: { Label("ไฟล์", systemImage: "doc") }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(Color.brand500)
                }
                .accessibilityLabel("แนบไฟล์")
            }
        }
    }

    private func send() {
        guard canSend else { return }
        let sent = input
        submitting = true
        sendFailed = false
        Task {
            let succeeded = await vm.sendMessage(conversationId: conversationId, senderId: currentUserId, body: sent)
            input = ChatPresentation.draftAfterSend(current: input, sent: sent, succeeded: succeeded)
            sendFailed = !succeeded
            submitting = false
        }
    }

    // MARK: – Sending a file

    private func upload(data: Data, name: String, mime: String) async {
        preparing = true
        defer { preparing = false }
        if let error = await vm.sendAttachment(conversationId: conversationId, senderId: currentUserId,
                                               data: data, fileName: name, mime: mime) {
            attachError = error
        }
    }

    /// A photo or video from the library. Videos are copied to a file first (they can be large); photos keep their
    /// original bytes, and are re-encoded as JPEG only when the format is unusual or the original is over the limit.
    private func handlePhoto(_ item: PhotosPickerItem) async {
        preparing = true
        defer { preparing = false }
        do {
            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                    attachError = "อ่านวิดีโอไม่ได้"
                    return
                }
                defer { try? FileManager.default.removeItem(at: movie.url) }
                let size = (try? movie.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if let problem = ChatAttachmentRules.sizeProblem(bytes: size) { attachError = problem; return }
                let data = try Data(contentsOf: movie.url, options: .mappedIfSafe)
                let ext = movie.url.pathExtension
                let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
                let name = ChatAttachmentRules.capturedFileName(kind: "video", date: Date(), ext: ext)
                await upload(data: data, name: name, mime: mime)
                return
            }
            guard let data = try await item.loadTransferable(type: Data.self), !data.isEmpty else {
                attachError = "อ่านรูปไม่ได้"
                return
            }
            let format = TripDocumentUploadRules.storedPhotoFormat(typeIdentifiers: item.supportedContentTypes.map(\.identifier))
            if format != .convertToJPEG, data.count <= ChatAttachmentRules.maxBytes {
                let name = ChatAttachmentRules.capturedFileName(kind: "image", date: Date(), ext: format.ext)
                await upload(data: data, name: name, mime: format.mime)
            } else if let image = UIImage(data: data), let jpeg = Self.encodeJPEG(image) {
                let name = ChatAttachmentRules.capturedFileName(kind: "image", date: Date(), ext: "jpg")
                await upload(data: jpeg, name: name, mime: "image/jpeg")
            } else {
                attachError = ChatAttachmentRules.sizeProblem(bytes: data.count) ?? "อ่านรูปไม่ได้"
            }
        } catch {
            attachError = ChatAttachmentRules.friendlyError(error.localizedDescription)
        }
    }

    private func handleCamera(_ image: UIImage) async {
        guard let jpeg = Self.encodeJPEG(image) else {
            attachError = "รูปใหญ่เกินไปแม้บีบอัดแล้ว ลองถ่ายใหม่"
            return
        }
        await upload(data: jpeg, name: ChatAttachmentRules.capturedFileName(kind: "image", date: Date(), ext: "jpg"), mime: "image/jpeg")
    }

    private func handleFilePick(_ result: Result<URL, Error>) {
        switch result {
        case .failure(let error):
            attachError = ChatAttachmentRules.friendlyError(error.localizedDescription)
        case .success(let url):
            Task {
                preparing = true
                guard url.startAccessingSecurityScopedResource() else {
                    preparing = false
                    attachError = "เปิดไฟล์ไม่ได้"
                    return
                }
                defer { url.stopAccessingSecurityScopedResource() }
                // Check the size before reading, so a huge file is refused without being loaded.
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if let problem = ChatAttachmentRules.sizeProblem(bytes: size) {
                    preparing = false
                    attachError = problem
                    return
                }
                guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
                    preparing = false
                    attachError = "อ่านไฟล์ไม่ได้"
                    return
                }
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                preparing = false
                await upload(data: data, name: url.lastPathComponent, mime: mime)
            }
        }
    }

    /// The first JPEG quality that fits the limit, or `nil` if none does.
    private static func encodeJPEG(_ image: UIImage) -> Data? {
        for quality in ChatAttachmentRules.jpegQualitySteps {
            if let data = image.jpegData(compressionQuality: quality),
               ChatAttachmentRules.sizeProblem(bytes: data.count) == nil { return data }
        }
        return nil
    }

    // MARK: – Opening, sharing, copying

    private func fileName(of message: FriendMessage) -> String {
        let named = message.meta?.fileName ?? message.body ?? ""
        return named.isEmpty ? "ไฟล์" : named
    }

    private func open(_ message: FriendMessage) {
        guard let url = message.attachmentUrl, busyMessageId == nil else { return }
        busyMessageId = message.id
        Task {
            defer { busyMessageId = nil }
            do { previewURL = try await ChatRemoteFile.download(urlString: url, fileName: fileName(of: message)) }
            catch { attachError = ChatAttachmentRules.friendlyError(error.localizedDescription) }
        }
    }

    private func share(_ message: FriendMessage) {
        if ChatAttachmentRules.isShareableFile(msgType: message.msgType, attachmentUrl: message.attachmentUrl),
           let url = message.attachmentUrl {
            guard busyMessageId == nil else { return }
            busyMessageId = message.id
            Task {
                defer { busyMessageId = nil }
                do {
                    let file = try await ChatRemoteFile.download(urlString: url, fileName: fileName(of: message))
                    shareItems = ChatShareItems(items: [file], cleanup: file)
                } catch { attachError = ChatAttachmentRules.friendlyError(error.localizedDescription) }
            }
        } else if let text = message.body, !text.isEmpty {
            shareItems = ChatShareItems(items: [text])
        }
    }

    private func copy(_ message: FriendMessage) {
        if message.msgType == "text", let text = message.body, !text.isEmpty {
            UIPasteboard.general.string = text
            flash("คัดลอกข้อความแล้ว")
        } else if let url = message.attachmentUrl {
            UIPasteboard.general.string = url
            flash("คัดลอกลิงก์แล้ว")
        }
    }
}

/// Applies a navigation title only when one is provided, so a caller's own
/// `.navigationTitle` (the trip chat) is never overridden by an empty one.
private struct OptionalNavigationTitle: ViewModifier {
    let title: String?
    func body(content: Content) -> some View {
        if let title { content.navigationTitle(title) } else { content }
    }
}

private struct ChatMessageRow: View {
    let message: FriendMessage
    let layout: ChatPresentation.MessageLayout
    let time: String
    let isMe: Bool
    let friendName: String
    let friendAvatarUrl: String?
    let showsAvatars: Bool
    var isBusy = false
    var onOpen: () -> Void = {}
    var onShare: () -> Void = {}
    var onForward: () -> Void = {}
    var onCopy: () -> Void = {}

    private var text: String { ChatPresentation.previewText(type: message.msgType, body: message.body) }

    private var attachmentURL: URL? {
        guard ChatAttachmentRules.isShareableFile(msgType: message.msgType, attachmentUrl: message.attachmentUrl) else { return nil }
        return message.attachmentUrl.flatMap(URL.init(string:))
    }

    private var attachmentName: String {
        let named = message.meta?.fileName ?? message.body ?? ""
        return named.isEmpty ? "ไฟล์" : named
    }

    /// What VoiceOver reads for the message: the file's name for an attachment, else the text.
    private var spokenText: String {
        attachmentURL == nil ? text : "ไฟล์แนบ \(attachmentName)"
    }

    var body: some View {
        VStack(spacing: 8) {
            if let chip = layout.dayChip { DayChip(text: chip).padding(.top, 6) }
            if isMe {
                HStack(alignment: .bottom, spacing: 5) {
                    Spacer(minLength: 48)
                    timeText
                    bubble
                }
            } else {
                HStack(alignment: .top, spacing: 6) {
                    avatarSlot
                    HStack(alignment: .bottom, spacing: 5) {
                        bubble
                        timeText
                    }
                    Spacer(minLength: 24)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [layout.dayChip, isMe ? "ฉัน" : friendName, spokenText, time]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: ", "))
    }

    @ViewBuilder private var avatarSlot: some View {
        if showsAvatars {
            if layout.showsAvatar {
                ChatAvatar(name: friendName, url: friendAvatarUrl, size: 32)
            } else {
                Color.clear.frame(width: 32, height: 32)
            }
        }
    }

    private var timeText: some View {
        Text(time)
            .font(.system(size: 10))
            .foregroundColor(Color.textSecondary)
    }

    @ViewBuilder private var bubble: some View {
        Group {
            if let url = attachmentURL, message.msgType == "image" {
                ChatImageBubble(url: url, isBusy: isBusy, onOpen: onOpen)
            } else if attachmentURL != nil {
                ChatFileCard(
                    name: attachmentName,
                    sizeText: message.meta?.fileSize.map { ChatAttachmentRules.sizeLabel(bytes: $0) },
                    isMe: isMe, isBusy: isBusy, onOpen: onOpen)
            } else {
                textBubble
            }
        }
        .contextMenu { actionsMenu }
    }

    private var textBubble: some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundColor(isMe ? .white : Color.textPrimary)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(isMe ? Color.brand500 : Color.surface)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: isMe ? 16 : 4,
                bottomLeadingRadius: 16,
                bottomTrailingRadius: 16,
                topTrailingRadius: isMe ? 4 : 16))
    }

    /// Long-press menu, like LINE: open / copy / forward / share.
    @ViewBuilder private var actionsMenu: some View {
        if attachmentURL != nil {
            Button { onOpen() } label: { Label("เปิดดู", systemImage: "eye") }
            Button { onShare() } label: { Label("แชร์", systemImage: "square.and.arrow.up") }
            Button { onCopy() } label: { Label("คัดลอกลิงก์", systemImage: "link") }
        } else if message.msgType == "text", !(message.body ?? "").isEmpty {
            Button { onCopy() } label: { Label("คัดลอก", systemImage: "doc.on.doc") }
            Button { onShare() } label: { Label("แชร์", systemImage: "square.and.arrow.up") }
        }
        if ChatAttachmentRules.isForwardable(msgType: message.msgType) {
            Button { onForward() } label: { Label("ส่งต่อ", systemImage: "arrowshape.turn.up.right") }
        }
    }
}

private struct DayChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 10).padding(.vertical, 3)
            .background(Color.black.opacity(0.55))
            .clipShape(Capsule())
    }
}
