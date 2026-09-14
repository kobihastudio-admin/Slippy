import Foundation
import WatchConnectivity

final class PhoneConnectivityManager: NSObject, ObservableObject {
    static let shared = PhoneConnectivityManager()

    @Published var isWatchReachable = false
    @Published var activeSummary: LiveSummary?
    @Published var completedSession: SportSession?

    struct LiveSummary {
        let sessionId: String
        let elapsedSeconds: Int
        let totalShots: Int
        let smashCount: Int
        let heartRate: Int
    }

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    /// Tells the Watch to attach the next workout it starts to this booked
    /// sport session (`split_bills.id`) — shown as a prompt on the idle screen.
    func linkUpcomingSession(billId: String, title: String) {
        let msg = WatchMessage(
            type: .linkSession, sessionId: billId,
            linkedSplitBillId: billId, linkedTitle: title
        )
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(msg.toDictionary(), replyHandler: nil, errorHandler: nil)
        } else {
            WCSession.default.transferUserInfo(msg.toDictionary())
        }
    }

    private func handle(message: WatchMessage) {
        switch message.type {
        case .sessionStarted:
            // Create pending session record on iPhone
            NotificationCenter.default.post(name: .watchSessionStarted, object: message)

        case .liveSummary:
            guard let elapsed = message.elapsedSeconds,
                  let shots   = message.totalShots,
                  let smash   = message.smashCount,
                  let hr      = message.currentHeartRate else { return }
            DispatchQueue.main.async {
                self.activeSummary = LiveSummary(
                    sessionId:      message.sessionId,
                    elapsedSeconds: elapsed,
                    totalShots:     shots,
                    smashCount:     smash,
                    heartRate:      hr
                )
            }

        case .sessionEnded:
            var session       = SportSession()
            session.status    = .completed
            session.endedAt   = Date()
            session.totalShots     = message.totalShots  ?? 0
            session.smashCount     = message.smashCount  ?? 0
            session.avgHeartRate   = message.avgHeartRate
            session.maxHeartRate   = message.maxHeartRate
            session.activeCalories = message.activeCalories
            session.linkedSplitBillId = message.linkedSplitBillId
            session.sport = message.sport ?? SlippySport.badminton.rawValue
            if let shots = message.shots { session.shots = shots }

            // Persist locally
            PlaySessionStore.shared.save(session: session)

            DispatchQueue.main.async {
                self.completedSession = session
                self.activeSummary    = nil
                NotificationCenter.default.post(name: .watchSessionEnded, object: session)
            }

        case .sessionPaused, .sessionResumed:
            NotificationCenter.default.post(name: .watchSessionStateChanged, object: message)

        case .linkSession:
            // Phone → Watch only; the phone never receives this back.
            break
        }
    }
}

extension PhoneConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        DispatchQueue.main.async { self.isWatchReachable = session.isReachable }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.isWatchReachable = session.isReachable }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let msg = WatchMessage.from(dictionary: message) else { return }
        handle(message: msg)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let msg = WatchMessage.from(dictionary: userInfo) else { return }
        handle(message: msg)
    }

    // macOS companion stubs
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}

extension Notification.Name {
    static let watchSessionStarted      = Notification.Name("watchSessionStarted")
    static let watchSessionEnded        = Notification.Name("watchSessionEnded")
    static let watchSessionStateChanged = Notification.Name("watchSessionStateChanged")
}
