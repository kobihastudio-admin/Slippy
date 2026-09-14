-- ============================================================
-- Migration 034: OCR Error Patterns — Self-Improving System
-- ============================================================
-- เก็บ pattern ที่ AI อ่านผิดซ้ำๆ เพื่อนำไปเตือน AI ในครั้งต่อไป
-- populated โดย pattern-miner.ts ที่รันเป็น cron job

create table if not exists ocr_error_patterns (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references organizations(id) on delete cascade,
  -- null = global pattern (ทุก org), not-null = org-specific

  field_name       text    not null,   -- 'total_amount', 'vendor_name', 'doc_date', ...
  wrong_value      text    not null,   -- ค่าที่ AI อ่านผิด
  correct_value    text    not null,   -- ค่าที่ถูกต้อง
  pattern_type     text    not null,   -- 'digit_swap' | 'char_swap' | 'vendor_alias' | 'date_format'
  occurrence_count int     not null default 1,
  example_doc_ids  text[], -- document ids ที่เกิด pattern นี้
  is_active        boolean not null default true,
  last_mined_at    timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  unique (organization_id, field_name, wrong_value, correct_value)
);
create index ocr_error_patterns_org_idx
  on ocr_error_patterns (organization_id, field_name, occurrence_count desc)
  where is_active = true;
-- global patterns (org_id is null) — no RLS needed, read-only by pipeline
alter table ocr_error_patterns enable row level security;
create policy "pipeline can read patterns"
  on ocr_error_patterns for select
  using (
    organization_id is null  -- global
    or exists (
      select 1 from organization_members
      where organization_id = ocr_error_patterns.organization_id
        and user_id = auth.uid()
    )
  );
create policy "service role can manage patterns"
  on ocr_error_patterns for all
  using (true)
  with check (true);
-- ============================================================
-- Table: image_quality_logs — บันทึก blur score ของแต่ละรูป
-- ใช้ track ว่า user มักส่งรูปคุณภาพต่ำจาก channel ไหน
-- ============================================================
create table if not exists image_quality_logs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references documents(id) on delete cascade,
  blur_score    numeric(6,3),    -- Laplacian variance — higher = sharper
  is_blurry     boolean,         -- blur_score < threshold
  width         int,
  height        int,
  file_size_kb  int,
  created_at    timestamptz not null default now()
);
create index image_quality_logs_doc_idx on image_quality_logs (document_id);
