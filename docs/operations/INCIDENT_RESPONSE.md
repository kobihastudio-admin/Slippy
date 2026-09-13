# Incident Response Runbook — Slippy

> **ระดับความลับ:** ภายในองค์กร (Internal)  
> **เจ้าของ:** ทีม Security / DevOps  
> **ปรับปรุงล่าสุด:** 2026-05-25  
> **เวอร์ชั่น:** 1.0

---

## 1. ขอบเขต (Scope)

Runbook นี้ครอบคลุมเหตุการณ์ด้านความปลอดภัยสารสนเทศ (Security Incidents) ทุกประเภทที่กระทบต่อระบบ Slippy รวมถึง:

- การรั่วไหลของข้อมูลส่วนบุคคล (Personal Data Breach)
- การเข้าถึงระบบโดยไม่ได้รับอนุญาต (Unauthorized Access)
- การโจมตี DDoS / Service Outage
- การถูก Ransomware หรือ Malware
- การ Misconfiguration ที่ทำให้ข้อมูลเปิดเผย

---

## 2. ระดับความรุนแรง (Severity Levels)

| ระดับ | ชื่อ | ตัวอย่าง | เวลาตอบสนอง |
|-------|------|----------|-------------|
| **P1** | Critical | ข้อมูลลูกค้ารั่ว, production DB เปิดเผย | **ทันที — ภายใน 1 ชม.** |
| **P2** | High | Auth bypass, privilege escalation | ภายใน 4 ชั่วโมง |
| **P3** | Medium | Log exposure, rate-limit bypass | ภายใน 24 ชั่วโมง |
| **P4** | Low | Minor config drift, informational | ภายใน 7 วัน |

---

## 3. ทีมตอบสนอง (Response Team)

| บทบาท | ผู้รับผิดชอบ | ช่องทางติดต่อ |
|-------|-------------|--------------|
| Incident Commander (IC) | CTO | Slack `#security-alerts` + โทรตรง |
| Security Lead | Head of Engineering | Slack + อีเมล |
| DPO (Data Protection Officer) | ตำแหน่ง DPO | อีเมล dpo@slippy.app |
| Customer Success | CS Lead | แจ้งลูกค้าที่ได้รับผลกระทบ |
| Legal | ที่ปรึกษากฎหมาย | กรณีต้องแจ้ง PDPC |

---

## 4. ขั้นตอนการตอบสนอง (Response Phases)

### 4.1 ตรวจพบเหตุการณ์ (Detection & Identification)

**แหล่งตรวจจับหลัก:**
- Supabase Dashboard → Logs → Auth / API logs
- Vercel Runtime Logs / Error alerts
- ระบบ `document_audit_logs` ใน DB
- การแจ้งเตือนจากลูกค้า / ผู้ใช้

**ขั้นตอน:**
1. รวบรวมข้อมูลเบื้องต้น:
   - เกิดอะไรขึ้น? เมื่อไหร่? ขอบเขตกว้างแค่ไหน?
   - ข้อมูลประเภทใดที่อาจได้รับผลกระทบ (PII, เอกสารทางบัญชี, ข้อมูลองค์กร)?
2. กำหนด Severity Level (ดูตารางด้านบน)
3. เปิด Incident Channel: `#incident-YYYY-MM-DD` ใน Slack
4. แจ้ง IC ทันที

---

### 4.2 ควบคุมความเสียหาย (Containment)

#### การรั่วไหลของข้อมูล / การเข้าถึงโดยไม่ได้รับอนุญาต

```bash
# 1. Revoke Supabase service role key ที่ถูก compromise
# → Supabase Dashboard > Settings > API > Regenerate keys

# 2. Force-logout user ที่น่าสงสัยทุกคน
# → Supabase Dashboard > Authentication > Users > Invalidate session

# 3. เพิ่ม IP blocklist ชั่วคราวผ่าน Vercel Edge Config หรือ Middleware
# ไฟล์: web/src/middleware.ts

# 4. ปิดการอัพโหลดเอกสารชั่วคราว (ถ้าจำเป็น)
# → Set environment variable: NEXT_PUBLIC_MAINTENANCE_MODE=true
```

#### Service Outage / DDoS
```bash
# 1. ตรวจสอบ Vercel DDoS Protection Dashboard
# 2. เพิ่ม Rate Limiting rules ใน Vercel Edge
# 3. Scale up Supabase compute tier ถ้า DB overwhelmed
```

---

### 4.3 สืบสวน (Investigation)

**Query สำหรับตรวจสอบ audit trail:**

```sql
-- ดูการกระทำทั้งหมดบน documents ที่น่าสงสัย
SELECT
  dal.action,
  dal.actor_id,
  dal.created_at,
  d.organization_id,
  d.vendor_name,
  d.total_amount
FROM document_audit_logs dal
JOIN documents d ON d.id = dal.document_id
WHERE dal.created_at BETWEEN '<start_time>' AND '<end_time>'
ORDER BY dal.created_at DESC;

-- ดู Auth events จาก Supabase
-- Supabase Dashboard > Logs > Auth Logs > filter by email / IP
```

