-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------
-- 012_pricing_plans.sql
--
-- Pricing Plans
-- ─────────────
-- • Replaces old plan names (starter→personal, pro→business) with
--   business-friendly names: free, personal, sme, business, enterprise.
-- • Creates `pricing_plans` reference table as the single source of truth
--   for quota limits and feature lists.
-- • Updates doc_quota on existing orgs to match new plan definitions.
-- ---------------------------------------------------------------------------

-- ── 1. Drop old constraint, migrate data ────────────────────────────────────
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
UPDATE organizations SET plan = 'business'  WHERE plan = 'pro';
UPDATE organizations SET plan = 'personal'  WHERE plan = 'starter';
-- ── 2. Re-add constraint with new plan names ─────────────────────────────────
ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan = ANY (ARRAY['free','starter','personal','sme','business','enterprise']));
-- ── 3. Sync doc_quota to match plan definitions ──────────────────────────────
UPDATE organizations SET doc_quota = 10    WHERE plan = 'free';
UPDATE organizations SET doc_quota = 50    WHERE plan = 'personal';
UPDATE organizations SET doc_quota = 300   WHERE plan = 'sme';
UPDATE organizations SET doc_quota = 1000  WHERE plan = 'business';
-- enterprise: quota = 0 means unlimited (app checks for 0 = no limit)

-- ── 4. Pricing plans reference table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_plans (
  id          text        PRIMARY KEY,
  name_th     text        NOT NULL,
  name_en     text        NOT NULL,
  price_thb   integer     NOT NULL,            -- 0 = free / custom
  doc_quota   integer     NOT NULL,            -- 0 = unlimited
  features    jsonb       NOT NULL DEFAULT '[]',
  sort_order  smallint    NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true
);
INSERT INTO pricing_plans (id, name_th, name_en, price_thb, doc_quota, features, sort_order)
VALUES
  ('free',      'ฟรี',         'Free',      0,    10,
   '["10 เอกสาร/เดือน","AI อ่านเอกสารอัตโนมัติ","Export CSV","ซัพพอร์ตทางอีเมล"]', 1),
  ('starter',   'เริ่มต้น',   'Starter',   99,   20,
   '["20 เอกสาร/เดือน","ทุกฟีเจอร์ใน Free","เชื่อม LINE","ซัพพอร์ตทางแชท"]', 2),
  ('personal',  'ส่วนตัว',    'Personal',  199,  50,
   '["50 เอกสาร/เดือน","ทุกฟีเจอร์ใน Starter","Dashboard","ซัพพอร์ตทางแชทเร็วขึ้น"]', 3),
  ('sme',       'ธุรกิจเล็ก', 'SME',       599,  300,
   '["300 เอกสาร/เดือน","ทุกฟีเจอร์ใน Personal","เชื่อม FlowAccount","หลายผู้ใช้งาน","Audit Log"]', 4),
  ('business',  'ธุรกิจ',     'Business',  1499, 1000,
   '["1,000 เอกสาร/เดือน","ทุกฟีเจอร์ใน SME","API Access","Priority Support","Custom Webhook"]', 5),
  ('enterprise','องค์กร',     'Enterprise', 0,   0,
   '["ไม่จำกัดเอกสาร","ทุกฟีเจอร์ใน Business","Dedicated Support","SLA","On-premise option"]', 6)
ON CONFLICT (id) DO UPDATE
  SET name_th    = EXCLUDED.name_th,
      name_en    = EXCLUDED.name_en,
      price_thb  = EXCLUDED.price_thb,
      doc_quota  = EXCLUDED.doc_quota,
      features   = EXCLUDED.features,
      sort_order = EXCLUDED.sort_order;
-- ── 5. RLS — pricing_plans is public read ────────────────────────────────────
ALTER TABLE pricing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_plans_public_read" ON pricing_plans
  FOR SELECT USING (is_active = true);
-- ── 6. Comments ──────────────────────────────────────────────────────────────
COMMENT ON TABLE pricing_plans IS
  'Single source of truth for plan names, quotas, and feature lists. '
  'doc_quota = 0 means unlimited (Enterprise).';
