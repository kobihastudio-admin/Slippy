# 06 API Contracts

## 1. Base URL

```text
/api/v1
```

## 2. Auth

Use JWT Bearer token.

```http
Authorization: Bearer <token>
```

## 3. Create Sport Profile

```http
POST /sport-profiles
```

```json
{
  "displayName": "Chainimit",
  "dominantHand": "right",
  "skillLevel": "intermediate",
  "primarySport": "badminton"
}
```

## 4. Start Session

```http
POST /sport-sessions
```

```json
{
  "sport": "badminton",
  "source": "apple_watch",
  "startedAt": "2026-06-20T10:00:00+07:00"
}
```

## 5. Upload Shot Events

```http
POST /sport-sessions/{sessionId}/shots/batch
```

```json
{
  "shots": [
    {
      "timestamp": "2026-06-20T10:01:01.123+07:00",
      "shotType": "smash",
      "confidence": 0.87,
      "peakAcceleration": 6.2,
      "peakGyro": 11.4
    }
  ]
}
```

## 6. Complete Session

```http
PATCH /sport-sessions/{sessionId}/complete
```

```json
{
  "endedAt": "2026-06-20T11:25:00+07:00",
  "durationSeconds": 5100,
  "totalShots": 486,
  "smashCount": 78,
  "avgHeartRate": 142,
  "maxHeartRate": 178,
  "activeCalories": 620
}
```

## 7. Get Session Summary

```http
GET /sport-sessions/{sessionId}/summary
```

## 8. Get Player Dashboard

```http
GET /sport-profiles/me/dashboard?range=30d
```

## 9. Generate AI Insight

```http
POST /sport-sessions/{sessionId}/ai-insight
```

Response:

```json
{
  "insight": "วันนี้คุณตี Smash มากกว่าสัปดาห์ก่อน 18% แต่ Heart Rate สูงเร็ว แนะนำฝึก Footwork และพักระหว่างเกมให้เหมาะสม",
  "skillScore": 72,
  "powerScore": 81,
  "staminaScore": 69,
  "consistencyScore": 66
}
```

