import Foundation

/// When the floating tab bar is shown (host-tested by `node ios/scripts/verify-tab-bar-visibility.mjs`).
///
/// The bar is drawn over the tab's content, so on a screen pushed inside a tab it covered whatever sat at the bottom (the
/// chat's text field and send button, search fields, action buttons). It is now shown only while the selected tab is at
/// its ROOT screen: each tab's root reports when it appears and disappears (a root disappears when anything is pushed
/// over it, at any depth, and appears again when the stack is popped back).
struct TabBarVisibility: Equatable {
    /// What each tab's root last reported; a tab that has not reported yet counts as showing its root.
    private var rootShowing: [Int: Bool] = [:]

    mutating func rootAppeared(tab: Int) { rootShowing[tab] = true }
    mutating func rootDisappeared(tab: Int) { rootShowing[tab] = false }

    /// A tab that is selected again is rebuilt at its root, so what it reported before no longer holds. Forgetting it
    /// avoids one frame of a hidden bar before the new root reports.
    mutating func tabSelected(_ tab: Int) { rootShowing[tab] = nil }

    func isVisible(selectedTab: Int) -> Bool { rootShowing[selectedTab] ?? true }
}
