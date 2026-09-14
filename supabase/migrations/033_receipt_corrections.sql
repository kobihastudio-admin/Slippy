-- ============================================================
-- Migration 033: Human Learning Loop — Receipt Corrections
-- ============================================================
-- บันทึกทุกครั้งที่ user แก้ไขข้อมูลจาก AI
-- ใช้เป็น feedback loop สำหรับ few-shot learning ใน extraction pipeline

create table if not exists receipt_corrections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,

  -- field ที่ถูกแก้ไข
  field_name       text not null,           -- 'vendor_name', 'total_amount', 'doc_date', ...
  ai_value         text,                    -- ค่าที่ AI อ่านได้ (แปลงเป็น text เสมอ)
  corrected_value  text,                    -- ค่าที่ user แก้เป็น

  -- context สำหรับ few-shot learning
  vendor_name      text,                    -- ชื่อร้านที่ถูกต้อง (หลังแก้)
  doc_category     text,                    -- ประเภทเอกสาร
  confidence_score numeric(4,3),            -- confidence เดิมของ AI

  -- metadata
  corrected_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
-- index สำหรับ few-shot query (ดึงต่อ org เรียงใหม่สุด)
create index receipt_corrections_org_idx
  on receipt_corrections (organization_id, created_at desc);
-- index สำหรับ vendor normalization lookup
create index receipt_corrections_vendor_idx
  on receipt_corrections (organization_id, field_name, ai_value)
  where field_name = 'vendor_name';
-- RLS
alter table receipt_corrections enable row level security;
create policy "org members can read corrections"
  on receipt_corrections for select
  using (
    exists (
      select 1 from organization_members
      where organization_id = receipt_corrections.organization_id
        and user_id = auth.uid()
    )
  );
create policy "org members can insert corrections"
  on receipt_corrections for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_id = receipt_corrections.organization_id
        and user_id = auth.uid()
    )
  );
-- ============================================================
-- View: vendor_correction_map
-- แสดง pattern การแก้ชื่อร้าน: ai_value → corrected_value
-- ใช้ merchant-normalizer ดึงมา lookup
-- ============================================================
create or replace view vendor_correction_map as
select
  organization_id,
  ai_value        as raw_name,
  corrected_value as correct_name,
  count(*)        as correction_count,
  max(created_at) as last_corrected_at
from receipt_corrections
where field_name = 'vendor_name'
  and ai_value is distinct from corrected_value
  and corrected_value is not null
  and corrected_value <> ''
group by organization_id, ai_value, corrected_value
order by correction_count desc;
