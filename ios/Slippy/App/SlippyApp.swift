import SwiftUI
import LineSDK

@main
struct SlippyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var authVM: AuthViewModel
    @ObservedObject private var settings = AppSettings.shared
    @State private var sharedImages: [UIImage] = []
    @State private var showSharedImport = false

    init() {
        #if DEBUG
        let preview = ProcessInfo.processInfo.environment["SLIPPY_APPEARANCE_PREVIEW"] != nil
        _authVM = StateObject(wrappedValue: preview ? AuthViewModel(_preview: true) : AuthViewModel())
        #else
        _authVM = StateObject(wrappedValue: AuthViewModel())
        #endif
    }

    var body: some Scene {
        WindowGroup {
            appContent
                .environmentObject(authVM)
                .preferredColorScheme(settings.displayMode.colorScheme)
                .tint(Color.accent)
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

    @ViewBuilder private var appContent: some View {
        #if DEBUG
        if let screen = ProcessInfo.processInfo.environment["SLIPPY_APPEARANCE_PREVIEW"] {
            AppearancePreviewContent(screen: screen)
        } else {
            RootView()
        }
        #else
        RootView()
        #endif
    }
}

#if DEBUG
private struct AppearancePreviewContent: View {
    let screen: String
    @StateObject private var authVM: AuthViewModel
    @StateObject private var tabRouter = TabRouter()
    @StateObject private var splitVM = SplitViewModel()
    private let bill = try! JSONDecoder().decode(SplitBill.self, from: Data(
        #"{"id":"00000000-0000-0000-0000-000000000001","organization_id":"00000000-0000-0000-0000-000000000000","creator_id":"preview","title":"Kyushu dinner","total_amount":2400,"created_at":"2026-11-21T10:00:00Z","split_participants":[]}"#.utf8))

    init(screen: String) {
        self.screen = screen
        Self.verifyPaletteContrast()
        let preview = AuthViewModel(_preview: true)
        preview.setPreviewData(
            profile: UserProfile(id: "preview", email: "preview@example.invalid", fullName: "ทดสอบธีม", avatarUrl: nil),
            org: Organization(id: "00000000-0000-0000-0000-000000000000", name: "Slippy", plan: "pro", docQuota: 200, docUsed: 45))
        _authVM = StateObject(wrappedValue: preview)
    }

    private static func verifyPaletteContrast() {
        let pairs: [(String, Color, Color)] = [
            ("primary", .textPrimary, .surface), ("secondary", .textSecondary, .background),
            ("placeholder", .textTertiary, .inputBg), ("accent", .accent, .surface),
            ("success", .successText, .successSurface), ("warning", .warningText, .warningSurface),
            ("error", .errorText, .errorSurface), ("info", .infoText, .infoSurface),
            ("action", .textOnBrand, .brand500),
        ]
        func luminance(_ color: Color, style: UIUserInterfaceStyle) -> CGFloat {
            let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            precondition(resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
            func linear(_ value: CGFloat) -> CGFloat {
                value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
        }
        for style in [UIUserInterfaceStyle.light, .dark] {
            for (name, text, background) in pairs {
                let foreground = luminance(text, style: style), surface = luminance(background, style: style)
                let ratio = (max(foreground, surface) + 0.05) / (min(foreground, surface) + 0.05)
                precondition(ratio >= 4.5, "\(name) contrast failed in \(style): \(ratio)")
            }
        }
        print("[SlippyAppearance] 18 light/dark text contrast checks passed")
        fflush(stdout)
    }

    var body: some View {
        Group {
            switch screen {
            case "trip": TripAppearancePreview()
            case "split-redesign-details":
                CreateSplitView.redesignPreview(vm: splitVM, step: .details)
                    .environment(\.colorScheme, ProcessInfo.processInfo.environment["SLIPPY_SPLIT_TEST_STYLE"] == "light" ? .light : .dark)
            case "split-redesign-items":
                CreateSplitView.redesignPreview(vm: splitVM, step: .friends)
                    .environment(\.colorScheme, ProcessInfo.processInfo.environment["SLIPPY_SPLIT_TEST_STYLE"] == "light" ? .light : .dark)
            case "trip-map-test": TripMapTestPreview()
            case "item-edit": TripItemEditorPreview()
            case "profile": NavigationStack { ProfileView() }
            case "documents": DocumentsView()
            case "split-create": CreateSplitView(vm: splitVM)
            case "split-receipt": CreateSplitView(vm: splitVM, initialReceipt: SlipExtraction(
                vendorName: "Kyushu Dinner", totalAmount: 123.45, docDate: "2026-10-15",
                lineItems: [LineItem(name: "Dinner", qty: 0.25, unitPrice: 493.8, amount: 123.45)],
                confidence: 0.9), sourceDocumentID: "preview")
            case "split-friends": SplitFriendPickerSheet(accountID: "preview") { _, _ in }
            case "split-friends-test": SplitFriendsUITestPreview()
            case "document-split-test": NavigationStack {
                DocumentDetailContentView(previewDocument: try! JSONDecoder().decode(SlippyDocument.self, from: Data(
                    #"{"id":"00000000-0000-0000-0000-000000000099","organization_id":"00000000-0000-0000-0000-000000000000","vendor_name":"Kyushu Dinner","total_amount":123.45,"doc_date":"2026-10-15","status":"approved","source":"manual","file_path":"preview/no-file","created_at":"2026-10-15T00:00:00Z"}"#.utf8)),
                    items: [.init(id: "preview-item", description: "Dinner", qty: "0.25", unitPrice: "493.8", amount: "123.45", isNew: false)])
            }
            case "split-detail": NavigationStack { SplitDetailView(bill: bill, vm: splitVM) }
            case "more": MoreMenuView()
            case "login": LoginView()
            default: DashboardView()
            }
        }
        .environmentObject(authVM)
        .environmentObject(tabRouter)
    }
}

private struct SplitFriendsUITestPreview: View {
    @State private var showPicker = true
    @State private var selectedName = ""

    var body: some View {
        Text("Selected: \(selectedName)")
            .sheet(isPresented: $showPicker) {
                SplitFriendPickerSheet(accountID: "preview-uitest") { name, _ in
                    selectedName = name
                    showPicker = false
                }
            }
    }
}
#endif

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
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        if window?.traitCollection.userInterfaceIdiom == .pad { return .all }
        ImageViewerOrientation.trace("query")
        return ImageViewerOrientation.supportedOrientations
    }

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

@MainActor
enum ImageViewerOrientation {
    private(set) static var isEnabled = false
    private(set) static var supportedOrientations: UIInterfaceOrientationMask = .portrait

    static func open() {
        guard !isEnabled else { return }
        supportedOrientations = .allButUpsideDown
        isEnabled = true
        trace("open")
        update()
    }

    static func close() {
        guard isEnabled else { return }
        isEnabled = false
        supportedOrientations = .portrait
        trace("close")
        update(request: .portrait)
    }

    static func rotate(to orientations: UIInterfaceOrientationMask) {
        guard isEnabled else { return }
        // Retain a button-selected orientation until the viewer switches or closes.
        supportedOrientations = orientations
        trace("rotate")
        update(request: orientations)
    }

    private static func update(request: UIInterfaceOrientationMask? = nil) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              let window = scene.windows.first(where: \.isKeyWindow) else { return }
        var controller = window.rootViewController
        while let current = controller {
            current.setNeedsUpdateOfSupportedInterfaceOrientations()
            controller = current.presentedViewController
        }
        if let request, window.traitCollection.userInterfaceIdiom != .pad {
            trace("request \(request.rawValue)")
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: request)) { error in
                trace("geometry error \(error.localizedDescription)")
            }
        }
    }

    static func trace(_ event: String) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["SLIPPY_ORIENTATION_TRACE"] == "1" else { return }
        print("[SlippyOrientation] \(event) enabled=\(isEnabled) mask=\(supportedOrientations.rawValue)")
        fflush(stdout)
        #endif
    }
}
