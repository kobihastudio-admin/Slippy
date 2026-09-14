# Slippy Play: iOS + Apple Watch Documentation Pack

เอกสารชุดนี้ใช้สำหรับพัฒนาโมดูล **Slippy Play: Badminton AI Tracker** ภายใต้แพลตฟอร์ม Slippy โดยเน้นการทำ iOS + Apple Watch App สำหรับติดตามการเล่นแบดมินตันด้วย Apple Watch, Core Motion, HealthKit และ AI Shot Detection

## Target Local Path

ให้นำโฟลเดอร์นี้ไปวางที่:

```bash
/Users/chainimitsakhorn/Documents/Project/Slippy/slippy-play
```

## Recommended Repo Structure

```text
/Users/chainimitsakhorn/Documents/Project/Slippy/
└── slippy-play/
    ├── README.md
    ├── 01_PRD.md
    ├── 02_IOS_WATCH_ARCHITECTURE.md
    ├── 03_WATCH_SENSOR_TRACKING_SPEC.md
    ├── 04_AI_SHOT_DETECTION_SPEC.md
    ├── 05_HEALTHKIT_COREMOTION_SPEC.md
    ├── 06_API_CONTRACTS.md
    ├── 07_DATABASE_SCHEMA_PRISMA.md
    ├── 08_UI_UX_FLOW.md
    ├── 09_CODEX_IMPLEMENTATION_PROMPT.md
    └── 10_DEVELOPMENT_ROADMAP.md
```

## Development Goal

สร้าง MVP แรกของ Slippy Play ที่สามารถ:

- Login และสร้าง Player Profile
- ใช้ Apple Watch เริ่ม/หยุด Badminton Session
- เก็บ motion sensor จากข้อมือข้างที่ถือไม้
- ตรวจจับ shot event เบื้องต้น
- แยก Smash / Non-Smash ใน MVP แรก
- เก็บ Heart Rate, Active Energy, Workout Session ผ่าน HealthKit
- Sync ข้อมูลจาก Watch ไป iPhone
- ส่งข้อมูลเข้า Slippy Backend
- แสดง Session Summary และแชร์เข้า LINE ได้

