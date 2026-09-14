-- ---------------------------------------------------------------------------
-- 021_plan_features.sql
--
-- Add per-plan feature flags to pricing_plans.
-- These replace global on/off system_config for features that
-- should be gated by plan tier.
--
-- feature_ai_extraction  — AI OCR pipeline access
-- feature_line_bot       — LINE Bot connect & receive slips
-- feature_email_ingestion — Receive documents via email attachment
-- ---------------------------------------------------------------------------

ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS feature_ai_extraction  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_line_bot       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_email_ingestion boolean NOT NULL DEFAULT false;
-- ── Set per-plan feature flags ────────────────────────────────────────────────

-- FREE: AI only (doc quota limits usage naturally)
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = false,
  feature_email_ingestion = false
WHERE id = 'free';
-- STARTER: AI + LINE Bot
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = true,
  feature_email_ingestion = false
WHERE id = 'starter';
-- PERSONAL: AI + LINE Bot + Email
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = true,
  feature_email_ingestion = true
WHERE id = 'personal';
-- SME: All features
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = true,
  feature_email_ingestion = true
WHERE id = 'sme';
-- BUSINESS: All features
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = true,
  feature_email_ingestion = true
WHERE id = 'business';
-- ENTERPRISE: All features
UPDATE pricing_plans SET
  feature_ai_extraction   = true,
  feature_line_bot        = true,
  feature_email_ingestion = true
WHERE id = 'enterprise';
-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON COLUMN pricing_plans.feature_ai_extraction   IS 'Allow AI OCR extraction for this plan. False = uploaded docs stay pending.';
COMMENT ON COLUMN pricing_plans.feature_line_bot        IS 'Allow LINE Bot /connect and image ingestion for this plan.';
COMMENT ON COLUMN pricing_plans.feature_email_ingestion IS 'Allow email-attachment ingestion for this plan.';
-- ── Helper function: check if an org has a specific plan feature ──────────────
CREATE OR REPLACE FUNCTION org_has_feature(p_org_id uuid, p_feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE p_feature
          WHEN 'ai_extraction'   THEN pp.feature_ai_extraction
          WHEN 'line_bot'        THEN pp.feature_line_bot
          WHEN 'email_ingestion' THEN pp.feature_email_ingestion
          ELSE false
        END
      FROM organizations o
      JOIN pricing_plans pp ON pp.id = o.plan::text
      WHERE o.id = p_org_id
    ),
    false
  )
$$;
COMMENT ON FUNCTION org_has_feature IS
  'Returns true if the org''s current plan includes the named feature.
   Usage: SELECT org_has_feature(org_id, ''line_bot'')';
