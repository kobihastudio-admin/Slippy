-- ═══════════════════════════════════════════════════════════════════════════
-- 071_fair_use_doc_caps.sql
-- "Unlimited docs" plans (Pro/Premium/Team/Business) had no ceiling at all,
-- while AI cost per doc is variable (~฿0.22–0.91 depending on model tier) —
-- a single heavy user could cost more in AI calls than their subscription
-- brings in. This adds a generous fair-use cap per plan (still far above
-- normal usage — see docs/BUSINESS_MODEL.md cost notes) instead of literal
-- unlimited. Only Enterprise (custom-contracted) stays truly uncapped.
--
-- While touching this, fixes a real live bug found in the process:
-- sync_subscription() (061_per_org_quota_reset.sql) reads doc_quota from
-- the `plans` table (003_stripe.sql) — a first-generation reference table
-- using the OLD plan ids (free/starter/pro/enterprise). It was never
-- updated when the pricing model moved to free/pro/premium/team/business/
-- enterprise (035_updated_pricing.sql, which correctly updates
-- `pricing_plans` instead). Every subscription webhook for premium/team/
-- business plans has therefore been finding no matching row and silently
-- falling back to `COALESCE(v_quota, 50)` — capping paying Premium/Team/
-- Business subscribers at 50 docs/month, the same as a stale free-tier
-- default. Repointing this at `pricing_plans` (the table 035 actually
-- maintains) fixes that for real, not just for the new fair-use values.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fair-use caps in the table that's actually kept current ─────────────
-- Enterprise uses 99999 explicitly — increment_doc_used()'s existing
-- "unlimited" check is `v_quota >= 99999`, not `v_quota = 0` despite
-- pricing_plans' original comment claiming 0 means unlimited; storing 0
-- there would make v_used >= v_quota true on someone's very first document.
UPDATE pricing_plans SET doc_quota = 500   WHERE id = 'pro';
UPDATE pricing_plans SET doc_quota = 600   WHERE id = 'premium';
UPDATE pricing_plans SET doc_quota = 2500  WHERE id = 'team';
UPDATE pricing_plans SET doc_quota = 5000  WHERE id = 'business';
UPDATE pricing_plans SET doc_quota = 99999 WHERE id = 'enterprise';
-- ── 2. Point sync_subscription at the table that's actually current ────────
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
  SELECT doc_quota INTO v_quota FROM pricing_plans WHERE id = p_plan_id;

  UPDATE organizations SET
    stripe_subscription_id = p_stripe_sub_id,
    stripe_customer_id     = p_stripe_customer_id,
    subscription_status    = p_status,
    subscription_ends_at   = p_ends_at,
    plan                   = p_plan_id,
    doc_quota              = COALESCE(v_quota, 15),  -- 15 = free-tier default, not the old 50
    next_quota_reset_at    = COALESCE(p_ends_at, now() + interval '1 month'),
    updated_at             = now()
  WHERE id = p_org_id;
END;
$$;
-- ── 3. Defensive fix: never let doc_quota=0 mean "block everything" ────────
-- Belt-and-suspenders against the exact bug this migration is fixing:
-- if a plan lookup ever again returns 0 (missing row, bad data, etc.),
-- treat it the same as the 99999 "unlimited" sentinel rather than blocking
-- a brand-new org's very first document (0 >= 0 is true).
CREATE OR REPLACE FUNCTION increment_doc_used(p_org_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota     int;
  v_used      int;
  v_new_used  int;
BEGIN
  SELECT doc_quota, doc_used INTO v_quota, v_used
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF v_quota <= 0 OR v_quota >= 99999 THEN
    UPDATE organizations SET doc_used = doc_used + 1 WHERE id = p_org_id;
    RETURN true;
  END IF;

  IF v_used >= v_quota THEN
    RETURN false;
  END IF;

  v_new_used := v_used + 1;
  UPDATE organizations SET doc_used = v_new_used WHERE id = p_org_id;

  IF v_used < (v_quota * 0.8) AND v_new_used >= (v_quota * 0.8) THEN
    INSERT INTO notifications (organization_id, type, title, body, metadata)
    VALUES (
      p_org_id, 'quota_warning', 'โควต้าเอกสารใกล้เต็มแล้ว',
      format('ใช้ไป %s จาก %s เอกสารในรอบนี้ (%s%%)',
             v_new_used, v_quota, round(v_new_used::numeric / v_quota * 100)),
      jsonb_build_object('doc_used', v_new_used, 'doc_quota', v_quota)
    );
  END IF;

  IF v_new_used >= v_quota THEN
    INSERT INTO notifications (organization_id, type, title, body, metadata)
    VALUES (
      p_org_id, 'quota_exceeded', 'โควต้าเอกสารเต็มแล้ว',
      format('ใช้ครบ %s เอกสารแล้วในรอบนี้ — อัปโหลดเพิ่มไม่ได้จนกว่าจะรอบถัดไปหรืออัปเกรดแผน', v_quota),
      jsonb_build_object('doc_used', v_new_used, 'doc_quota', v_quota)
    );
  END IF;

  RETURN true;
END;
$$;
-- ── 4. Backfill orgs already subscribed to an affected plan ────────────────
-- Without this, existing Premium/Team/Business subscribers stay stuck on
-- whatever wrong value the old buggy sync_subscription gave them (commonly
-- 50) until their next Stripe renewal webhook fires — could be up to a
-- month away.
UPDATE organizations o
SET doc_quota = pp.doc_quota
FROM pricing_plans pp
WHERE pp.id = o.plan
  AND o.plan IN ('pro', 'premium', 'team', 'business', 'enterprise')
  AND o.doc_quota IS DISTINCT FROM pp.doc_quota;
