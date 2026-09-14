-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 013_admin_plans.sql
--
-- Admin Plan Management
-- ─────────────────────
-- • Adds Stripe price ID columns to pricing_plans for admin panel management.
-- • Adds is_superadmin flag to users for admin panel access control.
-- • Adds highlighted flag to pricing_plans (mirrors lib/plans.ts).
-- • RLS: pricing_plans write restricted to service_role / superadmin.
-- ---------------------------------------------------------------------------

-- ── 1. Add Stripe price ID columns to pricing_plans ─────────────────────────
ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_m  text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_y  text,
  ADD COLUMN IF NOT EXISTS highlighted        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();
-- Set highlighted for SME (mirrors lib/plans.ts)
UPDATE pricing_plans SET highlighted = true WHERE id = 'sme';
-- ── 2. Add superadmin flag to users ─────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;
-- ── 3. RLS policy — only superadmins (via service_role) can write plans ─────
-- Read is already open (is_active = true). Add write policy:
CREATE POLICY "pricing_plans_superadmin_write" ON pricing_plans
  FOR ALL
  USING  (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.is_superadmin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.is_superadmin = true
    )
  );
-- ── 4. Auto-update updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_pricing_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pricing_plans_updated_at ON pricing_plans;
CREATE TRIGGER trg_pricing_plans_updated_at
  BEFORE UPDATE ON pricing_plans
  FOR EACH ROW EXECUTE FUNCTION update_pricing_plans_updated_at();
-- ── 5. Comments ──────────────────────────────────────────────────────────────
COMMENT ON COLUMN pricing_plans.stripe_price_id_m IS
  'Stripe Price ID for monthly billing (price_xxx). Stored here so admin panel can manage without env var changes.';
COMMENT ON COLUMN pricing_plans.stripe_price_id_y IS
  'Stripe Price ID for yearly billing (price_xxx).';
COMMENT ON COLUMN pricing_plans.highlighted IS
  'Show as "popular" / highlighted in pricing UI.';
COMMENT ON COLUMN users.is_superadmin IS
  'Platform superadmin — grants access to /admin routes. Set manually in DB.';
