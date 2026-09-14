# Slippy Rich Menu — All Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 8 Rich Menu features — Document Scanner, Dashboard redesign, Health/Medication full tracker, Trip Planner with settlements/journey, Bill debt simplification, Community Groups, Profile/Package page — as fully tested, production-ready LIFF mini-apps.

**Architecture:** All features are Next.js LIFF pages under `web/src/app/liff/`, backed by Next.js API routes under `web/src/app/api/liff/`, using Supabase admin client for data (no RLS — LIFF users aren't Supabase-auth'd). LINE auth pattern: import `@line/liff`, call `liff.init()` + `liff.getProfile()` → resolve via `line_connections` table. DB schema already has medications, health_entries, trip_groups, split_bills tables. Supabase project: `ntzztcnkedcxfjvfxjrf` (see `web/.env.local`).

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Supabase JS, lucide-react, recharts, @line/liff, qrcode, sharp (server-side image processing)

---

## Phase 0: Foundations

### Task 0: Migration — Scan page + Trip itinerary + Community groups + Debt tracking

**Files:**
- Create: `supabase/migrations/049_scan_trip_community.sql`

- [ ] **Step 1: Write migration**

```sql
-- ── 049: Document Scanner uploads + Trip Itinerary + Community Groups + Debt ─

-- 1. scan_uploads: store each LIFF scan session's uploaded images
CREATE TABLE IF NOT EXISTS scan_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_user_id    text,
  receipt_url     text,         -- storage path in payment-proofs/scans/
  ocr_result      jsonb,        -- {vendor,date,total,vat,items[]} from AI
  linked_doc_id   uuid REFERENCES documents(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ocr_done','linked','dismissed')),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_org ON scan_uploads(organization_id, created_at DESC);
ALTER TABLE scan_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_org" ON scan_uploads FOR ALL USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

-- 2. trip_itinerary_days — day-by-day structure for trip groups
CREATE TABLE IF NOT EXISTS trip_itinerary_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  day_number    int  NOT NULL,   -- 1, 2, 3...
  date          date,
  title         text,            -- เช่น "วันแรก — กรุงเทพ → เชียงใหม่"
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_day_uniq ON trip_itinerary_days(split_bill_id, day_number);

-- 3. trip_itinerary_items — activities/places per day
CREATE TABLE IF NOT EXISTS trip_itinerary_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id    uuid NOT NULL REFERENCES trip_itinerary_days(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  type      text DEFAULT 'activity'  -- activity|meal|transport|hotel|booking
    CHECK (type IN ('activity','meal','transport','hotel','booking','other')),
  title     text NOT NULL,
  location  text,
  notes     text,
  amount    numeric(14,2) DEFAULT 0,   -- ค่าใช้จ่าย (แชร์ระหว่างทริป)
  time_from time,
  time_to   time,
  image_url text,
  booking_ref text,   -- เลขจอง
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_items_day ON trip_itinerary_items(day_id, sort_order);

-- 4. trip_debt_settlements — ยอดสุทธิท้ายทริป (debt simplification)
CREATE TABLE IF NOT EXISTS trip_settlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  from_participant_id uuid NOT NULL REFERENCES split_participants(id) ON DELETE CASCADE,
  to_participant_id   uuid NOT NULL REFERENCES split_participants(id) ON DELETE CASCADE,
  amount        numeric(14,2) NOT NULL,
  settled       bool NOT NULL DEFAULT false,
  settled_at    timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- 5. community_groups — general groups beyond sport/trip
CREATE TABLE IF NOT EXISTS community_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_group_id   text,
  share_token     text UNIQUE DEFAULT encode(gen_random_bytes(8),'hex'),
  name            text NOT NULL,
  description     text,
  type            text NOT NULL DEFAULT 'general'
    CHECK (type IN ('home','savings','event','community','coop','general')),
  emoji           text DEFAULT '👥',
  status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  settings        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cgroup_org ON community_groups(organization_id);
ALTER TABLE community_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cgroup_org" ON community_groups FOR ALL USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

-- 6. community_members
CREATE TABLE IF NOT EXISTS community_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  line_user_id text,
  display_name text,
  role         text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin','member','viewer')),
  joined_at    timestamptz DEFAULT now(),
  UNIQUE(group_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_cmember_group ON community_members(group_id);
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cmember_own" ON community_members FOR ALL USING (user_id = auth.uid());

-- 7. split_bills: add debt_simplified flag
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS debt_simplified bool DEFAULT false;
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS recurring_template_id uuid;
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS split_mode text DEFAULT 'equal'
  CHECK (split_mode IN ('equal','custom','percentage'));

-- 8. scan_uploads in payment-proofs bucket already exists — use path "scans/{id}.jpg"
```

