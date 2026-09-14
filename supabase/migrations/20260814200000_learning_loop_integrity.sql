-- Stop the learning loop from learning the wrong things.
--
-- Three defects, all silent, all found by reading the data rather than by any
-- error surfacing:
--
--   1. `receipt_corrections` accepted the identical correction twice. One
--      reviewer's double save — 10:35:25 and 10:35:39 on the same receipt —
--      became two rows, and the miner counted rows.
--   2. Every mined pattern therefore claimed an occurrence count of 2–4 while
--      resting on exactly ONE document, which cleared the "seen 2+ times"
--      noise filter and became a standing rule injected into every future
--      prompt. (Fixed in code: the count is now distinct documents.)
--   3. Those patterns were written with organization_id NULL, which the RLS
--      policy in migration 034 treats as GLOBAL. One organisation's shop names
--      were being fed into every other organisation's prompt — and because
--      Postgres treats each NULL in a unique constraint as distinct, the
--      upsert could never de-duplicate them either.

-- ── 1. Collapse existing duplicates, then make them impossible ───────────────
-- Keep the earliest row of each identical correction; it is the one whose
-- timestamp reflects when the human actually decided.
delete from public.receipt_corrections a
using public.receipt_corrections b
where a.ctid > b.ctid
  and a.document_id     is not distinct from b.document_id
  and a.field_name      is not distinct from b.field_name
  and a.ai_value        is not distinct from b.ai_value
  and a.corrected_value is not distinct from b.corrected_value;

-- `is not distinct from` semantics in an index need coalesced expressions,
-- since a NULL ai_value must still collide with another NULL ai_value.
create unique index if not exists receipt_corrections_unique_edit
  on public.receipt_corrections (
    document_id,
    field_name,
    coalesce(ai_value, ''),
    coalesce(corrected_value, '')
  );

comment on index public.receipt_corrections_unique_edit is
  'One row per (document, field, before, after). A reviewer pressing save twice must not look like two independent observations.';

-- ── 2. Retire patterns that were never entitled to exist ────────────────────
-- Amount patterns first. These are the dangerous ones: "subtotal 579.44 → 620"
-- and "total 620 → 663.4" are not misreadings at all — a reviewer reconciled a
-- VAT-inclusive receipt — and as a general rule they would make the model
-- rewrite an unrelated ฿620 receipt to ฿663.40. The prompt formatter already
-- refuses to emit them, so they are inert today; this removes the loaded gun
-- rather than trusting that nobody ever changes the formatter.
delete from public.ocr_error_patterns
where pattern_type = 'amount_format'
   or field_name in ('subtotal', 'vat_amount', 'total_amount', 'wht_amount',
                     'discount_amount', 'delivery_fee', 'paid_amount');

-- Then the accidental globals. Mining is per-organisation; a global pattern is
-- a deliberate curation decision, and none of these were. Every surviving row
-- rested on a single document anyway, so nothing of value is lost — the
-- corrections they came from are still in receipt_corrections and will be
-- re-mined properly once two different documents agree.
delete from public.ocr_error_patterns
where organization_id is null;

-- ── 3. Let a global pattern de-duplicate, without removing the feature ──────
-- Postgres treats every NULL in a unique constraint as distinct, so the
-- existing `unique (organization_id, field_name, wrong_value, correct_value)`
-- silently stops protecting anything the moment organization_id is NULL: the
-- upsert's ON CONFLICT can never match, and each mining run inserts another
-- copy.
--
-- Deliberately NOT solved by making the column NOT NULL. A curated global
-- pattern is a designed capability (see the RLS policy in migration 034, which
-- reads NULL as "visible to every tenant") and deleting a feature to fix a bug
-- is the wrong trade. Mining is what must never produce one, and that is now
-- enforced in the miner. What the database owes is the same uniqueness
-- guarantee for the rows it does allow.
create unique index if not exists ocr_error_patterns_unique_global
  on public.ocr_error_patterns (field_name, wrong_value, correct_value)
  where organization_id is null;

comment on index public.ocr_error_patterns_unique_global is
  'Companion to the org-scoped unique constraint, which cannot cover NULL organization_id because NULLs never collide.';
