import Foundation

final class ShotDetectionEngine: ObservableObject {
    // Heuristic thresholds (tunable)
    private let accThreshold:      Double = 4.5
    private let gyroThreshold:     Double = 7.0
    private let smashAccThreshold: Double = 6.0
    private let smashGyroThreshold: Double = 10.0
    private let cooldownSeconds:   Double = 0.4

    private var lastShotTime: Date?

    @Published var detectedShots: [ShotEvent] = []
    @Published var totalShots: Int = 0
    @Published var smashCount: Int = 0

    var onShotDetected: ((ShotEvent) -> Void)?

    func process(sample: MotionSample) {
        let acc  = sample.accMagnitude
        let gyro = sample.gyroMagnitude

        guard acc > accThreshold, gyro > gyroThreshold else { return }

        let now = Date()
        if let last = lastShotTime, now.timeIntervalSince(last) < cooldownSeconds { return }
        lastShotTime = now

        let shotType: ShotType = (acc > smashAccThreshold && gyro > smashGyroThreshold) ? .smash : .unknown
        let confidence: Double = min(1.0, (acc / smashAccThreshold + gyro / smashGyroThreshold) / 2)
        let energy = acc * gyro

        let event = ShotEvent(
            timestamp:        now,
            shotType:         shotType,
            confidence:       confidence,
            peakAcceleration: acc,
            peakGyro:         gyro,
            energy:           energy
        )

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.detectedShots.append(event)
            self.totalShots  += 1
            if shotType == .smash { self.smashCount += 1 }
            self.onShotDetected?(event)
        }
    }

    func reset() {
        detectedShots = []
        totalShots    = 0
        smashCount    = 0
        lastShotTime  = nil
    }
}
