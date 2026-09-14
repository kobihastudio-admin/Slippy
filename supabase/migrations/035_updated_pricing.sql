-- ─── Migration 035: Updated Pricing Plans & AI Model Tier ─────────────────────
-- Aligns DB pricing_plans with lib/plans.ts (revenue model update 2026-06)
--
-- Changes:
--   1. Add model_tier, extra_seat_thb, storage_gb, category, max_users columns
--   2. Upsert updated plan rows (free, pro, premium, team, business, enterprise)
--   3. Add doc_addons table for one-time add-on purchases (tax reports etc.)
--   4. Create org_plan_details view
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add new columns to pricing_plans ──────────────────────────────────────

ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS max_users       INT    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS model_tier      TEXT   NOT NULL DEFAULT 'smart'
                                                  CHECK (model_tier IN ('haiku','smart','priority')),
  ADD COLUMN IF NOT EXISTS extra_seat_thb  INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_gb      INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category        TEXT   NOT NULL DEFAULT 'consumer'
                                                  CHECK (category IN ('consumer','business'));
COMMENT ON COLUMN pricing_plans.model_tier IS
  'haiku=Haiku-only (~฿0.22/doc), smart=auto-route (~฿0.43/doc), priority=Sonnet-first (~฿0.91/doc)';
COMMENT ON COLUMN pricing_plans.extra_seat_thb IS
  'Price in THB per additional seat per month; 0 = not supported';
COMMENT ON COLUMN pricing_plans.storage_gb IS
  'Storage quota in GB; 0 = unlimited';
COMMENT ON COLUMN pricing_plans.max_users IS
  'Max members in org; 0 = unlimited';
-- ── 2. Upsert plans ───────────────────────────────────────────────────────────
-- NOTE: pricing_plans has no created_at/updated_at columns — omitted intentionally

INSERT INTO pricing_plans (
  id, name_th, name_en, price_thb, doc_quota, max_users,
  model_tier, extra_seat_thb, storage_gb, category, is_active
) VALUES
  -- Consumer tier
  ('free',       'ฟรี',     'Free',       0,    15,  1,  'haiku',    0,    1,    'consumer', true),
  ('pro',        'Pro',     'Pro',         199,  0,   1,  'smart',    99,   20,   'consumer', true),
  ('premium',    'Premium', 'Premium',     499,  0,   1,  'priority', 149,  50,   'consumer', true),
  -- Business tier
  ('team',       'ทีม',    'Team',        999,  0,   10, 'smart',    99,   100,  'business', true),
  ('business',   'ธุรกิจ', 'Business',    2990, 0,   0,  'priority', 149,  500,  'business', true),
  ('enterprise', 'องค์กร', 'Enterprise',  0,    0,   0,  'priority', 0,    0,    'business', true)
ON CONFLICT (id) DO UPDATE SET
  name_th        = EXCLUDED.name_th,
  name_en        = EXCLUDED.name_en,
  price_thb      = EXCLUDED.price_thb,
  doc_quota      = EXCLUDED.doc_quota,
  max_users      = EXCLUDED.max_users,
  model_tier     = EXCLUDED.model_tier,
  extra_seat_thb = EXCLUDED.extra_seat_thb,
  storage_gb     = EXCLUDED.storage_gb,
  category       = EXCLUDED.category,
  is_active      = EXCLUDED.is_active;
-- ── 3. Create doc_addons table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS doc_addons (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  addon_key         TEXT          NOT NULL,
  description       TEXT,
  price_thb         NUMERIC(10,2) NOT NULL,
  quantity          INT           NOT NULL DEFAULT 1,
  stripe_payment_id TEXT,
  status            TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','paid','expired','refunded')),
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_addons_org_idx
  ON doc_addons (organization_id, addon_key, status);
ALTER TABLE doc_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_view_addons" ON doc_addons
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "org_owner_manage_addons" ON doc_addons
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
-- ── 4. View: org_plan_details ─────────────────────────────────────────────────
-- organizations.plan (TEXT) joins pricing_plans.id

CREATE OR REPLACE VIEW org_plan_details AS
SELECT
  o.id             AS organization_id,
  o.plan           AS plan_id,
  pp.model_tier,
  pp.doc_quota,
  pp.max_users,
  pp.extra_seat_thb,
  pp.storage_gb,
  pp.category
FROM organizations o
LEFT JOIN pricing_plans pp ON pp.id = o.plan;
GRANT SELECT ON org_plan_details TO authenticated;
