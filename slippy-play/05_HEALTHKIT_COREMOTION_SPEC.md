# 05 HealthKit + Core Motion Spec

## 1. Required Apple Frameworks

- SwiftUI
- HealthKit
- CoreMotion
- WatchKit
- WatchConnectivity
- Foundation

## 2. HealthKit Permissions

Request read/write permissions for:

- workoutType
- heartRate
- activeEnergyBurned
- distanceWalkingRunning optional

## 3. Workout Session

Use HKWorkoutSession for badminton-like workout.

Suggested activity type:

```swift
.badminton
```

Fallback if not available in target version:

```swift
.other
```

## 4. Metrics to Capture

- startTime
- endTime
- duration
- averageHeartRate
- maxHeartRate
- activeEnergy
- workoutUUID

## 5. Core Motion Manager

Use `CMMotionManager` or `CMDeviceMotion`.

Recommended:

```swift
motionManager.deviceMotionUpdateInterval = 1.0 / 50.0
motionManager.startDeviceMotionUpdates(to: queue) { motion, error in
    // collect acceleration and gyro
}
```

## 6. Watch Connectivity Messages

### Session Started

```json
{
  "type": "session_started",
  "sessionId": "uuid",
  "startedAt": "iso-date"
}
```

### Live Summary

```json
{
  "type": "live_summary",
  "sessionId": "uuid",
  "elapsedSeconds": 120,
  "totalShots": 45,
  "smashCount": 8,
  "currentHeartRate": 142
}
```

### Session Ended

```json
{
  "type": "session_ended",
  "sessionId": "uuid",
  "endedAt": "iso-date",
  "totalShots": 486,
  "smashCount": 78,
  "avgHeartRate": 142,
  "activeCalories": 620
}
```

## 7. Privacy Text

Add clear Thai permission description:

```text
Slippy Play ขอใช้ข้อมูลสุขภาพและการเคลื่อนไหวจาก Apple Watch เพื่อวิเคราะห์การเล่นแบดมินตันของคุณ เช่น อัตราการเต้นหัวใจ แคลอรี่ และจำนวนครั้งการตี
```

## 8. Info.plist Keys

Add:

```text
NSHealthShareUsageDescription
NSHealthUpdateUsageDescription
NSMotionUsageDescription
```

