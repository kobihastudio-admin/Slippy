-- 029_business_model_plans.sql — Apply BUSINESS_MODEL.md pricing (idempotent)

ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS max_users int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS feature_life_graph bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_ai_assistant bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_ai_search bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_ai_coach bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_life_insights bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_expense_claims bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_api_access bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_sso bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_priority_ai bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS plan_category text DEFAULT 'consumer'
    CHECK (plan_category IN ('consumer','business'));
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'free', 'ฟรี', 'Free', 0, 10, 1, 'consumer',
  false,false,false,
  false,false,false,
  false,false,false,
  '["10 เอกสาร/เดือน", "AI อ่านเอกสาร OCR", "เชื่อมต่อ LINE Bot", "หารบิลพื้นฐาน", "Dashboard พื้นฐาน"]', 1, true, false,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'pro', 'Pro', 'Pro', 199, 0, 1, 'consumer',
  true,true,true,
  false,true,false,
  false,false,false,
  '["ไม่จำกัดเอกสาร", "AI Assistant (Life Graph)", "AI Search", "Life Graph ครบทุก Domain", "AI Insights อัตโนมัติ", "Journey Tracking", "Dashboard ขั้นสูง", "รับเอกสารทางอีเมล"]', 2, true, true,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'premium', 'Premium', 'Premium', 499, 0, 1, 'consumer',
  true,true,true,
  true,true,false,
  false,false,true,
  '["ทุกอย่างใน Pro", "AI Coach ส่วนตัว", "Life Score (4 domains)", "Advanced Analytics", "Priority AI Processing", "Life Insights รายสัปดาห์", "Budget AI Recommendations"]', 3, true, false,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'team', 'ทีม', 'Team', 999, 500, 10, 'business',
  true,true,true,
  false,true,true,
  false,false,false,
  '["500 เอกสาร/เดือน", "จัดการสมาชิกทีม (10 คน)", "เบิกค่าใช้จ่าย + Approval", "Audit Trail", "Reports ขั้นสูง", "VAT Management", "ทุกฟีเจอร์ใน Pro"]', 4, true, false,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'business', 'ธุรกิจ', 'Business', 2990, 0, 0, 'business',
  true,true,true,
  true,true,true,
  true,false,true,
  '["ไม่จำกัดเอกสาร", "ไม่จำกัดสมาชิก", "หลายแผนก/หน่วยงาน", "Advanced Reports + VAT ภ.พ.30", "API Access", "Priority AI Processing", "ทุกฟีเจอร์ใน Team"]', 5, true, true,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
INSERT INTO pricing_plans(
  id, name_th, name_en, price_thb, doc_quota, max_users, plan_category,
  feature_life_graph, feature_ai_assistant, feature_ai_search,
  feature_ai_coach, feature_life_insights, feature_expense_claims,
  feature_api_access, feature_sso, feature_priority_ai,
  features, sort_order, is_active, highlighted,
  feature_ai_extraction, feature_line_bot, feature_email_ingestion)
VALUES (
  'enterprise', 'องค์กร', 'Enterprise', 0, 0, 0, 'business',
  true,true,true,
  true,true,true,
  true,true,true,
  '["SSO / SAML Integration", "Custom API Integration", "Dedicated Support + SLA", "On-premise option", "Custom AI Model", "ทุกฟีเจอร์ใน Business"]', 6, true, false,
  true, true, true)
ON CONFLICT(id) DO UPDATE SET
  name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
  price_thb=EXCLUDED.price_thb, doc_quota=EXCLUDED.doc_quota,
  max_users=EXCLUDED.max_users, plan_category=EXCLUDED.plan_category,
  feature_life_graph=EXCLUDED.feature_life_graph,
  feature_ai_assistant=EXCLUDED.feature_ai_assistant,
  feature_ai_search=EXCLUDED.feature_ai_search,
  feature_ai_coach=EXCLUDED.feature_ai_coach,
  feature_life_insights=EXCLUDED.feature_life_insights,
  feature_expense_claims=EXCLUDED.feature_expense_claims,
  feature_api_access=EXCLUDED.feature_api_access,
  feature_sso=EXCLUDED.feature_sso,
  feature_priority_ai=EXCLUDED.feature_priority_ai,
  features=EXCLUDED.features, sort_order=EXCLUDED.sort_order,
  is_active=EXCLUDED.is_active, highlighted=EXCLUDED.highlighted;
UPDATE pricing_plans SET is_active=false WHERE id IN ('starter','personal','sme');
CREATE TABLE IF NOT EXISTS creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level int NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
  referral_code text UNIQUE,
  total_referrals int NOT NULL DEFAULT 0,
  total_earnings numeric(14,2) NOT NULL DEFAULT 0,
  community_name text, community_price numeric(14,2) DEFAULT 99,
  is_verified bool NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS referral_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text NOT NULL,
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  plan_id text, amount_thb numeric(14,2) DEFAULT 0,
  commission_thb numeric(14,2) DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed','paid')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_conversions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='creator_own') THEN
    CREATE POLICY "creator_own" ON creator_profiles FOR ALL USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='referral_own') THEN
    CREATE POLICY "referral_own" ON referral_conversions FOR SELECT USING (referrer_id = auth.uid());
  END IF;
END $$;