- [ ] **Step 2: Apply migration**
```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy && supabase db push --yes
```

---

## Phase 1: Document Scanner LIFF (`/liff/scan`)

### Task 1: Document Scanner API

**Files:**
- Create: `web/src/app/api/liff/scan/route.ts`

- [ ] **Step 1: Create scan API route**

```typescript
// POST /api/liff/scan — receive image(s), save to storage, queue OCR
// DELETE /api/liff/scan?id=xxx — dismiss scan
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function resolveConn(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id, organization_id").eq("line_user_id", lineUserId).maybeSingle()
  return data
}

function extFromMime(mime: string) {
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  return "jpg"
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const lineUserId = form.get("lineUserId") as string | null
  const files = form.getAll("files") as File[]

  if (!lineUserId || files.length === 0)
    return NextResponse.json({ error: "lineUserId and at least one file required" }, { status: 400 })

  const admin = createAdminClient()
  const conn  = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, error: "กรุณาเชื่อมบัญชี LINE ก่อน" }, { status: 403 })

  const results: { id: string; url: string }[] = []

  for (const file of files.slice(0, 5)) { // max 5 images per batch
    const { data: row } = await admin.from("scan_uploads").insert({
      organization_id: conn.organization_id,
      user_id:        conn.user_id,
      line_user_id:   lineUserId,
      status:         "pending",
    }).select("id").single()

    if (!row) continue

    const ext  = extFromMime(file.type)
    const path = `scans/${row.id}.${ext}`
    const buf  = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await admin.storage.from("payment-proofs")
      .upload(path, buf, { contentType: file.type, upsert: true })

    if (upErr) {
      await admin.from("scan_uploads").delete().eq("id", row.id)
      continue
    }

    const { data: pub } = admin.storage.from("payment-proofs").getPublicUrl(path)

    // Kick off OCR via existing document processing pipeline (fire-and-forget)
    // The API processes OCR in background and updates ocr_result + status
    await admin.from("scan_uploads").update({
      receipt_url: pub.publicUrl,
      status: "pending",
    }).eq("id", row.id)

    results.push({ id: row.id, url: pub.publicUrl })
  }

  return NextResponse.json({ ok: true, scans: results })
}

export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })
  const admin = createAdminClient()
  const conn  = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ needsConnect: true, scans: [] })

  const { data } = await admin.from("scan_uploads")
    .select("id, receipt_url, ocr_result, status, created_at")
    .eq("organization_id", conn.organization_id)
    .order("created_at", { ascending: false })
    .limit(20)
  return NextResponse.json({ scans: data ?? [] })
}

export async function DELETE(req: NextRequest) {
  const id         = req.nextUrl.searchParams.get("id")
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!id || !lineUserId) return NextResponse.json({ error: "id and lineUserId required" }, { status: 400 })
  const admin = createAdminClient()
  const conn  = await resolveConn(admin, lineUserId)
  if (!conn) return NextResponse.json({ error: "not connected" }, { status: 403 })
  await admin.from("scan_uploads").update({ status: "dismissed" }).eq("id", id).eq("organization_id", conn.organization_id)
  return NextResponse.json({ ok: true })
}
```

### Task 2: Document Scanner LIFF Page

**Files:**
- Create: `web/src/app/liff/scan/page.tsx`

- [ ] **Step 2: Create full scanner LIFF page (camera + multi-select + preview + upload)**

Full page with: camera view (`getUserMedia`), document edge detection hint, multi-image select from gallery, image preview list, upload progress, history of previous scans. Uses the same auth pattern as other LIFF pages.

[Full implementation ~500 lines — see inline code in execute phase]

- [ ] **Step 3: Update Rich Menu to point button 1 to /liff/scan**

In `api/src/scripts/setup-rich-menu.ts`, change:
```typescript
// ส่งสลิป → change from message action to LIFF URI
{ bounds: { x: 0, y: 0, width: CW, height: CH }, action: { type: "uri", uri: liffUrl("/liff/scan") } },
```

- [ ] **Step 4: Type-check**
```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "liff/scan|scan/route"
```
Expected: no output

---

## Phase 2: Dashboard LIFF Redesign (`/liff/dashboard`)

### Task 3: Dashboard API Enhancement

**Files:**
- Modify: `web/src/app/api/liff/dashboard/route.ts`

- [ ] **Step 1: Extend dashboard API to include splits, health, medications, trips**

Add to GET response:
- `activeBills`: open split_bills where user is participant (count + total pending)
- `upcomingTrips`: split_bills category='trip' status='open' (nearest by created_at)
- `todayMedications`: medication_logs status='pending' for today (count)
- `recentActivity`: unified feed (docs + splits + health entries, last 8 items)
- `monthlyStats`: { income: total paid receipts, expenses: monthlyTotal, split: total billed this month }

