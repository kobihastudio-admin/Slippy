# Slippy — Design Brief & Prototype Spec

> ไฟล์นี้ใช้สำหรับออกแบบ UI/UX prototype ของแอป **Slippy**
> ระบบจัดการเอกสารทางบัญชีอัตโนมัติด้วย AI สำหรับธุรกิจและผู้ใช้ส่วนตัว

---

## 1. Product Overview

**Slippy** คือแพลตฟอร์มจัดการเอกสารทางบัญชีที่:
- รับสลิปและใบเสร็จผ่าน **Web upload**, **LINE Bot**, หรือ **Email**
- ใช้ **OCR + AI (Claude)** ดึงข้อมูลอัตโนมัติ (ผู้ขาย, วันที่, ยอดเงิน, VAT)
- ส่งข้อมูลเข้าซอฟต์แวร์บัญชี **FlowAccount** อัตโนมัติ
- รองรับทั้ง **ธุรกิจ/นิติบุคคล** และ **ส่วนตัว/Freelance**
- Multi-organization: 1 user จัดการได้หลายองค์กร

**Target users:**
- เจ้าของธุรกิจ SME ที่ต้องจัดการใบเสร็จจำนวนมาก
- Freelancer/ผู้ประกอบอาชีพอิสระ ที่ต้องเก็บค่าใช้จ่ายส่วนตัว
- Accountant/บัญชีที่ดูแลหลายองค์กร

---

## 2. Design System

### 2.1 Brand Color

Primary brand color: **Indigo**

| Token | Hex | Usage |
|-------|-----|-------|
| `brand-50`  | `#eef2ff` | backgrounds, hover states |
| `brand-100` | `#e0e7ff` | light backgrounds |
| `brand-400` | `#818cf8` | borders, accents |
| `brand-500` | `#6366f1` | **Primary — buttons, links, active states** |
| `brand-600` | `#4f46e5` | button hover |
| `brand-700` | `#4338ca` | dark accents |
| `brand-900` | `#312e81` | deep backgrounds |

### 2.2 Semantic Tokens (Light Mode)

| Token | Value (HSL) | Description |
|-------|-------------|-------------|
| `background` | `0 0% 100%` | Page background (white) |
| `foreground` | `224 71% 4%` | Primary text (near-black) |
| `card` | `0 0% 100%` | Card background |
| `muted` | `220 14% 96%` | Subtle backgrounds |
| `muted-foreground` | `220 9% 46%` | Secondary text |
| `border` | `220 13% 91%` | Borders |
| `primary` | `239 84% 67%` | = brand-500 |
| `destructive` | `0 84% 60%` | Errors, delete |

### 2.3 Semantic Tokens (Dark Mode)

| Token | Value (HSL) |
|-------|-------------|
| `background` | `224 71% 4%` (deep navy) |
| `card` | `217 33% 8%` |
| `muted` | `217 33% 14%` |
| `border` | `217 33% 17%` |
| `sidebar-bg` | `222 47% 5%` (darker navy) |

### 2.4 Sidebar Colors

| Token | Light | Dark |
|-------|-------|------|
| `sidebar-bg` | near-white `0 0% 99%` | deep navy `222 47% 5%` |
| `sidebar-fg` | `222 47% 11%` | `210 40% 98%` |
| `sidebar-muted` | `220 9% 46%` | `215 20% 45%` |
| `sidebar-active` | `239 84% 67%` (indigo-500) | same |
| `sidebar-border` | `220 13% 91%` | `217 33% 12%` |

### 2.5 Typography

- **Font**: System font stack (San Francisco / Segoe UI / Roboto)
- **Base size**: 14px (`text-sm`)
- **Headings**: 16–24px, `font-semibold` / `font-bold`
- **Labels**: 12px (`text-xs`), often `uppercase tracking-wider` for section headers

### 2.6 Spacing & Shape

