-- Ground truth for the evaluation / training corpus.
--
-- Separate from `documents` on purpose. That table holds what the AI currently
-- believes, and it is rewritten on every reprocessing run — so it can never be
-- the reference to measure against. A held-out set stored in a table the
-- pipeline overwrites is not held out. This table is written only by a human
-- and never by the pipeline.
--
-- One row per (document, verifier): re-verification supersedes rather than
-- edits, so a disagreement between two reviewers stays visible instead of the
-- second silently overwriting the first.

create table if not exists public.document_ground_truth (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Only fields a human can confirm by looking at the paper. Classification
  -- fields (doc_category, vat_claimable) are deliberately absent: they are the
  -- model's judgement, and grading a model against its own taxonomy measures
  -- nothing.
  vendor_name     text,
  vendor_tax_id   text,
  doc_number      text,
  doc_date        date,
  subtotal        numeric(14,2),
  vat_amount      numeric(14,2),
  total_amount    numeric(14,2),
  -- [{description, amount}] in printed order — order is information on a receipt.
  line_items      jsonb not null default '[]'::jsonb,

  -- Resolution of the file as uploaded. Recorded here because the stored image
  -- gets normalised and re-normalised; by eval time nothing else remembers how
  -- big the capture actually was, and that is the single strongest predictor of
  -- whether the Thai was readable at all.
  source_width    integer not null default 0,
  source_height   integer not null default 0,

  verified_by     uuid not null references public.users(id),
  verified_at     timestamptz not null default now(),
  -- Free-text note for the awkward ones ("handwritten total", "torn corner").
  notes           text,

  created_at      timestamptz not null default now(),
  unique (document_id, verified_by)
);

create index if not exists dgt_org_idx on public.document_ground_truth (organization_id, verified_at desc);
create index if not exists dgt_document_idx on public.document_ground_truth (document_id);

alter table public.document_ground_truth enable row level security;

-- Readable by members of the owning org; writable by the verifier themselves.
-- Ground truth that anyone can edit is not ground truth.
--
-- Dropped first because `create policy` has no IF NOT EXISTS. Without this the
-- migration is not re-runnable, and a push that fails partway — which is
-- exactly what happened to this repo's 086/087 pair — leaves a migration that
-- can never be applied again without hand-editing the database.
drop policy if exists dgt_select on public.document_ground_truth;
drop policy if exists dgt_insert on public.document_ground_truth;
drop policy if exists dgt_update on public.document_ground_truth;

create policy dgt_select on public.document_ground_truth
  for select using (
    organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

create policy dgt_insert on public.document_ground_truth
  for insert with check (
    verified_by = auth.uid()
    and organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

create policy dgt_update on public.document_ground_truth
  for update using (verified_by = auth.uid());

comment on table public.document_ground_truth is
  'Human-verified field values. Written only by people, never by the pipeline — it is the reference the pipeline is measured against.';
