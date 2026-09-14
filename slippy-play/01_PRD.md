# 01 PRD: Slippy Play - Badminton AI Tracker

## 1. Product Name

**Slippy Play: Badminton**

## 2. Product Vision

Slippy Play คือโมดูลกีฬาใน Slippy ที่ช่วยให้ผู้เล่นแบดมินตันไทยสามารถติดตามพัฒนาการของตัวเองผ่าน Apple Watch, AI และ Community โดยเริ่มจากการวิเคราะห์จำนวนลูกตี, Smash, Heart Rate, Calories และ Skill Score

## 3. Positioning

> แอพ AI สำหรับคนตีแบดในไทย ที่เชื่อม Apple Watch, LINE, ก๊วนแบด และ AI Coach เข้าด้วยกัน

## 4. Target Users

### Primary Users

- คนตีแบดประจำ 1-4 ครั้งต่อสัปดาห์
- สมาชิกก๊วนแบด
- ผู้เล่นที่ใช้ Apple Watch
- คนที่อยากดูสถิติและพัฒนาฝีมือ

### Secondary Users

- โค้ชแบดมินตัน
- เจ้าของคอร์ท
- Admin ก๊วนแบด
- Organizer ทัวร์นาเมนต์เล็ก ๆ

## 5. MVP Scope

### Included in MVP

- iOS App ด้วย SwiftUI
- watchOS App ด้วย SwiftUI
- Apple Watch Start / Stop Session
- Core Motion Sensor Collection
- HealthKit Workout Integration
- Shot Count Detection
- Basic Smash Detection
- Session Summary
- Sync Watch → iPhone
- Local persistence
- API sync to backend

### Excluded from MVP

- Full tactical analysis
- Court position tracking
- Video analysis
- Multi-sport support
- Advanced coach dashboard
- Payment/subscription

## 6. Core Features

### 6.1 Player Profile

- Name
- Gender optional
- Dominant hand: right / left
- Skill level
- Main club/group
- Apple Watch connected status

### 6.2 Badminton Session

- Start session from Apple Watch
- Pause/resume
- Stop session
- Save duration
- Save total shots
- Save smash count
- Save average heart rate
- Save calories
- Save estimated intensity

### 6.3 Shot Detection

MVP should detect:

- Shot event
- Smash vs non-smash
- Confidence score
- Timestamp
- Motion summary

### 6.4 Session Summary

Show:

- Duration
- Total shots
- Smash count
- Smash ratio
- Avg heart rate
- Max heart rate
- Active calories
- AI summary text

### 6.5 LINE Sharing

Generate share card text:

```text
วันนี้เล่นแบดกับ Slippy Play
เวลาเล่น: 1 ชม. 25 นาที
จำนวนลูกตี: 486
Smash: 78 ครั้ง
Avg HR: 142 bpm
#SlippyPlay #Badminton
```

## 7. Success Metrics

- Session completion rate > 80%
- Shot detection usable accuracy > 80% in MVP test
- Watch-to-iPhone sync success > 95%
- At least 10 pilot users with 30+ sessions collected
- At least 5,000 labeled shot samples for model improvement

## 8. Business Model Later

### Free

- Basic session tracking
- Last 7 sessions
- Basic summary

### Pro

- AI Coach
- Unlimited history
- Advanced skill score
- Personal trend

### Club

- Group leaderboard
- Member analytics
- Challenge and badge

