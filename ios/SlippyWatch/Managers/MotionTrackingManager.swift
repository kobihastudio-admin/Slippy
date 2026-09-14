import Foundation
import CoreMotion

final class MotionTrackingManager: ObservableObject {
    private let motionManager = CMMotionManager()
    private let queue = OperationQueue()

    @Published var isTracking = false
    @Published var latestSample: MotionSample?

    var onSample: ((MotionSample) -> Void)?

    private let sampleRate: Double = 50.0

    func startTracking() {
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 1.0 / sampleRate
        isTracking = true

        motionManager.startDeviceMotionUpdates(to: queue) { [weak self] motion, error in
            guard let motion, error == nil else { return }

            let sample = MotionSample(
                timestamp: motion.timestamp,
                ax: motion.userAcceleration.x,
                ay: motion.userAcceleration.y,
                az: motion.userAcceleration.z,
                gx: motion.rotationRate.x,
                gy: motion.rotationRate.y,
                gz: motion.rotationRate.z
            )

            DispatchQueue.main.async {
                self?.latestSample = sample
                self?.onSample?(sample)
            }
        }
    }

    func stopTracking() {
        motionManager.stopDeviceMotionUpdates()
        isTracking = false
    }
}
