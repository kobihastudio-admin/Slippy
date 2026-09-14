import Foundation
import Combine

final class WatchSessionViewModel: ObservableObject {
    // Sub-managers
    let workout     = WatchWorkoutManager()
    let motion      = MotionTrackingManager()
    let detection   = ShotDetectionEngine()
    let connectivity = WatchConnectivityManager.shared

    @Published var sessionId: UUID?
    @Published var phase: SessionPhase = .idle
    /// Captured from `connectivity.pendingLinkedBillId` at the moment the
    /// session starts — kept stable for the rest of the workout even if the
    /// phone clears its pending link in the meantime.
    @Published var linkedBillId: String?
    @Published var linkedTitle: String?
    /// Chosen on the idle screen before tapping "เริ่ม" — defaults to
    /// badminton (the original sport), but Slippy Play now tracks others too.
    @Published var selectedSport: SlippySport = .badminton

    // Live mirror
    @Published var elapsedSeconds: Int = 0
    @Published var totalShots: Int     = 0
    @Published var smashCount: Int     = 0
    @Published var heartRate: Int      = 0
    /// True session average/max, not just "right now" — see WatchWorkoutManager.
    @Published var avgHeartRate: Int   = 0
    @Published var maxHeartRate: Int   = 0

    private var cancellables = Set<AnyCancellable>()
    private var liveSummaryTimer: Timer?

    enum SessionPhase { case idle, running, paused, ended }

    init() {
        workout.requestAuthorization()
        bindManagers()
    }

    private func bindManagers() {
        workout.$elapsedSeconds
            .receive(on: RunLoop.main)
            .assign(to: &$elapsedSeconds)

        workout.$heartRate
            .receive(on: RunLoop.main)
            .assign(to: &$heartRate)

        workout.$avgHeartRate
            .receive(on: RunLoop.main)
            .assign(to: &$avgHeartRate)

        workout.$maxHeartRate
            .receive(on: RunLoop.main)
            .assign(to: &$maxHeartRate)

        detection.$totalShots
            .receive(on: RunLoop.main)
            .assign(to: &$totalShots)

        detection.$smashCount
            .receive(on: RunLoop.main)
            .assign(to: &$smashCount)

        motion.onSample = { [weak self] sample in
            self?.detection.process(sample: sample)
        }
    }

    // MARK: – Actions

    func startSession() {
        let id = UUID()
        sessionId   = id
        phase       = .running
        linkedBillId = connectivity.pendingLinkedBillId
        linkedTitle  = connectivity.pendingLinkedTitle
        // Consumed — clears the idle-screen prompt once a workout starts.
        connectivity.pendingLinkedBillId = nil
        connectivity.pendingLinkedTitle  = nil

        workout.startSession(sport: selectedSport)
        motion.startTracking()
        detection.reset()
        connectivity.sendSessionStarted(sessionId: id, startedAt: .now, linkedBillId: linkedBillId, sport: selectedSport.rawValue)
        startLiveSummaryTimer()
    }

    func pauseSession() {
        workout.pauseSession()
        motion.stopTracking()
        liveSummaryTimer?.invalidate()
        phase = .paused
    }

    func resumeSession() {
        workout.resumeSession()
        motion.startTracking()
        startLiveSummaryTimer()
        phase = .running
    }

    func endSession() {
        guard let id = sessionId else { return }
        motion.stopTracking()
        liveSummaryTimer?.invalidate()
        phase = .ended

        workout.endSession { [weak self] elapsed, calories in
            guard let self else { return }
            self.connectivity.sendSessionEnded(
                sessionId:  id,
                endedAt:    .now,
                totalShots: self.totalShots,
                smashCount: self.smashCount,
                avgHR:      self.avgHeartRate,
                maxHR:      self.maxHeartRate,
                calories:   calories,
                shots:      self.detection.detectedShots,
                linkedBillId: self.linkedBillId,
                sport:      self.selectedSport.rawValue
            )
        }
    }

    // MARK: – Live summary every 10 seconds

    private func startLiveSummaryTimer() {
        liveSummaryTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            guard let self, let id = self.sessionId else { return }
            self.connectivity.sendLiveSummary(
                sessionId:  id,
                elapsed:    self.elapsedSeconds,
                totalShots: self.totalShots,
                smashCount: self.smashCount,
                heartRate:  self.heartRate
            )
        }
    }

    // MARK: – Helpers

    var elapsedFormatted: String {
        let h = elapsedSeconds / 3600
        let m = (elapsedSeconds % 3600) / 60
        let s = elapsedSeconds % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%02d:%02d", m, s)
    }
}
