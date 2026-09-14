# 03 Watch Sensor Tracking Spec

## 1. Goal

เก็บข้อมูล motion จาก Apple Watch เพื่อใช้ตรวจจับจังหวะการตีแบดมินตัน โดยเน้นข้อมือข้างที่ถือไม้

## 2. Required Sensor Data

Use Core Motion:

- userAcceleration.x/y/z
- rotationRate.x/y/z
- attitude pitch/roll/yaw optional
- timestamp

## 3. Sampling Rate

MVP target:

```text
50 Hz minimum
100 Hz preferred if battery and watchOS allow
```

## 4. Motion Sample Model

```swift
struct MotionSample: Codable {
    let timestamp: TimeInterval
    let ax: Double
    let ay: Double
    let az: Double
    let gx: Double
    let gy: Double
    let gz: Double
}
```

## 5. Windowing Strategy

Use sliding window:

```text
Window size: 0.8 - 1.2 seconds
Overlap: 50%
```

For each window calculate:

- max acceleration magnitude
- mean acceleration magnitude
- max gyroscope magnitude
- energy
- jerk
- peak count
- dominant axis

## 6. Shot Event Detection MVP

Basic heuristic:

```text
accMagnitude = sqrt(ax² + ay² + az²)
gyroMagnitude = sqrt(gx² + gy² + gz²)

If accMagnitude > ACC_THRESHOLD
and gyroMagnitude > GYRO_THRESHOLD
and cooldown > 300ms
then create shot candidate
```

## 7. Smash Detection MVP

Smash candidate may have:

- high acceleration peak
- high gyroscope peak
- short explosive motion
- stronger downward wrist snap pattern

MVP can classify:

```text
if peakAcceleration > smashThreshold and peakGyro > smashGyroThreshold
  shotType = smash
else
  shotType = unknown
```

## 8. Cooldown

Avoid duplicate shot detection:

```text
minimumShotInterval = 300ms - 500ms
```

## 9. Battery Considerations

- Start motion updates only during active session
- Stop immediately after session ends
- Send aggregate data instead of raw sensor stream where possible
- Save raw samples only for pilot/testing mode

## 10. Pilot Data Collection Mode

For model training, add hidden/debug mode:

- Record raw sensor windows
- Allow user to label shot type manually
- Export JSON/CSV
- Upload to backend dataset endpoint