**รวบรวมหลักฐาน:**
- Export Supabase logs ช่วงเวลาที่เกิดเหตุ (JSON)
- Screenshot / บันทึก Vercel Request logs
- บันทึก IP addresses ทั้งหมดที่เกี่ยวข้อง
- เก็บ hash ของไฟล์ที่อาจถูกแก้ไข

---

### 4.4 แจ้งเตือน (Notification)

#### แจ้งลูกค้า (กรณีข้อมูลรั่วไหล — ภายใน 72 ชั่วโมง)

> ⚠️ **PDPA กำหนด:** ต้องแจ้ง PDPC ภายใน **72 ชั่วโมง** หากมีการรั่วไหลของข้อมูลส่วนบุคคล

**Template อีเมลแจ้งลูกค้า:**

```
เรียน คุณ [ชื่อ],

เราขอแจ้งให้ท่านทราบว่าเมื่อ [วันที่/เวลา] ทาง Slippy ได้พบเหตุการณ์
ด้านความปลอดภัยที่อาจกระทบต่อข้อมูลขององค์กรท่าน

ข้อมูลที่อาจได้รับผลกระทบ: [รายละเอียด]
สิ่งที่เราดำเนินการแล้ว: [รายการ]
สิ่งที่ท่านควรดำเนินการ: [รายการ]

เราได้แจ้งต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (PDPC) เรียบร้อยแล้ว
หากท่านมีคำถามเพิ่มเติม กรุณาติดต่อ dpo@slippy.app

ขออภัยในความไม่สะดวก
ทีม Slippy
```

#### แจ้ง PDPC (สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล)

- URL: https://www.pdpc.or.th
- ช่องทาง: แบบฟอร์มออนไลน์ / อีเมล pdpc@mdes.go.th
- ต้องแจ้งภายใน 72 ชั่วโมงนับจากตรวจพบ
- ระบุ: ประเภทข้อมูล, จำนวนผู้ได้รับผลกระทบ, มาตรการที่ดำเนินการ

---

### 4.5 กู้คืน (Recovery)

```bash
# 1. ตรวจสอบว่า vulnerability ถูกปิดแล้ว
# 2. Deploy hotfix ผ่าน Vercel (zero-downtime)
vercel --prod

# 3. Regenerate credentials ที่ถูก compromise ทั้งหมด:
#    - Supabase JWT secret
#    - Service role key
#    - API keys ใน environment variables

# 4. Force password reset สำหรับ users ที่ได้รับผลกระทบ
# → Supabase Dashboard > Authentication > Send password reset

# 5. รัน security scan
npm audit
```

**Checklist ก่อน resume operations:**
- [ ] Root cause ถูกระบุและแก้ไขแล้ว
- [ ] Credentials ทั้งหมด rotate แล้ว
- [ ] Security logs กลับมา normal
- [ ] ลูกค้าที่ได้รับผลกระทบได้รับแจ้งแล้ว
- [ ] PDPC ได้รับแจ้งแล้ว (ถ้าจำเป็น)

---

### 4.6 บันทึกและเรียนรู้ (Post-Incident Review)

ภายใน **5 วันทำการ** หลังจาก incident ถูกปิด ให้จัดประชุม Post-Mortem:

**หัวข้อที่ต้องครอบคลุม:**
1. Timeline ของเหตุการณ์ (เกิดขึ้น → ตรวจพบ → ปิด)
2. Root cause analysis (5 Whys)
3. ความเสียหายที่เกิดขึ้นจริง
4. มาตรการป้องกันในอนาคต (Preventive Actions)
5. อัปเดต Runbook นี้ถ้าจำเป็น

**บันทึกที่ต้องเก็บ:**
- เก็บไว้ใน `supabase/incidents/YYYY-MM-DD-[summary].md`
- เก็บอย่างน้อย 5 ปี (ตามนโยบาย data retention)

---

## 5. ผู้ติดต่อฉุกเฉิน (Emergency Contacts)

| บริการ | ช่องทาง |
|--------|---------|
| Supabase Support | https://supabase.com/dashboard/support |
| Vercel Support | https://vercel.com/help |
| PDPC (Thailand) | pdpc@mdes.go.th / 02-142-1033 |
| ที่ปรึกษา Cyber Security | [ใส่ผู้ติดต่อ] |

---

## 6. ประวัติการปรับปรุง (Changelog)

| วันที่ | เวอร์ชั่น | การเปลี่ยนแปลง | ผู้แก้ไข |
|-------|----------|----------------|---------|
| 2026-05-25 | 1.0 | สร้างครั้งแรก | Security Team |

---

> **หมายเหตุ:** Runbook นี้ควรได้รับการทบทวนทุก **6 เดือน** หรือเมื่อเกิด incident ครั้งใหม่
