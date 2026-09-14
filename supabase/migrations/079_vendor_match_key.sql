-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 079_vendor_match_key.sql
-- Better "same store" detection so repeat purchases (vendors.doc_count) are
-- counted correctly.
--
-- Problem: upsert_vendor deduped by exact lower(name), so OCR / branch variants
-- of ONE store ("ยอดชา คาเฟ่" vs "ยอดชา คาเฟ่ สาขาโลตัสรามอินทรา", tax id printed
-- "0-1055-…" vs "0105…") became separate rows, each showing doc_count 1.
--
-- Fix: dedup on a canonical `match_key`. The normalization lives in ONE place —
-- TypeScript `canonicalMerchantKey()` (api/src/pipeline/merchant-key.ts) — which
-- feeds both this RPC (runtime) and scripts/backfill-vendor-keys.ts (existing
-- rows), so the key can never drift between them. This RPC just stores/matches
-- the key it is given.
-- ---------------------------------------------------------------------------

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS match_key text;

-- Lookup index (non-unique: pre-existing duplicates that now collapse to one
-- key are tolerated — upsert picks the busiest and future docs accrue to it;
-- historical merge is the optional cleanup at the bottom).
CREATE INDEX IF NOT EXISTS idx_vendors_match_key ON vendors(organization_id, match_key);

-- ---------------------------------------------------------------------------
-- Replace upsert_vendor: dedup on the caller-supplied match_key.
-- New trailing parameter p_match_key (defaulted) → old callers still compile,
-- but the app now always passes it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_vendor(
  p_org_id      uuid,
  p_name        text,
  p_tax_id      text,
  p_address     text,
  p_phone       text,
  p_amount      numeric,
  p_vat         numeric,
  p_doc_date    date,
  p_match_key   text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id  uuid;
  -- Fallback for any legacy caller that doesn't pass a key: digits-only tax id,
  -- else whitespace-stripped lower(name). The app always supplies p_match_key.
  v_key text := COALESCE(
    NULLIF(p_match_key, ''),
    NULLIF(regexp_replace(COALESCE(p_tax_id, ''), '\D', '', 'g'), ''),
    NULLIF(regexp_replace(lower(COALESCE(p_name, '')), '\s+', '', 'g'), '')
  );
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM vendors
   WHERE organization_id = p_org_id AND match_key = v_key
   ORDER BY doc_count DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Same store → a repeat purchase.
    UPDATE vendors SET
      name          = p_name,                                 -- freshest display name
      tax_id        = COALESCE(NULLIF(p_tax_id, ''), tax_id),
      address       = COALESCE(p_address, address),
      phone         = COALESCE(p_phone,   phone),
      doc_count     = doc_count + 1,
      total_amount  = total_amount + COALESCE(p_amount, 0),
      vat_total     = vat_total   + COALESCE(p_vat,    0),
      last_doc_date = GREATEST(last_doc_date, p_doc_date)
    WHERE id = v_id;
  ELSE
    INSERT INTO vendors(organization_id, name, tax_id, address, phone, match_key,
                        doc_count, total_amount, vat_total, last_doc_date)
    VALUES (p_org_id, p_name, NULLIF(p_tax_id, ''), p_address, p_phone, v_key,
            1, COALESCE(p_amount, 0), COALESCE(p_vat, 0), p_doc_date)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- After deploy, run once to key existing rows with the SAME TS logic:
--     npm run backfill:vendor-keys
--
-- OPTIONAL historical merge (review first — rewrites stats, irreversible):
-- folds duplicate rows now sharing a match_key into the one with the most docs.
-- WITH ranked AS (
--   SELECT id, organization_id, match_key,
--          first_value(id) OVER (PARTITION BY organization_id, match_key
--                                ORDER BY doc_count DESC, created_at) AS keep_id,
--          doc_count, total_amount, vat_total, last_doc_date
--     FROM vendors WHERE match_key IS NOT NULL
-- ), dups AS (SELECT * FROM ranked WHERE id <> keep_id)
-- UPDATE vendors v SET
--   doc_count = v.doc_count + agg.c, total_amount = v.total_amount + agg.t,
--   vat_total = v.vat_total + agg.vt, last_doc_date = GREATEST(v.last_doc_date, agg.d)
-- FROM (SELECT keep_id, sum(doc_count) c, sum(total_amount) t, sum(vat_total) vt,
--              max(last_doc_date) d FROM dups GROUP BY keep_id) agg
-- WHERE v.id = agg.keep_id;
-- DELETE FROM vendors WHERE id IN (SELECT id FROM dups);