- **Border radius**: `0.625rem` (~10px) — rounded but not pill
- **Card padding**: `p-5` (20px) or `p-6` (24px)
- **Sidebar width**: 256px expanded, 60px collapsed
- **Header height**: ~57px

### 2.7 Status Colors

| Status | Color | Usage |
|--------|-------|-------|
| Pending | `text-muted-foreground` + neutral badge | รอประมวลผล |
| Processing | `text-blue-500` + blue badge | กำลัง OCR |
| Reviewing | `text-amber-500` + amber badge | รอตรวจสอบ |
| Approved | `text-emerald-500` + green badge | อนุมัติแล้ว |
| Pushed | `text-purple-500` + purple badge | ส่งเข้าบัญชีแล้ว |
| Failed | `text-red-500` + red badge | ล้มเหลว |
| Rejected | `text-slate-500` + slate badge | ปฏิเสธ |

### 2.8 Tech Stack (สำหรับอ้างอิง)

- **Framework**: Next.js 15 (App Router), React 19
- **Styling**: Tailwind CSS v3 + CSS Variables
- **Icons**: Lucide React
- **Charts**: Recharts
- **UI Primitives**: Radix UI
- **Notifications**: Sonner (toast)

---

## 3. Layout Structure

```
┌─────────────────────────────────────────────┐
│  HEADER (sticky, z-30)                       │
│  [☰ mobile] [Page Title]    [🌐] [🌙] [🔔]  │
├──────────┬──────────────────────────────────┤
│          │                                  │
│ SIDEBAR  │  MAIN CONTENT                    │
│ (256px)  │  (scrollable)                    │
│          │                                  │
│ Logo     │                                  │
│ ──────   │                                  │
│ Org      │                                  │
│ Switcher │                                  │
│ ──────   │                                  │
│ Nav      │                                  │
│ items    │                                  │
│ ──────   │                                  │
│ Settings │                                  │
│ ──────   │                                  │
│ User     │                                  │
│ Footer   │                                  │
└──────────┴──────────────────────────────────┘
```

**Responsive behavior:**
- **Mobile** (`< lg`): Sidebar = fixed overlay drawer, hamburger button in header
- **Desktop** (`≥ lg`): Sidebar = static flex child, collapsible to 60px icon-only mode

---

## 4. Current Screens (Implemented)

### 4.1 Auth — `/login`
- Email + Password form
- "ลืมรหัสผ่าน" link
- Link to `/register`
- Logo + brand name centered

### 4.2 Auth — `/register`
- Full name, email, password fields
- Terms checkbox
- Auto-redirect to onboarding after signup

### 4.3 Onboarding — `/onboarding`
**Step 1 — Personal Info**
- Full name input (pre-filled from auth)
- Email (read-only)

**Step 2 — Organization**
- Toggle: **ธุรกิจ** | **ส่วนตัว/Freelance**
- Business: ชื่อบริษัท + เลขผู้เสียภาษี 13 หลัก + ที่อยู่ + เดือนสิ้นปีบัญชี
- Personal: ชื่อบัญชี + เดือนสิ้นปีบัญชีเท่านั้น
- Progress indicator (Step 1 → 2)

### 4.4 Dashboard — `/dashboard`
**Stats row (4 cards):**
- เอกสารเดือนนี้ (count)
- รอตรวจสอบ (pending review count)
- ยอดรวม (total amount THB)
- ภาษีซื้อ (total VAT)

**Recent documents table:**
- file name, vendor, amount, status badge, date, action button

**Quick upload zone:**
- Drag & drop area
- Status: idle / uploading / processing

### 4.5 Documents — `/documents`
**Filters bar:**
- Search input
- Status filter dropdown
- Date range picker
- Upload button

**Document table/list:**
- Columns: ไฟล์, ผู้ขาย, ยอดเงิน, VAT, สถานะ, วันที่, การดำเนินการ
- Status badges (colored)
- Row actions: ดูรายละเอียด, อนุมัติ, ส่งเข้าบัญชี, ปฏิเสธ
- Empty state illustration

