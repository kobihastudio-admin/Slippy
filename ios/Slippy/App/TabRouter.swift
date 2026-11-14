import SwiftUI

/// Lets any view (e.g. Dashboard's "ฟีเจอร์หลัก" grid) switch the active
/// bottom tab programmatically, instead of pushing a second nested
/// NavigationStack on top of a tab that already owns its own (SplitView,
/// PlayDashboardView, and the new "เพิ่มเติม" hub all wrap their own
/// NavigationStack — pushing those as a destination would double-nest).
@MainActor
final class TabRouter: ObservableObject {
    @Published var selected = 0 {
        didSet { if selected != oldValue { barVisibility.tabSelected(selected) } }
    }

    /// Whether each tab is at its root screen (see `TabBarVisibility`): the floating tab bar is shown only there, so it
    /// never covers the bottom of a pushed screen (the chat's text field, search fields, action buttons).
    @Published private(set) var barVisibility = TabBarVisibility()

    var isTabBarVisible: Bool { barVisibility.isVisible(selectedTab: selected) }

    func rootAppeared(tab: Int) { barVisibility.rootAppeared(tab: tab) }
    func rootDisappeared(tab: Int) { barVisibility.rootDisappeared(tab: tab) }
}

/// Marks the ROOT screen of a tab. Put it on a view inside that tab's `NavigationStack` root: SwiftUI makes the root
/// disappear when anything is pushed over it and appear again when the stack is popped back, which is exactly when the
/// floating tab bar has to hide and come back.
private struct FloatingTabBarRoot: ViewModifier {
    @EnvironmentObject private var tabRouter: TabRouter
    let tab: Int

    func body(content: Content) -> some View {
        content
            .onAppear { tabRouter.rootAppeared(tab: tab) }
            .onDisappear { tabRouter.rootDisappeared(tab: tab) }
    }
}

extension View {
    func floatingTabBarRoot(tab: Int) -> some View { modifier(FloatingTabBarRoot(tab: tab)) }
}
