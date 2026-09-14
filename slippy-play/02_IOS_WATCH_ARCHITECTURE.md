# 02 iOS + watchOS Architecture

## 1. Overview

Slippy Play ใช้ iPhone เป็นศูนย์กลางของข้อมูลผู้ใช้และ Watch เป็นอุปกรณ์เก็บ motion sensor ระหว่างเล่นแบดมินตัน

```text
Apple Watch App
  ├── Core Motion
  ├── HealthKit Workout
  ├── Local Buffer
  └── WatchConnectivity
        ↓
iPhone App
  ├── Session Store
  ├── Summary UI
  ├── Sync Queue
  └── Backend API Client
        ↓
Slippy Backend
  ├── User/Profile
  ├── Sport Session
  ├── Shot Events
  ├── AI Insight
  └── Leaderboard
```

## 2. Apple Watch Responsibilities

- Start / Stop workout session
- Collect accelerometer and gyroscope data
- Detect shot event in near real-time
- Store temporary samples if iPhone unavailable
- Send session packets to iPhone
- Display simple live metrics

## 3. iPhone Responsibilities

- Login and profile management
- Pair and validate Watch connection
- Receive data from Watch
- Store local session data
- Sync to backend
- Display historical dashboard
- Generate sharing card

## 4. Backend Responsibilities

- User authentication
- Store sessions and shots
- Calculate leaderboard
- Store AI insights
- Provide historical analytics

## 5. Recommended Xcode Targets

```text
SlippyPlayApp          iOS App
SlippyPlayWatchApp     watchOS App
SlippyPlayShared       Shared Swift Package
```

## 6. Shared Modules

```text
SlippyPlayShared/
├── Models/
│   ├── SportSession.swift
│   ├── ShotEvent.swift
│   ├── MotionSample.swift
│   └── PlayerProfile.swift
├── Connectivity/
│   └── WatchMessage.swift
├── Utils/
│   └── DateEncoding.swift
└── Constants/
    └── SportConstants.swift
```

## 7. Data Flow

### Start Session

```text
iPhone or Watch user taps Start
→ Watch creates workout session
→ Watch starts motion updates
→ Watch sends sessionStarted to iPhone
→ iPhone creates pending session record
```

### During Session

```text
Watch collects motion samples
→ local classifier detects shot
→ shot event is stored locally
→ summary packet sent to iPhone every 5-10 seconds
```

### End Session

```text
User taps Stop
→ Watch closes workout
→ Watch sends final summary + shot events
→ iPhone saves locally
→ iPhone syncs to backend
```

## 8. Offline Strategy

- Watch stores active session locally until final sync
- iPhone stores sessions in local database before backend sync
- Use sync status: pending / syncing / synced / failed

## 9. Suggested Local Storage

- iOS: SwiftData or SQLite
- watchOS: lightweight JSON/SwiftData cache

## 10. Security

- HealthKit data stays permission-based
- Backend token stored in Keychain
- No raw health data sent without user consent
- Allow user to delete sessions

