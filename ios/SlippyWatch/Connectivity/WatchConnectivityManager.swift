import Foundation
import WatchConnectivity

final class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published var isReachable = false

    /// Set when the phone sends `.linkSession` before the user taps "start"
    /// on the Watch — consumed (and cleared) once the session actually starts.
    @Published var pendingLinkedBillId: String?
    @Published var pendingLinkedTitle: String?

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: – Send helpers

    func sendSessionStarted(sessionId: UUID, startedAt: Date, linkedBillId: String?, sport: String) {
        let formatter = ISO8601DateFormatter()
        let msg = WatchMessage(
            type:      .sessionStarted,
            sessionId: sessionId.uuidString,
            startedAt: formatter.string(from: startedAt),
            linkedSplitBillId: linkedBillId,
            sport:     sport
        )
        send(msg)
    }

    func sendLiveSummary(sessionId: UUID,
                         elapsed: Int,
                         totalShots: Int,
                         smashCount: Int,
                         heartRate: Int) {
        let msg = WatchMessage(
            type:           .liveSummary,
            sessionId:      sessionId.uuidString,
            elapsedSeconds: elapsed,
            totalShots:     totalShots,
            smashCount:     smashCount,
            currentHeartRate: heartRate
        )
        send(msg)
    }

    func sendSessionEnded(sessionId: UUID,
                          endedAt: Date,
                          totalShots: Int,
                          smashCount: Int,
                          avgHR: Int,
                          maxHR: Int,
                          calories: Double,
                          shots: [ShotEvent],
                          linkedBillId: String?,
                          sport: String) {
        let formatter = ISO8601DateFormatter()
        var msg = WatchMessage(
            type:           .sessionEnded,
            sessionId:      sessionId.uuidString,
            endedAt:        formatter.string(from: endedAt),
            totalShots:     totalShots,
            smashCount:     smashCount,
            avgHeartRate:   avgHR,
            maxHeartRate:   maxHR,
            activeCalories: calories,
            linkedSplitBillId: linkedBillId,
            sport:          sport
        )
        msg.shots = shots
        send(msg)
    }

    private func send(_ message: WatchMessage) {
        guard WCSession.default.activationState == .activated else { return }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message.toDictionary(), replyHandler: nil, errorHandler: nil)
        } else {
            // Buffer in userInfo for delivery when iPhone is available
            WCSession.default.transferUserInfo(message.toDictionary())
        }
    }
}

extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncoming(message)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        handleIncoming(userInfo)
    }

    private func handleIncoming(_ raw: [String: Any]) {
        guard let msg = WatchMessage.from(dictionary: raw), msg.type == .linkSession else { return }
        DispatchQueue.main.async {
            self.pendingLinkedBillId = msg.linkedSplitBillId
            self.pendingLinkedTitle  = msg.linkedTitle
        }
    }
}
