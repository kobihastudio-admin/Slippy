import SwiftUI
import CoreImage.CIFilterBuiltins

/// "เพิ่มเพื่อน" — one scrolling screen: search by name, three ways to add
/// (scan a QR, show my QR, share my link) and incoming requests. Mirrors the
/// channels of web/src/app/social/friends/AddFriendModal.tsx.
struct SocialAddFriendSheet: View {
    @EnvironmentObject var authVM: AuthViewModel
    @ObservedObject var vm: SocialViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var route: Route?
    @State private var toast: String?

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    enum Route: String, Identifiable, Hashable {
        case scan, myQR, share
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    FriendSearchBar(vm: vm)

                    if !vm.searchResults.isEmpty {
                        FriendSearchResults(vm: vm, userId: userId)
                    }

                    HStack(spacing: 10) {
                        tile(.scan, icon: "qrcode.viewfinder", title: "สแกน QR")
                        tile(.myQR, icon: "qrcode", title: "QR ของฉัน")
                        tile(.share, icon: "link", title: "แชร์ลิงก์")
                    }

                    if !vm.pendingRequests.isEmpty {
                        FriendRequestList(vm: vm, userId: userId, showsCount: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .background(Color.background.ignoresSafeArea())
            .navigationTitle("เพิ่มเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
            .navigationDestination(item: $route) { route in
                switch route {
                case .scan:
                    ScrollView { scanPanel }
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("สแกน QR")
                        .navigationBarTitleDisplayMode(.inline)
                case .myQR:
                    ScrollView { myQrPanel }
                        .frame(maxWidth: .infinity)
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("QR ของฉัน")
                        .navigationBarTitleDisplayMode(.inline)
                case .share:
                    ScrollView { lineSharePanel }
                        .background(Color.background.ignoresSafeArea())
                        .navigationTitle("แชร์ลิงก์")
                        .navigationBarTitleDisplayMode(.inline)
                }
            }
            .onAppear { clearSearch() }
            .onDisappear { clearSearch() }
            .task {
                guard !userId.isEmpty, vm.inviteToken == nil else { return }
                await vm.loadOrCreateInviteLink(userId: userId)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.black.opacity(0.8))
                    .clipShape(Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    /// The query and results live on the view model shared with the Social tab;
    /// don't let one screen's search show up on the other.
    private func clearSearch() {
        vm.searchQuery = ""
        vm.searchResults = []
    }

    private func showToast(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            withAnimation { if toast == message { toast = nil } }
        }
    }

    private func tile(_ target: Route, icon: String, title: String) -> some View {
        Button {
            hapticLight()
            route = target
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(Color.brand500)
                    .frame(width: 44, height: 44)
                    .background(Color.brand50)
                    .clipShape(Circle())
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: – Show my QR
    private var myQrPanel: some View {
        VStack(spacing: 16) {
            if let url = vm.inviteURL, let image = qrImage(for: url.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 240, height: 240)
                    .background(Color.surface)
                    .cornerRadius(16)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
            } else {
                ProgressView()
                    .frame(width: 240, height: 240)
            }
            Text("ให้เพื่อนสแกน QR นี้เพื่อเพิ่มเป็นเพื่อนทันที")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
    }

    private func qrImage(for string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    // MARK: – Scan a friend's QR
    private var scanPanel: some View {
        VStack(spacing: 16) {
            ZStack {
                FriendQRScannerView { scanned in
                    handleScan(scanned)
                }
                .frame(height: 320)
                .cornerRadius(16)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.6), lineWidth: 2).padding(32))
            }
            .padding(.horizontal, 16)
            Text("เล็ง QR ของเพื่อนให้อยู่ในกรอบ")
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary)
        }
        .padding(.top, 16)
    }

    private func handleScan(_ raw: String) {
        // QR encodes the full invite URL (e.g. https://.../friends/join/<token>)
        // — pull the token off the end, same shape web's MyQrPanel encodes.
        guard let token = raw.split(separator: "/").last, !token.isEmpty else { return }
        Task {
            do {
                let name = try await vm.acceptInvite(token: String(token))
                hapticSuccess()
                showToast("เพิ่ม \(name) เป็นเพื่อนแล้ว 🎉")
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if !userId.isEmpty { await vm.load(userId: userId) }
                dismiss()
            } catch {
                showToast("QR ไม่ถูกต้องหรือหมดอายุแล้ว")
            }
        }
    }

    // MARK: – Share via LINE
    private var lineSharePanel: some View {
        VStack(spacing: 12) {
            Button {
                shareViaLine()
            } label: {
                Text("แชร์ลิงก์เชิญผ่าน LINE")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color(hex: "#06C755"))
                    .cornerRadius(14)
            }
            .disabled(vm.inviteURL == nil)

            Button {
                guard let url = vm.inviteURL else { return }
                UIPasteboard.general.string = url.absoluteString
                showToast("คัดลอกลิงก์แล้ว!")
            } label: {
                Text("คัดลอกลิงก์")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
            }
            .disabled(vm.inviteURL == nil)

            Text("เหมาะสำหรับส่งให้เพื่อนที่ยังไม่ได้ใช้ Slippy — เข้าถึงคนได้กว้างกว่าเพราะทุกคนมี LINE อยู่แล้ว")
                .font(.system(size: 12))
                .foregroundColor(Color.textSecondary.opacity(0.8))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
    }

    private func shareViaLine() {
        guard let url = vm.inviteURL else { return }
        let text = "มาเป็นเพื่อนกันใน Slippy กันเถอะ! \(url.absoluteString)"
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? text
        // `line://` opens the LINE app's own share sheet directly if installed;
        // the https:// universal link is the fallback for everyone else,
        // same two-tier approach as api/src/services/line-flex.ts uses server-side.
        if let appURL = URL(string: "line://msg/text/\(encoded)"), UIApplication.shared.canOpenURL(appURL) {
            UIApplication.shared.open(appURL)
        } else if let webURL = URL(string: "https://line.me/R/msg/text/?\(encoded)") {
            UIApplication.shared.open(webURL)
        }
    }
}

#if DEBUG
#Preview {
    SocialAddFriendSheet(vm: SocialViewModel())
        .environmentObject(AuthViewModel(_preview: true))
}
#endif