### 4.6 Document Review — `/documents/[id]/review`
**Split layout:**
- Left: Document image/PDF preview
- Right: Extracted data form
  - ผู้ขาย (vendor name)
  - วันที่เอกสาร
  - เลข invoice
  - ยอดก่อน VAT
  - VAT 7%
  - ยอดรวม
  - หมวดหมู่ (category)
  - Line items table
- Confidence score indicator
- Validation warnings
- Action buttons: อนุมัติ / แก้ไขและอนุมัติ / ปฏิเสธ / ส่งเข้า FlowAccount

### 4.7 Analytics — `/analytics`
**Charts:**
- Bar chart: รายจ่ายรายเดือน (12 เดือน)
- Pie chart: สัดส่วนตามหมวดหมู่
- Line chart: เทรนด์ VAT

**Summary cards:**
- ยอดรวมปีนี้
- VAT ที่ขอคืนได้
- จำนวนเอกสารทั้งหมด
- ผู้ขายที่ใช้บ่อย (top 5)

### 4.8 Tax — `/tax`
**VAT Section:**
- ตาราง VAT ซื้อ (Input VAT) รายเดือน
- ตาราง VAT ขาย (Output VAT) รายเดือน
- VAT คงเหลือ / ภาษีที่ต้องชำระ

**WHT Section:**
- ตาราง Withholding Tax ที่ถูกหัก

### 4.9 Billing — `/billing`
**Current plan card:**
- Plan name, next billing date
- Doc quota progress bar (used / total)

**Plan comparison grid (4 columns):**
| | Free | Starter | Pro ⭐ | Enterprise |
|--|------|---------|--------|------------|
| Price | ฟรี | ฿490/เดือน | ฿990/เดือน | ติดต่อสอบถาม |
| Documents | 50 | 500 | ไม่จำกัด | ไม่จำกัด |
| Connectors | 1 | 3 | ทั้งหมด | ทั้งหมด |
| API | ✗ | ✗ | ✓ | ✓ |

**Add-on Doc Packs (3 cards):**
- 100 เอกสาร = ฿199 ครั้งเดียว
- 300 เอกสาร = ฿499 ครั้งเดียว ⭐ คุ้มสุด
- 500 เอกสาร = ฿799 ครั้งเดียว

**Invoice history table**

### 4.10 Settings — `/settings`
Tabbed or stacked sections:
- **ข้อมูลองค์กร**: ชื่อ, tax ID, ที่อยู่, เดือนสิ้นปีบัญชี
- **LINE Bot**: Connect code generator, ลิสต์ผู้เชื่อมต่อ, ปุ่มยกเลิก

### 4.11 Settings — `/settings/members`
- ตารางสมาชิก (ชื่อ, email, role, วันที่เข้าร่วม)
- ปุ่ม Invite member
- เปลี่ยน role dropdown
- Remove member

### 4.12 Settings — `/settings/integrations`
- FlowAccount integration card (connect/disconnect + sync button)
- ลิสต์ integration อื่น ๆ ที่จะรองรับในอนาคต (coming soon)

### 4.13 New Organization — `/new-org`
- Toggle: ธุรกิจ | ส่วนตัว
- Same form as onboarding Step 2
- ปุ่มยกเลิก + สร้างองค์กร

---

## 5. Key UI Components

### Sidebar — Org Switcher Dropdown
```
┌─────────────────────────────────┐
│ 🏢 บริษัท ABC จำกัด    ╲       │
│    free                 ▼       │
└─────────────────────────────────┘
         ↓ (on click)
┌─────────────────────────────────┐
│ 🏢 บริษัท ABC จำกัด       ✓   │
│    pro · owner                  │
│ ────────────────────────────── │
│ 🏢 บัญชีส่วนตัว                │
│    free · owner                 │
│ ────────────────────────────── │
│ ➕ สร้างองค์กรใหม่              │
└─────────────────────────────────┘
```

