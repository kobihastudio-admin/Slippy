import SwiftUI

/// "เพิ่มเพื่อนจากลิงก์เชิญ" — asks before anything happens. The inviter's name
/// is not known until the invite is redeemed (the RPC returns it afterwards), so
/// the text is deliberately generic.
struct InviteConfirmSheet: View {
    @ObservedObject var store: PendingInviteStore

    var body: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 8)
            switch store.phase {
            case .confirming, .working:
                confirmation
            case .success(let name):
                result(icon: "checkmark.circle.fill", tint: Color.successText,
                       title: "เพิ่ม \(name) เป็นเพื่อนแล้ว 🎉", button: "เสร็จสิ้น")
            case .failed(let message, let canRetry):
                failure(message: message, canRetry: canRetry)
            }
            Spacer(minLength: 8)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color.background.ignoresSafeArea())
        .presentationDetents([.medium])
        .interactiveDismissDisabled(store.phase == .working)
    }

    private var confirmation: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color.brand500)
            Text("เพิ่มเพื่อนจากลิงก์เชิญ")
                .font(.system(size: 20, weight: .bold)).foregroundColor(Color.textPrimary)
            Text("คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy ต้องการรับคำเชิญนี้ไหม?")
                .font(.system(size: 14)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                hapticLight()
                Task { await store.accept() }
            } label: {
                HStack(spacing: 8) {
                    if store.phase == .working { ProgressView().tint(.white) }
                    Text("รับคำเชิญ")
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(store.phase == .working)
            Button("ยกเลิก") { store.dismiss() }
                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                .disabled(store.phase == .working)
        }
    }

    private func result(icon: String, tint: Color, title: String, button: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: icon).font(.system(size: 44)).foregroundColor(tint)
            Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.center)
            Button(button) { store.dismiss() }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func failure(message: String, canRetry: Bool) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40)).foregroundColor(Color.errorText)
            Text(message).font(.system(size: 16, weight: .semibold)).foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.center)
            if canRetry {
                Button {
                    hapticLight()
                    Task { await store.accept() }
                } label: {
                    Text("ลองอีกครั้ง")
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
            Button(canRetry ? "ยกเลิก" : "ปิด") { store.dismiss() }
                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
        }
    }
}
