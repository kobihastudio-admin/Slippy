# iOS: อัพโหลดเอกสารแบบไม่ต้องรอ + แจ้งเตือนเอกสารนอกขอบเขต

วันที่: 2026-08-13
สถานะ: อนุมัติแล้ว — พร้อม implement

## ปัญหา

ปัจจุบันบน native iOS ([`CameraPickerView`](../../../ios/Slippy/Views/Documents/CameraPickerView.swift)) เมื่อผู้ใช้
เลือกเอกสาร แอปจะพาไปหน้า "ตรวจสอบก่อนอัพโหลด" แล้ว auto-upload เบื้องหลัง จากนั้น
`pollServerResult()` วนรอผลจาก AI **นานถึง ~4 นาที โดยผู้ใช้ต้องค้างอยู่หน้านั้น**
กว่าจะกดออกได้อย่างปลอดภัย

ผลที่ตามมา:

1. ผู้ใช้ถูกจับเป็นตัวประกันของ pipeline — ปิดหน้าจอไปคือเสี่ยงโดนลบเอกสารทิ้ง
   (`discardUploaded()` ทำงานตอน `dismiss()`)
2. `pollServerResult()` เช็คแค่ `extracted_at != nil || status == "failed"`
   **ไม่รู้จัก `status == "rejected"`** — เอกสารที่ scope gate ปฏิเสธจึงวนรอจนครบ
   4 นาที แล้วขึ้น "อ่านไม่สำเร็จ" แทนที่จะบอกว่าไม่ใช่เอกสารการเงินและคืนเครดิตแล้ว
3. ปุ่มสแกนกลางของ [`MainTabView`](../../../ios/Slippy/Views/MainTabView.swift) เรียก
   `CameraPickerView()` โดยไม่ส่ง `onUploadSuccess` → หน้าหลักไม่ refresh หลังอัพโหลด

## สิ่งที่ฝั่ง server มีอยู่แล้ว (ไม่ต้องเขียนใหม่)

[`api/src/pipeline/scope-gate.ts`](../../../api/src/pipeline/scope-gate.ts) +
[`api/src/pipeline/index.ts:203-235`](../../../api/src/pipeline/index.ts):

- `checkDocumentScope()` ตัดสินว่าเป็นเอกสารการเงินไหม (ใบเสร็จ/ใบกำกับภาษี/ใบแจ้งหนี้/
  สลิป/ใบลดหนี้) โดยดูจาก `doc_category` หรือหลักฐานเชิงตัวเลข (มียอดเงิน/มีรายการ)
- ถ้าไม่ผ่าน: เรียก `decrement_doc_used` **คืนโควตาให้แล้ว**, set `status = "rejected"`,
  เขียนเหตุผลภาษาไทยลง `notes`, และ `recordActivity("document.rejected")`

งานนี้จึงไม่ได้เขียนตรรกะการตรวจหรือการคืนเครดิตใหม่ — แค่ทำให้ iOS **รู้และแสดงผล**

## ขอบเขตงาน

### 1. `UploadTracker` — service ใหม่ (แกนของงาน)

ไฟล์ใหม่: `ios/Slippy/Services/UploadTracker.swift`

Singleton แบบเดียวกับ `GalleryStore.shared` เพราะต้องอยู่รอดหลัง sheet ปิดและสลับแท็บ

```swift
@MainActor final class UploadTracker: ObservableObject {
    static let shared = UploadTracker()
    struct Rejection: Identifiable { let id: String; let reason: String }

    @Published private(set) var pending: [String]     // document ids ที่ยังประมวลผล
    @Published var rejections: [Rejection]            // คิว alert บนหน้าหลัก
    @Published private(set) var revision = 0          // bump ทุกครั้งที่สถานะเปลี่ยน

    func track(documentIds: [String])
    func dismissRejection(_ id: String)
}
```

Poll ทุก 3 วินาที ด้วย query เดียว:
`select("id,status,notes,extracted_at").in("id", values: pending)`

เกณฑ์ว่าเอกสารหนึ่ง "จบ" แล้ว:

| เงื่อนไข | ผลลัพธ์ |
|---|---|
| `status == "rejected"` | เข้าคิว `rejections` พร้อม `notes` จาก server |
| `status == "failed"` | จบแบบผิดพลาด (เอกสารยังอยู่ใน list ตามสถานะจริง) |
| `extracted_at != nil` | สำเร็จ |
| ครบ ~5 นาที | เลิกติดตาม (เพดานเดียวกับ pipeline timeout ฝั่ง server) |

- หยุด poll เมื่อ `pending` ว่าง
- พักตอนแอปเข้า background, ต่อเมื่อกลับมา `.active`
- `revision` bump ทั้งตอน `track()` (เพื่อให้หน้าหลักโชว์แถวใหม่ทันที) และตอนเอกสารจบ

### 2. `CameraPickerView` — ตัด flow รอ AI ทิ้ง

