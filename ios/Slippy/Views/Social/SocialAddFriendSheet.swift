import SwiftUI
import CoreImage.CIFilterBuiltins

/// "เพิ่มเพื่อน" entry point — mirrors web/src/app/social/friends/AddFriendModal.tsx
/// so both platforms recommend the same 3 channels:
///   1. QR ของฉัน   — show a QR for others to scan (in-system, in-person)
///   2. สแกน QR      — scan someone else's QR (in-system, in-person)
///   3. แชร์ผ่าน LINE — out-of-system, reaches LINE's much larger install base
struct SocialAddFriendSheet: View {
    @EnvironmentObject var authVM: AuthViewModel
    @ObservedObject var vm: SocialViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var tab: Tab = .myQR
    @State private var showScanner = false
    @State private var toast: String?

    private var userId: String { authVM.session?.user.id.uuidString ?? "" }

    enum Tab: String, CaseIterable { case myQR = "QR ของฉัน", scan = "สแกน QR", line = "แชร์ LINE" }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding()

                switch tab {
                case .myQR: myQrPanel
                case .scan: scanPanel
                case .line: lineSharePanel
                }

                Spacer()
            }
            .navigationTitle("เพิ่มเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
            .task {
                guard !userId.isEmpty, vm.inviteToken == nil else { return }
                await vm.loadOrCreateInviteLink(userId: userId)
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
    }

    // MARK: – Show my QR
    private var myQrPanel: some View {
        VStack(spacing: 16) {
            if let url = vm.inviteURL, let image = qrImage(for: url.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 240, height: 240)
                    .background(Color.white)
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
                withAnimation { toast = "เพิ่ม \(name) เป็นเพื่อนแล้ว 🎉" }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if !userId.isEmpty { await vm.load(userId: userId) }
                dismiss()
            } catch {
                withAnimation { toast = "QR ไม่ถูกต้องหรือหมดอายุแล้ว" }
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
                withAnimation { toast = "คัดลอกลิงก์แล้ว!" }
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
