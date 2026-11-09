#if DEBUG
import SwiftUI

// SLIPPY_APPEARANCE_PREVIEW=invite-link-test
// Receives real `slippy://friends/join/<token>` URLs (xcrun simctl openurl …)
// and shows the real sheet, but the redeem step is a local stub, so no network
// and no credentials are involved. Token endings pick the outcome:
//   …ab → success ("พลอย")   …a0 → invite_expired   …a1 → offline (retryable)
struct InviteLinkFixtureScreen: View {
    @StateObject private var store = PendingInviteStore(redeem: { token in
        try await Task.sleep(nanoseconds: 700_000_000)
        func fail(_ text: String) -> NSError {
            NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
        }
        if token.hasSuffix("a0") { throw fail("invite_expired") }
        if token.hasSuffix("a1") { throw fail("The Internet connection appears to be offline.") }
        return "พลอย"
    })

    var body: some View {
        Color.background.ignoresSafeArea()
            .overlay(
                VStack(spacing: 24) {
                    Text("รอรับลิงก์เชิญ…").font(.system(size: 14)).foregroundColor(Color.textSecondary)
                    OtherSheetHost()
                }
            )
            .onOpenURL { _ = store.receive($0) }
            .inviteLinkSheet(store, isSignedIn: true)
    }
}

/// A DEEPER view that presents its own sheet, like the screens under RootView do. It exists to check
/// what happens when an invite link arrives while another sheet is already on screen.
private struct OtherSheetHost: View {
    @State private var show = false
    var body: some View {
        Button("เปิด sheet อื่น") { show = true }
            .font(.system(size: 14, weight: .semibold))
            .sheet(isPresented: $show) {
                VStack(spacing: 16) {
                    Text("sheet อื่น (เปิดอยู่)").font(.system(size: 18, weight: .bold))
                    Button("ปิด sheet นี้") { show = false }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.surface.ignoresSafeArea())
            }
    }
}
#endif