- `performIngest`: enhance ภาพ → `SlipOCRService.quickFacts` (เพื่อเอา QR tax-id ที่
  server ถือว่า authoritative) → **upload ทันที** → `UploadTracker.shared.track(ids)` →
  `dismiss()`
- แสดง overlay "กำลังอัพโหลดเอกสาร..." เฉพาะช่วง upload จริง (~1-3 วิ);
  ส่วนที่ช้าคือ AI ซึ่งย้ายไปรอเบื้องหลังแล้ว
- **เก็บไว้**: quality gate ("ถ่ายใหม่ / ใช้รูปนี้"), select mode, import PDF/ไฟล์,
  Apple Notes, คลังพัก, `triggerServerOCR` พร้อม `userConfirmed` จาก QR
- **ลบทิ้ง**: `previewModeView` และ sections ย่อยทั้งหมด, `autoUpload`,
  `pollServerResult`, `finalizeDocument`, `retryRead`, `discardUploaded`,
  `confirmLeave`, `showUploadResult`, `uploadedResultEx`, `isReadingByAI`,
  `aiReadFailed`, `isBackgroundUpload`, `userConfirmedPages`, `PickerMode`

`quickFacts` เดิมรันเฉพาะหน้าแรกแบบ lazy (เพราะ preview เป็นตัว trigger) — ตอนนี้รัน
ให้ทุกหน้าใน loop เดียวกับ enhance (bounded concurrency 3) เพื่อให้ QR tax-id ของทุก
หน้าถูกส่งขึ้น server

### 2.5 คลังพัก (`GalleryView`) ก็ต้องเข้า tracker ด้วย

"ส่งเข้าระบบ" จากคลังพักเป็นอีก path หนึ่งที่ insert เอกสารสถานะ `processing` แล้วยิง
pipeline เดียวกัน — โดนปฏิเสธและถูกคืนเครดิตได้เหมือนกันทุกประการ `commit()` จึงคืน
document ids กลับมาให้ `commitSelected()` ส่งเข้า `UploadTracker.shared.track()`

### 3. ย้ายแท็ก + แชร์เพื่อนไป `DocumentDetailView`

`document_tag_links` และ `document_shares` มีอยู่ที่หน้า "ตรวจสอบก่อนอัพโหลด" **ที่เดียว
ในแอป** การลบหน้านั้นจะทำให้ทั้งสองฟีเจอร์เข้าไม่ถึงเลย จึงต้องย้าย UI ไปไว้ใน
`DocumentDetailView` (ซึ่งแก้ชื่อร้าน/หมวด/รายการ/หมุนภาพได้อยู่แล้ว)

### 4. ซ่อนเอกสารที่ถูกปฏิเสธ

- `DashboardViewModel.fetchRecent` → `.neq("status", value: "rejected")`
- `DocumentsViewModel.fetch` → เพิ่มเงื่อนไขเดียวกันเมื่อ `filterStatus == nil`

แถวยังคงอยู่ใน DB เพราะ server ใช้เป็นสัญญาณ abuse และ alert ต้องอ่าน `notes` จากมัน

### 5. หน้าหลัก (`DashboardView`)

- แถบ "กำลังประมวลผล N ฉบับ" เหนือ `summarySection` ผูกกับ `tracker.pending`
- `.onChange(of: tracker.revision)` → `loadData()` (อัพเดทเอกสารล่าสุด, ยอดเงิน,
  แถบเครดิต ในคราวเดียว)
- `.alert` จาก `tracker.rejections.first`: หัวข้อ "ไม่ใช่เอกสารการเงิน",
  ข้อความ = `notes` จาก server (ซึ่งบอกอยู่แล้วว่าคืนโควตาให้แล้ว), กด "ตกลง" →
  `dismissRejection` แล้วเด้งตัวถัดไปในคิว

### 6. Server — notification ตอนปฏิเสธ

- `api/src/pipeline/index.ts` สาขา reject: เพิ่ม `createNotification({ type:
  "document_rejected", title: "เอกสารไม่เข้าเกณฑ์ — คืนเครดิตแล้ว", body: scope.reason,
  organizationId, metadata: { document_id } })`
- เพิ่ม mapping `document_rejected` ใน `ios/Slippy/Models/AppNotification.swift`
  (`xmark.circle.fill` / rose `#f43f5e`)
- เพิ่ม case เดียวกันใน `web/src/app/(app)/notifications/page.tsx` เพื่อรักษา parity

## สิ่งที่ไม่ทำ

- ไม่เพิ่ม push notification / Supabase realtime — แอปยังไม่มีทั้งสองอย่าง และ poll
  เฉพาะเอกสารที่ค้างก็เพียงพอสำหรับ flow นี้
- ไม่แก้ Android / web / LINE — งานนี้จำกัดที่ native iOS + จุดเดียวใน pipeline
- ไม่แตะตรรกะ `checkDocumentScope` หรือการคืนโควตา (ทำงานถูกต้องอยู่แล้ว)