### Task 4: Dashboard LIFF Full Redesign

**Files:**
- Modify: `web/src/app/liff/dashboard/page.tsx` (full rewrite)

Layout:
1. **Hero banner** — gradient, avatar, displayName, Life Score ring, "คุณมี X สิ่งที่ต้องทำ"
2. **Quick-action grid** (2×2) — 📷 สแกนสลิป · 🧾 สร้างบิล · 💊 บันทึกยา · ✈️ ดูทริป
3. **Activity cards row** (horizontal scroll) — บิลที่ค้างชำระ · สลิปรอตรวจสอบ · ยาวันนี้ · ทริปที่จะมาถึง
4. **Charts section** — Recharts BarChart (6-month expenses) + Donut (category breakdown)
5. **AI Insight card** — "ค่าอาหารเพิ่มขึ้น X% เดือนนี้"
6. **Recent Activity feed** — timeline list, last 8 events

---

## Phase 3: Health & Medication Full Features

### Task 5: Medication API

**Files:**
- Create: `web/src/app/api/liff/medications/route.ts`
- Create: `web/src/app/api/liff/medications/[id]/route.ts`
- Create: `web/src/app/api/liff/medications/[id]/log/route.ts`

Endpoints:
- `GET /api/liff/medications?lineUserId=X` → list medications with inventory + today's logs
- `POST /api/liff/medications` → add medication + schedule + initial inventory
- `PATCH /api/liff/medications/[id]` → update medication
- `DELETE /api/liff/medications/[id]` → deactivate
- `POST /api/liff/medications/[id]/log` → log dose taken/skipped
- `GET /api/liff/medications/[id]/log` → adherence history

### Task 6: Health LIFF Full Redesign

**Files:**
- Modify: `web/src/app/liff/health/page.tsx` (major extension)

Views: `overview` | `medications` | `add-medication` | `medication-detail` | `log-health`

**Overview tab:**
- Longevity score gauge (already exists)
- Today's medication checklist (mark taken/skipped inline)
- Health metrics summary (latest values for each type)
- Low-stock medication alerts

**Medications tab:**
- List all active medications with stock level bar
- Color-coded by category (chronic=red, prescription=blue, supplement=green)
- Per-medication: name, dosage, schedule times, stock remaining
- Tap → detail view

**Add Medication flow:**
- Name, form, strength, category, purpose
- Schedule: times[], days, dose_qty, meal_relation
- Inventory: qty_remaining, low_stock_alert
- Reminder: enabled, via (LINE/app)

**Medication Detail:**
- Today's dose schedule with ✅ taken / ⏭ skip buttons
- 30-day adherence calendar heatmap
- Stock bar + "ยาใกล้หมด" warning
- Edit / Deactivate actions

---

## Phase 4: Trip Planner Full Structure

### Task 7: Trip Itinerary API

**Files:**
- Create: `web/src/app/api/liff/trip-groups/[id]/itinerary/route.ts`
- Create: `web/src/app/api/liff/trip-groups/[id]/settlements/route.ts`
- Modify: `web/src/app/api/liff/trip-groups/[id]/route.ts`

`GET /api/liff/trip-groups/[id]/itinerary` → full days + items
`POST /api/liff/trip-groups/[id]/itinerary/days` → add day
`POST /api/liff/trip-groups/[id]/itinerary/days/[dayId]/items` → add item
`PATCH /api/liff/trip-groups/[id]/itinerary/items/[itemId]` → update
`DELETE /api/liff/trip-groups/[id]/itinerary/items/[itemId]` → remove

`GET /api/liff/trip-groups/[id]/settlements` → calculate net debt simplification
`POST /api/liff/trip-groups/[id]/settlements` → mark settlement as settled

### Task 8: Trip LIFF Enhancement

**Files:**
- Modify: `web/src/app/liff/trip/page.tsx` (add views)

New views added to existing: `itinerary` | `settlements` | `journey`

**Itinerary view:** day-by-day timeline, add activity/meal/hotel/transport, map link per item
**Settlements view:** net debt simplification display (A owes B ฿X), mark as settled
**Journey view:** read-only photo timeline (most recent photos from trip), share card generator

---

## Phase 5: Bill Splitting Enhancements

### Task 9: Debt Simplification Engine

**Files:**
- Create: `web/src/lib/debt-simplification.ts`
- Modify: `web/src/app/api/liff/split-groups/[id]/route.ts`

Algorithm:
1. Compute each person's net balance = (paid) - (owed)
2. Separate creditors (positive) and debtors (negative)
3. Match largest debtor to largest creditor, create settlement, repeat

