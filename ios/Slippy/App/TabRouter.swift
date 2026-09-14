import SwiftUI

/// Lets any view (e.g. Dashboard's "ฟีเจอร์หลัก" grid) switch the active
/// bottom tab programmatically, instead of pushing a second nested
/// NavigationStack on top of a tab that already owns its own (SplitView,
/// PlayDashboardView, and the new "เพิ่มเติม" hub all wrap their own
/// NavigationStack — pushing those as a destination would double-nest).
@MainActor
final class TabRouter: ObservableObject {
    @Published var selected = 0
}
