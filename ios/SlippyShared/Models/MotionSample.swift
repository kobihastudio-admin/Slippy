import Foundation

struct MotionSample: Codable {
    let timestamp: TimeInterval
    let ax: Double
    let ay: Double
    let az: Double
    let gx: Double
    let gy: Double
    let gz: Double

    var accMagnitude: Double {
        sqrt(ax * ax + ay * ay + az * az)
    }

    var gyroMagnitude: Double {
        sqrt(gx * gx + gy * gy + gz * gz)
    }
}
