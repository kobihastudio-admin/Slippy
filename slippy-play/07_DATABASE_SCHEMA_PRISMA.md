# 07 Database Schema - Prisma Draft

```prisma
model SportProfile {
  id            String   @id @default(cuid())
  userId        String   @unique
  displayName   String
  dominantHand  String   // right, left
  skillLevel    String   // beginner, casual, intermediate, advanced, competitive
  primarySport  String   @default("badminton")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  sessions      SportSession[]
}

model SportSession {
  id              String   @id @default(cuid())
  profileId       String
  sport           String   @default("badminton")
  source          String   @default("apple_watch")
  status          String   @default("active") // active, completed, failed
  startedAt       DateTime
  endedAt         DateTime?
  durationSeconds Int?

  totalShots      Int      @default(0)
  smashCount      Int      @default(0)
  avgHeartRate    Int?
  maxHeartRate    Int?
  activeCalories  Float?

  syncStatus      String   @default("pending") // pending, synced, failed
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  profile         SportProfile @relation(fields: [profileId], references: [id])
  shots           SportShot[]
  insight         SportAIInsight?
}

model SportShot {
  id                String   @id @default(cuid())
  sessionId         String
  timestamp         DateTime
  shotType          String   // unknown, smash, clear, drive, drop, serve
  confidence        Float
  peakAcceleration  Float?
  peakGyro          Float?
  energy            Float?
  rawWindowRef      String?
  createdAt         DateTime @default(now())

  session           SportSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId])
  @@index([shotType])
  @@index([timestamp])
}

model SportAIInsight {
  id                String   @id @default(cuid())
  sessionId         String   @unique
  insightText       String
  skillScore        Int?
  powerScore        Int?
  staminaScore      Int?
  consistencyScore  Int?
  createdAt         DateTime @default(now())

  session           SportSession @relation(fields: [sessionId], references: [id])
}

model SportLeaderboard {
  id          String   @id @default(cuid())
  clubId      String?
  profileId   String
  period      String   // daily, weekly, monthly
  metric      String   // total_shots, smash_count, active_minutes
  score       Float
  rank        Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([clubId, period, metric])
}
```

