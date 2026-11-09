import SwiftUI

/// Holds a friend-invite token between "the link was opened" and "the user
/// confirmed". The token lives in memory only (if the app is killed the user
/// taps the link again). Opening a link NEVER redeems it: only `accept()`,
/// called from the confirmation sheet's button, does.
@MainActor
final class PendingInviteStore: ObservableObject {
    enum Phase: Equatable {
        case confirming
        case working
        case success(String)
        case failed(String, canRetry: Bool)
    }

    @Published private(set) var token: String?
    @Published private(set) var phase: Phase = .confirming

    /// Redeems a token and returns the inviter's name. Injected so Debug
    /// fixtures never touch the network.
    private let redeem: (String) async throws -> String

    init(redeem: @escaping (String) async throws -> String = PendingInviteStore.liveRedeem) {
        self.redeem = redeem
    }

    static func liveRedeem(_ token: String) async throws -> String {
        try await SocialViewModel().acceptInvite(token: token)
    }

    /// Stores the token of an invite deep link. Returns `false` (and changes
    /// nothing) for any other URL. The latest link replaces an older pending
    /// one, except while a redeem is in flight, so the confirmation the user is
    /// looking at cannot change under them.
    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let newToken = InviteLink.token(from: url) else { return false }
        if phase == .working { return true }
        token = newToken
        phase = .confirming
        return true
    }

    /// The user tapped "รับคำเชิญ".
    func accept() async {
        guard let current = token else { return }
        switch phase {
        case .confirming, .failed(_, canRetry: true): break
        default: return
        }
        phase = .working
        attempt += 1
        let mine = attempt
        do {
            let name = try await redeem(current)
            // Dismissed (or dismissed and the same link received again) while in flight:
            // this result belongs to an older attempt and must not overwrite a fresh state.
            guard attempt == mine else { return }
            phase = .success(name)
        } catch {
            guard attempt == mine else { return }
            let raw = "\(error) \(error.localizedDescription)"
            phase = .failed(InviteLink.failureMessage(raw), canRetry: InviteLink.isRetryable(raw))
        }
    }

    /// Cancel, "เสร็จสิ้น", swipe-down, or a change of account. Always clears the token and
    /// retires any redeem that is still in flight.
    func dismiss() {
        attempt += 1
        token = nil
        phase = .confirming
    }

    /// Identifies the current redeem attempt (a token alone cannot: the same token can come back).
    private var attempt = 0
}

private struct InviteLinkSheetModifier: ViewModifier {
    @ObservedObject var store: PendingInviteStore
    let isSignedIn: Bool

    func body(content: Content) -> some View {
        content.sheet(isPresented: Binding(
            get: { store.token != nil && isSignedIn },
            set: { if !$0 { store.dismiss() } }
        )) {
            InviteConfirmSheet(store: store)
        }
    }
}

extension View {
    /// Shows the invite confirmation while a link is pending and the user is signed in.
    func inviteLinkSheet(_ store: PendingInviteStore, isSignedIn: Bool) -> some View {
        modifier(InviteLinkSheetModifier(store: store, isSignedIn: isSignedIn))
    }
}
