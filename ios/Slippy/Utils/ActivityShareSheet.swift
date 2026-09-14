import SwiftUI
import UIKit

/// Thin wrapper around `UIActivityViewController` — the system share sheet,
/// which already lists LINE (and every other installed app) as a share
/// target when available, so "ส่งให้เพื่อนหรือกลุ่มในแอพหรือไลน์" works for
/// any combination of text + image items without custom per-app integration.
struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
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