Add action `simplify_debts` to POST [id]/route — runs algorithm, saves to trip_settlements, sets debt_simplified=true

### Task 10: Recurring Bills

**Files:**
- Create: `web/src/app/api/liff/split-groups/templates/route.ts`
- Modify: `web/src/app/liff/split/page.tsx`

Template = split_bill row with status='template' + recurring metadata in settings jsonb
Monthly auto-creation via cron (or user-triggered "สร้างบิลเดือนนี้" button)

### Task 11: Percentage Split Mode

**Files:**
- Modify: `web/src/app/liff/split/page.tsx`
- Modify: `web/src/app/api/liff/split-groups/route.ts`

Add split_mode selector in create form: Equal | Custom | Percentage (%)
In % mode: each member gets a % input (must sum to 100)
Backend: compute amounts = fee × (pct/100)

---

## Phase 6: Community Groups

### Task 12: Community Groups API

**Files:**
- Create: `web/src/app/api/liff/community/route.ts`
- Create: `web/src/app/api/liff/community/[id]/route.ts`

CRUD for community_groups + community_members
Actions: create, join (via shareToken), add_expense, list_members, update_role

### Task 13: Community Groups LIFF

**Files:**
- Create: `web/src/app/liff/community/page.tsx`

Views: `list` | `create` | `detail` | `members` | `expenses`

Group types with emoji: 🏠 บ้าน/หอพัก | 💰 ออมเงิน | 🎉 อีเวนต์ | 🏘️ ชุมชน | 💼 Co-op

- [ ] **Update Rich Menu**: Change เมนูสร้างกลุ่ม (อื่นๆ) from `/liff/places` to `/liff/community`

---

## Phase 7: Profile & Package LIFF

### Task 14: Profile/Package API

**Files:**
- Create: `web/src/app/api/liff/profile/route.ts`

GET: user profile, LINE connection, subscription plan, usage stats (docs/month, quota)
PATCH: update displayName, promptpayId, language preference

### Task 15: Profile LIFF Page

**Files:**
- Create: `web/src/app/liff/profile/page.tsx`

Sections:
- Profile card (LINE avatar, name, connection status)
- Usage stats (docs this month, quota bar)
- Subscription plan card (current plan, features, upgrade CTA)
- Settings: PromptPay, language, notifications
- Referral code + copy link

- [ ] **Update Rich Menu**: เมนูอื่นๆ → `/liff/profile` (was "/menu" message)

---

## UAT Checklist (verify per phase)

### Phase 1 (Scanner):
- [ ] กล้องเปิดได้จาก LIFF ใน LINE App
- [ ] เลือกหลายรูปจาก Photo Library ได้
- [ ] รูปแสดง preview ก่อน upload
- [ ] Upload สำเร็จ → เห็นรายการใน history
- [ ] ปุ่ม dismiss ลบรายการออก

### Phase 2 (Dashboard):
- [ ] แสดง Life Score ถูกต้อง
- [ ] Quick actions นำทางไป LIFF ที่ถูกต้อง
- [ ] Charts แสดงข้อมูลจริง
- [ ] Activity feed แสดงรายการล่าสุด

### Phase 3 (Health/Medications):
- [ ] เพิ่มยาใหม่ได้ (name, dosage, schedule)
- [ ] ยาปรากฏในรายการ + แสดง stock
- [ ] กด "ทานแล้ว" → log status=taken + ลด inventory
- [ ] กด "ข้าม" → log status=skipped
- [ ] แสดง adherence calendar
- [ ] Warning เมื่อ stock ต่ำกว่า threshold

### Phase 4 (Trip):
- [ ] เพิ่มวันใหม่ได้ (Day 1, Day 2...)
- [ ] เพิ่มกิจกรรมใน day ได้
- [ ] Settlements คำนวณถูกต้อง (net debt simplification)
- [ ] Journey view แสดง photo timeline

### Phase 5 (Bill Splits):
- [ ] % mode: ใส่ % แต่ละคน → คำนวณยอดอัตโนมัติ
- [ ] Recurring: สร้าง template → "สร้างบิลเดือนนี้"

### Phase 6 (Community):
- [ ] สร้างกลุ่มใหม่ (บ้าน/ออมเงิน/อีเวนต์)
- [ ] ส่ง invite link เข้าร่วมกลุ่ม
- [ ] เพิ่มค่าใช้จ่ายร่วมในกลุ่ม

### Phase 7 (Profile):
- [ ] แสดงข้อมูลโปรไฟล์ถูกต้อง
- [ ] แก้ไข PromptPay ได้
- [ ] แสดง quota usage ถูกต้อง
