-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 010_demo_account.sql
--
-- Demo Account Isolation
-- ──────────────────────
-- • Adds `is_demo` flag to organizations so the app can show a demo banner
--   and restrict certain actions (billing, invites, etc.)
-- • Creates `reset_demo_org()` function that wipes + re-seeds the demo org's
--   documents, vendors, and audit logs — called by a daily Edge Function cron.
-- • Demo data is already isolated by the existing RLS policies (every query
--   filters by organization_id), so no additional RLS changes are needed.
-- ---------------------------------------------------------------------------

-- ── 1. Flag demo orgs ────────────────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_demo      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_reset_at timestamptz;
-- last reset timestamp

-- ── 2. Helper: truncate demo org data ────────────────────────────────────────
--   Called by the daily cron Edge Function. Does NOT touch auth.users,
--   organization_members, or integrations (those persist across resets).
CREATE OR REPLACE FUNCTION reset_demo_org(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only allow on demo orgs
  IF NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = p_org_id AND is_demo = true
  ) THEN
    RAISE EXCEPTION 'reset_demo_org: org % is not flagged as demo', p_org_id;
  END IF;

  -- Wipe transactional data in dependency order
  DELETE FROM document_audit_logs   WHERE document_id IN (
    SELECT id FROM documents WHERE organization_id = p_org_id
  );
  DELETE FROM document_line_items   WHERE document_id IN (
    SELECT id FROM documents WHERE organization_id = p_org_id
  );
  DELETE FROM documents             WHERE organization_id = p_org_id;
  DELETE FROM vendors               WHERE organization_id = p_org_id;

  -- Reset quota counters
  UPDATE organizations
  SET  doc_used       = 0,
       demo_reset_at  = now()
  WHERE id = p_org_id;

  -- Re-seed with realistic Thai demo documents
  INSERT INTO documents (
    organization_id, status, source,
    vendor_name, vendor_tax_id,
    doc_type, doc_category, doc_number, doc_date,
    subtotal, vat_amount, total_amount,
    overall_confidence, vat_claimable, expense_claimable,
    created_at, updated_at, extracted_at
  ) VALUES
  -- ① AWS / cloud cost
  (p_org_id, 'approved', 'email',
   'Amazon Web Services', '0105561090000',
   'tax_invoice', 'tax_invoice_full', 'TH-2026-0341', '2026-05-01',
   8177.57, 572.43, 8750.00,
   0.97, true, true,
   now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  -- ② Figma subscription
  (p_org_id, 'approved', 'email',
   'Figma Inc.', NULL,
   'invoice', 'invoice', 'FIG-20260502', '2026-05-02',
   2196.26, 153.74, 2350.00,
   0.94, false, true,
   now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
  -- ③ Starbucks receipt (consumer)
  (p_org_id, 'approved', 'line',
   'Starbucks Coffee Thailand', NULL,
   'receipt', 'consumer_receipt', NULL, '2026-05-10',
   285.00, 0, 285.00,
   0.91, false, true,
   now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
  -- ④ LINE MAN delivery
  (p_org_id, 'reviewing', 'line',
   'LINE MAN', NULL,
   'receipt', 'consumer_receipt', NULL, '2026-05-20',
   450.00, 0, 450.00,
   0.88, false, true,
   now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'),
  -- ⑤ AIS monthly bill
  (p_org_id, 'pushed', 'email',
   'Advanced Info Service PCL', '0107536000083',
   'tax_invoice', 'tax_invoice_full', 'AIS-2605-00871', '2026-05-05',
   1401.87, 98.13, 1500.00,
   0.96, true, true,
   now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'),
  -- ⑥ MEA electricity bill
  (p_org_id, 'approved', 'web',
   'Metropolitan Electricity Authority', '0994000220285',
   'tax_invoice', 'tax_invoice_full', 'MEA-2605-348921', '2026-05-07',
   3271.96, 228.04, 3500.00,
   0.95, true, true,
   now() - interval '6 days', now() - interval '6 days', now() - interval '6 days'),
  -- ⑦ Failed HEIC (for demo of error state)
  (p_org_id, 'failed', 'line',
   NULL, NULL,
   NULL, NULL, NULL, NULL,
   0, 0, 0,
   0, false, false,
   now() - interval '12 hours', now() - interval '12 hours', NULL);

  -- Seed vendors table
  INSERT INTO vendors (organization_id, name, tax_id, doc_count, total_spent, last_seen_at)
  VALUES
    (p_org_id, 'Amazon Web Services',              '0105561090000', 3, 26250.00, now() - interval '4 days'),
    (p_org_id, 'Advanced Info Service PCL',         '0107536000083', 2, 3000.00,  now() - interval '5 days'),
    (p_org_id, 'Metropolitan Electricity Authority','0994000220285', 1, 3500.00,  now() - interval '6 days')
  ON CONFLICT (organization_id, name) DO NOTHING;

END;
$$;
-- ── 3. Grant execute to service_role only (called by Edge Function) ───────────
REVOKE ALL ON FUNCTION reset_demo_org(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reset_demo_org(uuid) TO service_role;
-- ── 4. Comments ───────────────────────────────────────────────────────────────
COMMENT ON COLUMN organizations.is_demo IS
  'true = demo org — app shows demo banner, blocks billing/invite actions, daily data reset';
COMMENT ON FUNCTION reset_demo_org(uuid) IS
  'Wipes transactional data and re-seeds realistic Thai demo documents. Called daily by Edge Function cron.';
