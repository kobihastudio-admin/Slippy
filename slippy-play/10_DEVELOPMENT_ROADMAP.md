# 10 Development Roadmap

## Phase 0: Project Setup

- Create Xcode project
- Add iOS target
- Add watchOS target
- Add shared Swift package
- Configure signing
- Configure HealthKit capability
- Configure App Groups if needed

## Phase 1: Watch MVP

- Start/Stop UI
- Core Motion tracking
- HealthKit workout session
- Basic live metrics
- Local session state
- Basic shot heuristic

## Phase 2: iPhone Sync

- WatchConnectivity
- Receive live summary
- Receive final session
- Local persistence
- Session summary screen

## Phase 3: Backend Integration

- Auth token handling
- Create sport profile
- Create session
- Upload shot events
- Complete session
- Fetch dashboard

## Phase 4: Dataset Collection

- Enable pilot recording mode
- Store raw motion windows
- Add label flow
- Export/upload dataset
- Build first ML model

## Phase 5: AI Improvement

- Train Smash / Non-Smash model
- Convert to Core ML
- Replace or augment heuristic
- Add confidence threshold

## Phase 6: Community

- Club/group linking
- Leaderboard
- Weekly challenge
- Badge
- LINE sharing

## Phase 7: Monetization

- Free vs Pro features
- Subscription screen
- Club dashboard
- Coach dashboard

## Pilot Checklist

- [ ] Test on real Apple Watch
- [ ] Confirm HealthKit permission flow
- [ ] Confirm motion sampling rate
- [ ] Confirm battery impact
- [ ] Collect test sessions from at least 10 players
- [ ] Compare detected shot count vs manual count
- [ ] Tune thresholds
- [ ] Prepare Core ML dataset

