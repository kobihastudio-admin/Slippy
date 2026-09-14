# 09 Codex Implementation Prompt

Use this prompt with Codex / Claude Code / Cursor Agent.

## Prompt

You are helping build **Slippy Play: Badminton**, an iOS + Apple Watch app module for the Slippy platform.

Create an Xcode project structure with:

- iOS SwiftUI app target: `SlippyPlayApp`
- watchOS SwiftUI app target: `SlippyPlayWatchApp`
- shared Swift package/module: `SlippyPlayShared`

The MVP must support:

1. Player profile model
2. Sport session model
3. Shot event model
4. Motion sample model
5. Apple Watch start/stop session UI
6. Core Motion manager for collecting device motion
7. Basic heuristic shot detection
8. HealthKit workout manager
9. WatchConnectivity message sync to iPhone
10. iOS dashboard and session summary placeholder screens

Follow these architecture rules:

- Keep shared Codable models in `SlippyPlayShared`
- Keep HealthKit logic in `WatchWorkoutManager`
- Keep Core Motion logic in `MotionTrackingManager`
- Keep shot detection logic in `ShotDetectionEngine`
- Keep WatchConnectivity logic in `WatchConnectivityManager`
- Avoid hardcoded API secrets
- Add TODO markers for backend sync
- Use Thai UI copy where specified

Create initial files:

```text
SlippyPlayShared/Models/MotionSample.swift
SlippyPlayShared/Models/ShotEvent.swift
SlippyPlayShared/Models/SportSession.swift
SlippyPlayShared/Models/PlayerProfile.swift
SlippyPlayWatchApp/Managers/MotionTrackingManager.swift
SlippyPlayWatchApp/Managers/WatchWorkoutManager.swift
SlippyPlayWatchApp/Detection/ShotDetectionEngine.swift
SlippyPlayWatchApp/Connectivity/WatchConnectivityManager.swift
SlippyPlayWatchApp/Views/WatchHomeView.swift
SlippyPlayWatchApp/Views/LiveTrackingView.swift
SlippyPlayApp/Views/HomeDashboardView.swift
SlippyPlayApp/Views/SessionSummaryView.swift
SlippyPlayApp/Connectivity/PhoneConnectivityManager.swift
```

Implement a basic shot detection heuristic:

```text
accMagnitude = sqrt(ax^2 + ay^2 + az^2)
gyroMagnitude = sqrt(gx^2 + gy^2 + gz^2)

if accMagnitude > threshold and gyroMagnitude > threshold and cooldown passed:
  create ShotEvent
```

Use placeholder thresholds:

```text
ACC_THRESHOLD = 4.5
GYRO_THRESHOLD = 7.0
SMASH_ACC_THRESHOLD = 6.0
SMASH_GYRO_THRESHOLD = 10.0
COOLDOWN_MS = 400
```

Do not implement paid subscription yet. Do not implement full backend yet. Add API client placeholders only.

## Expected Output

- Compilable SwiftUI skeleton
- Clear folder structure
- Models and managers separated
- Mock data for iOS dashboard
- Watch app can start and stop tracking in simulator/device environment

