-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ══════════════════════════════════════════════════════════════
--  003_stripe.sql
--  Stripe subscription tables + plan quota enforcement
-- ══════════════════════════════════════════════════════════════

-- ── Stripe Events Log (idempotency) ───────────────────────────
CREATE TABLE stripe_events (
  id           text PRIMARY KEY,   -- Stripe event ID (evt_xxx)
  type         text NOT NULL,
  data         jsonb NOT NULL,
  processed_at timestamptz DEFAULT now()
);
-- ── Billing Invoices History ───────────────────────────────────
CREATE TABLE billing_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_invoice_id   text NOT NULL UNIQUE,
  stripe_payment_id   text,
  amount_paid         numeric(10,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'thb',
  status              text NOT NULL,  -- paid | open | void | uncollectible
  invoice_url         text,
  invoice_pdf         text,
  period_start        timestamptz,
  period_end          timestamptz,
  created_at          timestamptz DEFAULT now()
);
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_select" ON billing_invoices FOR SELECT
  USING (
    organization_id = ANY(get_my_org_ids())
    AND get_my_role(organization_id) IN ('owner','admin')
  );
-- ── Plan definitions (reference table) ────────────────────────
CREATE TABLE plans (
  id           text PRIMARY KEY,  -- free | starter | pro | enterprise
  name_en      text NOT NULL,
  name_th      text NOT NULL,
  price_thb    numeric(10,2) NOT NULL DEFAULT 0,
  doc_quota    int  NOT NULL DEFAULT 50,  -- -1 = unlimited
  connectors   int  NOT NULL DEFAULT 1,  -- max accounting system connectors
  api_access   boolean DEFAULT false,
  features     jsonb DEFAULT '[]'
);
INSERT INTO plans (id, name_en, name_th, price_thb, doc_quota, connectors, api_access, features) VALUES
('free',       'Free',       'ฟรี',       0,      50,  1, false,
 '["50 docs/month","1 accounting connector","Email support"]'),
('starter',    'Starter',    'Starter',   790,    500, 2, false,
 '["500 docs/month","2 connectors","Mobile app","Email ingestion","Priority support"]'),
('pro',        'Pro',        'Pro',       1990, 99999, 5, true,
 '["Unlimited docs","5 connectors","API access","Line Bot","Tax export","Dedicated support"]'),
('enterprise', 'Enterprise', 'Enterprise',0,   99999, 99, true,
 '["Everything in Pro","On-premise option","Custom connectors","SLA","Account manager"]');
-- ── Function: sync plan quota from Stripe subscription ────────
CREATE OR REPLACE FUNCTION sync_subscription(
  p_org_id              uuid,
  p_stripe_sub_id       text,
  p_stripe_customer_id  text,
  p_status              text,
  p_plan_id             text,
  p_ends_at             timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota int;
BEGIN
  SELECT doc_quota INTO v_quota FROM plans WHERE id = p_plan_id;

  UPDATE organizations SET
    stripe_subscription_id = p_stripe_sub_id,
    stripe_customer_id     = p_stripe_customer_id,
    subscription_status    = p_status,
    subscription_ends_at   = p_ends_at,
    plan                   = p_plan_id,
    doc_quota              = COALESCE(v_quota, 50),
    updated_at             = now()
  WHERE id = p_org_id;
END;
$$;
-- ── Function: increment doc_used + enforce quota ───────────────
CREATE OR REPLACE FUNCTION increment_doc_used(p_org_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota int;
  v_used  int;
BEGIN
  SELECT doc_quota, doc_used INTO v_quota, v_used
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  -- -1 or 99999 = unlimited
  IF v_quota >= 99999 THEN
    UPDATE organizations SET doc_used = doc_used + 1 WHERE id = p_org_id;
    RETURN true;
  END IF;

  IF v_used >= v_quota THEN
    RETURN false;  -- quota exceeded
  END IF;

  UPDATE organizations SET doc_used = doc_used + 1 WHERE id = p_org_id;
  RETURN true;
END;
$$;
-- ── Reset doc_used on 1st of each month ────────────────────────
CREATE OR REPLACE FUNCTION reset_monthly_quota()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE organizations SET doc_used = 0;
$$;
