import SwiftUI
import LineSDK

@main
struct SlippyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var authVM   = AuthViewModel()
    @ObservedObject private var settings = AppSettings.shared
    @State private var sharedImages: [UIImage] = []
    @State private var showSharedImport = false

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authVM)
                .preferredColorScheme(settings.displayMode.colorScheme)
                .onOpenURL { url in
                    // Share Extension import-shared callback
                    if url.scheme == "slippy" && url.host == "import-shared" {
                        if let images = SharedContainerReader.loadPendingImages() {
                            sharedImages = images
                            showSharedImport = true
                        }
                        return
                    }
                    // LINE SDK — must handle every non-import URL so LINE callbacks work
                    _ = LoginManager.shared.application(UIApplication.shared, open: url)
                }
                .sheet(isPresented: $showSharedImport) {
                    SharedImportView(images: sharedImages) {
                        showSharedImport = false
                        sharedImages = []
                        SharedContainerReader.clearPending()
                    }
                    .environmentObject(authVM)
                }
                // Also pick up pending images when returning to foreground
                .onReceive(NotificationCenter.default.publisher(
                    for: UIApplication.willEnterForegroundNotification)
                ) { _ in
                    if let images = SharedContainerReader.loadPendingImages(), !images.isEmpty {
                        sharedImages = images
                        showSharedImport = true
                    }
                }
        }
    }
}

// MARK: – Shared container reader (App Group)

enum SharedContainerReader {
    private static let appGroupID = "group.app.slippy.shared"
    private static let pendingDir = "pending_share"

    static func loadPendingImages() -> [UIImage]? {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID) else { return nil }
        let dir = container.appendingPathComponent(pendingDir)
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path),
              !files.isEmpty else { return nil }
        let images = files
            .filter { $0.hasSuffix(".jpg") }
            .sorted()
            .compactMap { name -> UIImage? in
                let path = dir.appendingPathComponent(name)
                return (try? Data(contentsOf: path)).flatMap(UIImage.init)
            }
        return images.isEmpty ? nil : images
    }

    static func clearPending() {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID) else { return }
        let dir = container.appendingPathComponent(pendingDir)
        (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?.forEach {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent($0))
        }
    }
}

// MARK: – AppDelegate (required for Facebook SDK setup)

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // LINE SDK
        LoginManager.shared.setup(channelID: Config.lineChannelID, universalLinkURL: nil)
        return true
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        _ = LoginManager.shared.application(app, open: url)
        return true
    }
}
