-- Migration 036: Sync free plan doc_quota from 10 → 15
-- Reason: plans.ts was updated (free plan docQuota: 15) but existing orgs
--         still have the old value (10) set by migration 012.
-- This migration brings all existing free-plan orgs in line with the new quota.

-- 1. Bump free orgs from 10 → 15 (only exact matches to avoid touching upgraded orgs)
UPDATE organizations
SET    doc_quota = 15
WHERE  plan      = 'free'
  AND  doc_quota = 10;
-- 2. Also handle orgs on 'starter' plan (same haiku tier, was also 10 in old schema)
UPDATE organizations
SET    doc_quota = 15
WHERE  plan      = 'starter'
  AND  doc_quota = 10;
-- 3. Update pricing_plans table to stay in sync (idempotent)
UPDATE pricing_plans
SET    doc_quota = 15
WHERE  id = 'free'
  AND  doc_quota != 15;
-- Verify
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM   organizations
  WHERE  plan = 'free' AND doc_quota = 10;

  IF v_count > 0 THEN
    RAISE WARNING 'migration 036: % free orgs still have doc_quota=10 — check manually', v_count;
  ELSE
    RAISE NOTICE 'migration 036: all free orgs now have doc_quota=15 ✓';
  END IF;
END $$;