### Document Status Badge
```
⏳ รอดำเนินการ   → neutral gray
🔄 กำลังประมวล  → blue
👀 รอตรวจสอบ    → amber
✅ อนุมัติแล้ว  → emerald
📤 ส่งเข้าบัญชี → purple
❌ ล้มเหลว      → red
🚫 ปฏิเสธ       → slate
```

### Document Upload Area
```
┌─────────────────────────────────────────┐
│                                         │
│        📤 ลากไฟล์มาวางที่นี่           │
│     หรือ คลิกเพื่อเลือกไฟล์           │
│                                         │
│   รองรับ: PDF, JPG, PNG (สูงสุด 20MB)  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 6. User Flows

### Flow A: Upload → OCR → Approve → Push

```
1. Upload file (drag & drop หรือ LINE/Email)
2. Document record ถูกสร้าง (status: pending)
3. ระบบ queue → OCR + AI extraction (status: processing)
4. ถ้า confidence สูง → auto-approve (status: approved)
   ถ้า confidence ต่ำ → รอ manual review (status: reviewing)
5. User เข้าหน้า Review → ตรวจสอบข้อมูล → กดอนุมัติ
6. กดส่งเข้า FlowAccount → ระบบ push (status: pushed)
```

### Flow B: LINE Bot

```
1. User เพิ่ม LINE Bot
2. ส่งคำสั่ง /connect CODE (code จากหน้า Settings)
3. Bot เชื่อมบัญชี → แจ้ง "เชื่อมสำเร็จ"
4. ส่งรูปสลิป → Bot รับ → แจ้ง "รับแล้ว กำลัง OCR"
5. OCR เสร็จ → Bot push แจ้งผล (สถานะ + ความถูกต้อง %)
6. ส่ง /summary → ดูยอดรวมเดือนนี้
7. ส่ง /status → ดูเอกสาร 5 รายการล่าสุด
```

### Flow C: Multi-org Switch

```
1. คลิก org switcher ใน sidebar
2. Dropdown แสดง org ทั้งหมด
3. เลือก org → cookie เปลี่ยน → redirect /dashboard
4. ข้อมูลทั้งหมดเป็นของ org ใหม่
```

---

## 7. Screens to Design / Improve

ส่วนที่ต้องการ prototype หรือ redesign (เรียงตามความสำคัญ):

### Priority 1 — Core Flow
1. **Document Review page** — split-view สำหรับตรวจสอบเอกสาร (UI ที่สำคัญที่สุด)
2. **Dashboard** — redesign ให้ข้อมูลดูชัดขึ้น, เพิ่ม recent activity feed
3. **Document List** — table + card view toggle, better filter UX

### Priority 2 — Onboarding & Setup
4. **Onboarding wizard** — ให้ smooth และ friendly มากขึ้น
5. **Empty states** — แต่ละหน้าที่ยังไม่มีข้อมูล (illustration + CTA)
6. **LINE Bot connect flow** — QR code หรือ step-by-step guide

### Priority 3 — Analytics & Reports
7. **Analytics dashboard** — chart layout ที่ดีขึ้น, date range filter
8. **Tax summary** — กระดาน VAT ที่เข้าใจง่าย

### Priority 4 — Mobile
9. **Mobile document upload** — ถ่ายรูปด้วยกล้อง
10. **Mobile document list** — card-based layout

---

## 8. Design Requests (Specific)

### 8.1 Document Review — Split Layout
- **Left panel (60%)**: Document viewer (image/PDF), zoom controls, page navigation
- **Right panel (40%)**: Extracted data form with edit capability
- Confidence score: progress bar หรือ gauge พร้อม color (red < 70%, yellow 70-90%, green > 90%)
- Warning chips: แสดง validation issues เช่น "VAT คำนวณไม่ตรง", "วันที่ในอนาคต"
- Line items table: เพิ่ม/แก้ไข/ลบ row ได้

### 8.2 Dashboard Redesign
- Stats cards: แสดง % เปลี่ยนแปลงจากเดือนก่อน (↑ ↓)
- Recent uploads: รายการล่าสุด 5 รายการพร้อม thumbnail
- Quick action: ปุ่ม upload ขนาดใหญ่, shortcut ไป review queue
- Alert banner: แจ้งเตือนเมื่อโควต้าใกล้เต็ม

### 8.3 Org Switcher Dropdown
- แสดง plan badge (Free / Starter / Pro) ต่างสี
- แสดง role (Owner / Admin / Member)
- Hover animation smooth
- "สร้างองค์กรใหม่" option พร้อม icon ➕

### 8.4 Mobile Upload Experience
- Camera capture button (ถ่ายตรง)
- Gallery picker
- Preview + crop ก่อน upload
- Processing animation

### 8.5 Billing Page
- Plan comparison เป็น visual card ที่ชัดเจน
- Pro plan: highlighted border + "แนะนำ" badge
- ปุ่ม upgrade: gradient หรือ brand color โดดเด่น
- Add-on packs: แสดง "ราคาต่อเอกสาร" ชัดเจน

---

## 9. Animation & Interaction Notes

- **Page transitions**: fade-in (`animate-fade-in` — 200ms ease)
- **Sidebar collapse**: `transition-[width] duration-200`
- **Mobile drawer**: `transition-transform duration-200 ease-in-out`
- **Loading states**: Skeleton screens (ไม่ใช่ spinner) สำหรับ list/table
- **File upload**: progress bar แบบ indeterminate ระหว่าง OCR
- **Toast notifications**: Sonner (top-right, auto-dismiss 4s)
- **Dropdown**: smooth open/close, chevron rotate 180°

---

## 10. Localization

- **Primary language**: Thai (ภาษาไทย)
- **Secondary**: English (toggle ได้จาก header)
- **Currency**: ฿ (THB) — format: `฿1,234.56`
- **Date format**: Thai locale `DD/MM/YYYY` หรือ relative "3 ชั่วโมงที่แล้ว"
- **Number format**: Thai locale with comma separator

---

## 11. Sample Data (สำหรับ prototype)

### Sample Documents
```
1. ใบเสร็จ 7-Eleven      ฿  285.00   VAT ฿  18.64   ✅ approved
2. ค่า Grab (เดินทาง)    ฿  450.00   VAT ฿  29.44   👀 reviewing
3. ค่า AWS (Jan 2026)     ฿8,750.00   VAT ฿571.96   ✅ approved → 📤 pushed
4. ค่าไฟฟ้า MEA          ฿1,230.00   VAT ฿  80.37   ⏳ pending
5. ค่าอินเทอร์เน็ต AIS   ฿  599.00   VAT ฿  39.15   ❌ failed
```

### Sample Stats (Dashboard)
```
เอกสารเดือนนี้:  47 ใบ  (+12% จากเดือนก่อน)
รอตรวจสอบ:       8 ใบ
ยอดรวม:    ฿142,380  (+8%)
ภาษีซื้อ:   ฿ 9,307
```

### Sample Org
```
องค์กร 1: บริษัท เอบีซี จำกัด   (Pro plan)
องค์กร 2: บัญชีส่วนตัว          (Free plan)
```

---

## 12. Figma / Prototype Notes

- **Frame size**: Desktop 1440×900, Mobile 390×844
- **Component library**: ใช้ Shadcn/UI style (based on Radix UI primitives)
- **Grid**: 12-column, 24px gutter, 24px margin
- **Color styles**: ตาม Section 2 (Light + Dark mode)
- **Icon set**: Lucide Icons (https://lucide.dev)
- **Prototype interactions**: ให้ทำ clickable prototype ครบ Core Flow (Upload → Review → Approve)

---

*Last updated: 2026-05-18 | Stack: Next.js 15 + Supabase + Stripe + LINE Bot*
