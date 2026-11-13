import SwiftUI
import UIKit

/// Thin wrapper around `UIActivityViewController` — the system share sheet,
/// which already lists LINE (and every other installed app) as a share
/// target when available, so "ส่งให้เพื่อนหรือกลุ่มในแอพหรือไลน์" works for
/// any combination of text + image items without custom per-app integration.
struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    /// Called when the sheet is dismissed (shared or cancelled), e.g. to delete a temporary file that was being shared.
    var onFinish: (() -> Void)? = nil

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let onFinish { controller.completionWithItemsHandler = { _, _, _, _ in onFinish() } }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// A downloaded document file (and optional summary text) to hand to the share sheet. `file` is a temporary copy: the
/// caller deletes it when the sheet is dismissed (`DocumentFileDownloader.discard`).
struct ShareRequest: Identifiable {
    let id = UUID()
    let file: URL
    let text: String?

    var items: [Any] {
        var out: [Any] = [file]
        if let text, !text.isEmpty { out.append(text) }
        return out
    }
}

/// Opens LINE's own share-target picker directly via its URL scheme — skips
/// the system sheet and drops the user straight into LINE's friend/group
/// picker. Falls back silently (caller should offer `ActivityShareSheet`
/// instead) when LINE isn't installed or doesn't accept the scheme.
@discardableResult
func openLineShareTarget(text: String) -> Bool {
    guard let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
          let url = URL(string: "line://msg/text/\(encoded)"),
          UIApplication.shared.canOpenURL(url)
    else { return false }
    UIApplication.shared.open(url)
    return true
}
