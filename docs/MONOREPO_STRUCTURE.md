# โครงสร้าง repository ของ Slippy

สถานะ: active — ตรวจเฉพาะโครงสร้างไฟล์ในเครื่อง
วันที่ตรวจ: 2026-09-13
ผู้รับผิดชอบ: รอมอบหมายโดยผู้ดูแลโปรเจกต์

ชื่อโปรเจกต์คือ Slippy; checkout ที่ตรวจครั้งนี้ยังอยู่ที่ `Accounting/doc-hub/` ชื่อ `slippy/` ในแผนผังเป็นชื่อเชิงตรรกะ ไม่ได้หมายความว่าย้ายโฟลเดอร์ในเครื่องแล้ว

```text
slippy/
├── web/                       # เว็บ Next.js และ public assets
├── api/                       # API, pipeline และ queue workers
├── mobile/                    # แอป Expo / React Native
├── ios/                       # แอป native iOS และ Watch
├── android/                   # แอป native Android
├── packages/types/            # shared types
├── workers/
│   ├── email-ingestion/
│   └── line-bot/
├── scripts/                   # สคริปต์ระดับ repository
├── supabase/                  # config, migrations และ functions
├── synology-container-stack/  # container deployment และคู่มือ NAS
├── slippy-play/               # ชุดข้อกำหนด Slippy Play
├── docs/
│   ├── README.md              # สารบัญและสถานะเอกสาร
│   ├── documentation-policy.md
│   ├── assets/                # ทะเบียนและกติกาภาพ/แบรนด์
│   ├── design/                # DESIGN_BRIEF.md
│   ├── operations/            # incident และคู่มือระบบ
│   ├── travel/                # เอกสารแผนเดินทาง
│   └── superpowers/
│       ├── specs/             # แบบออกแบบ
│       └── plans/             # แผนดำเนินงาน
├── README.md                  # เริ่มต้นใช้งานโปรเจกต์
├── prototypes/index.html      # หน้าต้นแบบแยกจากแอปจริง
├── tools/line-rich-menu/       # เครื่องมือจัดการ LINE rich menu
└── package.json               # npm workspaces: web, api, packages/*
```

รายการนี้เป็นโครงสร้างที่มีจริง ไม่ได้หมายความว่าทุกโฟลเดอร์เป็น npm workspace หรือถูก deploy อยู่ ไฟล์ build, dependencies, credentials และ worktrees ไม่รวมในแผนผัง

เริ่มค้นเอกสารที่ [สารบัญ](README.md) และรูปภาพที่ [ทะเบียนภาพ](assets/README.md) ภาพของแต่ละแพลตฟอร์มคงอยู่ในตำแหน่งที่แอปอ้างอิง
