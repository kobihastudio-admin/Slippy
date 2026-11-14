import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A video picked from the photo library, copied to a temporary file so a long clip is never held in memory twice.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(ext)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}

/// Downloads a chat attachment to a temporary file (QuickLook and the share sheet need a file, not a URL).
enum ChatRemoteFile {
    struct DownloadError: LocalizedError {
        let errorDescription: String?
    }

    /// The temporary file is named after the original so the share sheet and QuickLook show a readable name.
    /// The caller removes it (`discard`) when it is done.
    static func download(urlString: String, fileName: String?) async throws -> URL {
        guard let remote = URL(string: urlString), ["https", "http"].contains(remote.scheme?.lowercased() ?? "") else {
            throw DownloadError(errorDescription: "ลิงก์ไฟล์ไม่ถูกต้อง")
        }
        let (temporary, response) = try await URLSession.shared.download(from: remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            try? FileManager.default.removeItem(at: temporary)
            throw DownloadError(errorDescription: "ดาวน์โหลดไฟล์ไม่สำเร็จ")
        }
        let fallback = remote.lastPathComponent.isEmpty ? "ไฟล์" : remote.lastPathComponent
        let name = ChatAttachmentRules.safeLocalFileName(fileName ?? "", fallback: fallback)
        // A fresh folder per download so two files with the same name never collide.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("chat-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(name)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    /// Removes a downloaded file and the folder made for it.
    static func discard(_ file: URL?) {
        guard let file else { return }
        let folder = file.deletingLastPathComponent()
        if folder.lastPathComponent.hasPrefix("chat-") {
            try? FileManager.default.removeItem(at: folder)
        } else {
            try? FileManager.default.removeItem(at: file)
        }
    }
}

/// Something to hand to the share sheet (a downloaded file, or text), plus the temporary file to delete afterwards.
struct ChatShareItems: Identifiable {
    let id = UUID()
    let items: [Any]
    var cleanup: URL? = nil
}

/// An image sent in a chat: a thumbnail that opens the full picture. The bucket is private, so the thumbnail's URL is a
/// short-lived signed one that `resolve` mints for the stored value.
struct ChatImageBubble: View {
    let stored: String
    let resolve: (String) async throws -> URL
    let isBusy: Bool
    let onOpen: () -> Void

    @State private var url: URL?
    @State private var failed = false

    var body: some View {
        Button(action: onOpen) {
            Group {
                if let url, !failed {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                        case .failure:
                            placeholder(systemName: "photo.badge.exclamationmark")
                        default:
                            placeholder(systemName: nil)
                        }
                    }
                } else {
                    placeholder(systemName: failed ? "photo.badge.exclamationmark" : nil)
                }
            }
            .frame(maxWidth: 220, maxHeight: 280)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay { if isBusy { ProgressView().padding(10).background(.ultraThinMaterial, in: Circle()) } }
        }
        .buttonStyle(.plain)
        .task(id: stored) {
            failed = false
            url = nil
            do { url = try await resolve(stored) } catch { failed = true }
        }
        .accessibilityLabel("รูปภาพ แตะเพื่อดู")
    }

    private func placeholder(systemName: String?) -> some View {
        ZStack {
            Color.surfaceMuted
            if let systemName {
                Image(systemName: systemName).font(.system(size: 28)).foregroundColor(Color.textSecondary)
            } else {
                ProgressView()
            }
        }
        .frame(width: 180, height: 140)
    }
}

/// A file (or video) sent in a chat: icon, name and size. Tapping opens it.
struct ChatFileCard: View {
    let name: String
    let sizeText: String?
    let isMe: Bool
    let isBusy: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(isMe ? Color.white.opacity(0.22) : Color.brand500.opacity(0.12)).frame(width: 40, height: 40)
                    if isBusy {
                        ProgressView().tint(isMe ? .white : Color.brand500)
                    } else {
                        Image(systemName: ChatAttachmentRules.iconName(forFileName: name))
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(isMe ? .white : Color.brand500)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let sizeText {
                        Text(sizeText).font(.system(size: 11)).opacity(0.75)
                    }
                }
            }
            .foregroundColor(isMe ? .white : Color.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: 260, alignment: .leading)
            .background(isMe ? Color.brand500 : Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("ไฟล์ \(name)\(sizeText.map { " ขนาด \($0)" } ?? "") แตะเพื่อเปิด")
    }
}

/// "ส่งต่อ": pick the chat a message is sent on to.
struct ChatForwardSheet: View {
    @ObservedObject var vm: MessagesViewModel
    let message: FriendMessage
    let myId: String
    let excludeConversationId: String
    /// Called with the Thai error text, or `nil` once the message was sent.
    let onFinish: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var sendingTo: String?

    private var targets: [ChatConversation] {
        vm.conversations.filter { $0.id != excludeConversationId }
    }

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.conversations.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if targets.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 34)).foregroundColor(Color.textSecondary)
                        Text("ยังไม่มีแชทอื่นให้ส่งต่อ").font(.system(size: 15)).foregroundColor(Color.textSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(targets) { conversation in
                        Button {
                            Task { await send(to: conversation) }
                        } label: {
                            HStack(spacing: 12) {
                                ChatAvatar(name: conversation.displayName, url: conversation.displayAvatarUrl, size: 40)
                                Text(conversation.displayName).font(.system(size: 16)).foregroundColor(Color.textPrimary)
                                Spacer()
                                if sendingTo == conversation.id { ProgressView() }
                            }
                        }
                        .disabled(sendingTo != nil)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("ส่งต่อไปยัง")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
            }
            .task {
                if vm.conversations.isEmpty { await vm.loadConversations(myId: myId) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send(to conversation: ChatConversation) async {
        sendingTo = conversation.id
        let error = await vm.forward(message, to: conversation.id, senderId: myId)
        sendingTo = nil
        dismiss()
        onFinish(error)
    }
}
