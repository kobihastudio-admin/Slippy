-- ============================================================
-- Migration 080: Merchant Directory — Tax ID → official juristic identity cache
-- ============================================================
-- Global (not per-org) cache of the DBD/RD juristic registry, keyed by the
-- 13-digit tax id. Populated by api/src/pipeline/vendor-registry.ts so the same
-- store is only looked up over the network once (protecting the data.go.th
-- 1000-call/day quota). Both HITS and MISSES are cached; `found=false` rows are
-- negative-cache markers with their own TTL enforced in the app layer.

create table if not exists merchant_directory (
  tax_id             text primary key,        -- normalized 13-digit เลขนิติบุคคล
  found              boolean not null default false,

  name_th            text,
  name_en            text,
  status             text,                     -- ยังดำเนินกิจการอยู่ / เลิก / ...
  entity_type        text,                     -- บริษัทจำกัด / ห้างหุ้นส่วนจำกัด / ...
  address            text,
  registered_capital numeric,
  registered_date    text,

  source             text,                     -- provider name, or 'miss'
  raw                jsonb,
  hit_count          integer     not null default 1,
  looked_up_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Prune negative-cache entries by age
create index if not exists merchant_directory_lookup_idx
  on merchant_directory (found, looked_up_at desc);

-- The registry is public reference data; the pipeline writes via the service
-- role (bypasses RLS). Allow any authenticated user to read it.
alter table merchant_directory enable row level security;

drop policy if exists "authenticated can read merchant directory" on merchant_directory;
create policy "authenticated can read merchant directory"
  on merchant_directory for select
  using (auth.role() = 'authenticated');
