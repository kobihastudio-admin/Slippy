-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ══════════════════════════════════════════════════════════════
--  004_views.sql
--  Analytics views + tax report functions
-- ══════════════════════════════════════════════════════════════

-- ── Monthly expense summary ────────────────────────────────────
CREATE OR REPLACE VIEW monthly_expense_summary AS
SELECT
  organization_id,
  DATE_TRUNC('month', doc_date)::date  AS month,
  COUNT(*)                             AS doc_count,
  SUM(subtotal)                        AS subtotal,
  SUM(vat_amount)                      AS vat_total,
  SUM(wht_amount)                      AS wht_total,
  SUM(total_amount)                    AS grand_total,
  AVG(overall_confidence)              AS avg_confidence,
  COUNT(*) FILTER (
    WHERE reviewed_by IS NULL AND status = 'pushed'
  )                                    AS auto_pushed
FROM documents
WHERE status IN ('approved','pushed')
  AND doc_date IS NOT NULL
GROUP BY organization_id, DATE_TRUNC('month', doc_date);
-- ── VAT Report function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_vat_report(
  p_org_id  uuid,
  p_year    int,
  p_month   int
)
RETURNS TABLE (
  vat_type    text,
  doc_count   bigint,
  base_amount numeric,
  vat_amount  numeric
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT 'input'::text, COUNT(*), SUM(subtotal), SUM(d.vat_amount)
  FROM documents d
  WHERE organization_id = p_org_id
    AND status IN ('approved','pushed')
    AND EXTRACT(YEAR  FROM doc_date) = p_year
    AND EXTRACT(MONTH FROM doc_date) = p_month
    AND d.vat_amount > 0
    AND doc_type IN ('expense','receipt')
  UNION ALL
  SELECT 'output'::text, COUNT(*), SUM(subtotal), SUM(d.vat_amount)
  FROM documents d
  WHERE organization_id = p_org_id
    AND status IN ('approved','pushed')
    AND EXTRACT(YEAR  FROM doc_date) = p_year
    AND EXTRACT(MONTH FROM doc_date) = p_month
    AND d.vat_amount > 0
    AND doc_type = 'invoice'
$$;
-- ── WHT Report function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_wht_report(
  p_org_id   uuid,
  p_year     int,
  p_month    int
)
RETURNS TABLE (
  vendor_name   text,
  vendor_tax_id text,
  wht_rate      numeric,
  base_amount   numeric,
  wht_amount    numeric,
  doc_count     bigint
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    vendor_name,
    vendor_tax_id,
    wht_rate,
    SUM(subtotal)     AS base_amount,
    SUM(d.wht_amount) AS wht_amount,
    COUNT(*)          AS doc_count
  FROM documents d
  WHERE organization_id = p_org_id
    AND status IN ('approved','pushed')
    AND EXTRACT(YEAR  FROM doc_date) = p_year
    AND EXTRACT(MONTH FROM doc_date) = p_month
    AND d.wht_amount > 0
  GROUP BY vendor_name, vendor_tax_id, wht_rate
  ORDER BY wht_amount DESC
$$;
-- ── Top vendors ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_top_vendors(
  p_org_id    uuid,
  p_date_from date,
  p_date_to   date,
  p_limit     int DEFAULT 10
)
RETURNS TABLE (
  vendor_name  text,
  vendor_tax_id text,
  total_paid   numeric,
  doc_count    bigint,
  avg_per_doc  numeric
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    vendor_name,
    vendor_tax_id,
    SUM(total_amount) AS total_paid,
    COUNT(*)          AS doc_count,
    AVG(total_amount) AS avg_per_doc
  FROM documents
  WHERE organization_id = p_org_id
    AND status IN ('approved','pushed')
    AND doc_date BETWEEN p_date_from AND p_date_to
    AND vendor_name IS NOT NULL
  GROUP BY vendor_name, vendor_tax_id
  ORDER BY total_paid DESC
  LIMIT p_limit
$$;
