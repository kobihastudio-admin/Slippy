-- ---------------------------------------------------------------------------
-- 061_per_org_quota_reset.sql
--
-- Replaces the dormant, never-scheduled `reset_monthly_quota()` (which would
-- have reset every org on the 1st of the month, ignoring each org's actual
-- Stripe billing cycle) with a per-org reset that follows each org's real
-- cycle:
--   • Orgs on an active Stripe subscription — reset when their current
--     billing period ends (kept in sync with Stripe via sync_subscription
--     on every renewal webhook).
--   • Free / no-subscription orgs — reset monthly on a rolling anchor from
--     their signup date (created_at), since there's no Stripe cycle to
--     follow.
-- ---------------------------------------------------------------------------

-- ── 1. New columns on organizations ─────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS next_quota_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_quota_reset_at timestamptz;
COMMENT ON COLUMN organizations.next_quota_reset_at IS
  'When doc_used next resets. For orgs with an active Stripe subscription this
   mirrors subscription_ends_at (current_period_end), refreshed by
   sync_subscription on each renewal webhook. For free/no-subscription orgs
   it rolls forward by 1 month each time reset_due_org_quotas() fires.';
COMMENT ON COLUMN organizations.last_quota_reset_at IS
  'The next_quota_reset_at boundary that was last actually reset against —
   prevents reset_due_org_quotas() from resetting the same period twice
   before the boundary advances again.';
-- Backfill: paid orgs follow their existing Stripe period end; everyone else
-- gets a rolling monthly anchor starting one month after signup.
UPDATE organizations
SET next_quota_reset_at = subscription_ends_at
WHERE subscription_ends_at IS NOT NULL
  AND next_quota_reset_at IS NULL;
UPDATE organizations
SET next_quota_reset_at = created_at + interval '1 month'
WHERE subscription_ends_at IS NULL
  AND next_quota_reset_at IS NULL;
-- ── 2. Keep next_quota_reset_at in sync with Stripe's billing cycle ─────────
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
    -- p_ends_at is Stripe's current_period_end on create/renew, or NULL on
    -- cancellation. Mirror it here; cancelled orgs fall back to a fresh
    -- rolling monthly anchor from "now" since they're back on the free cycle.
    next_quota_reset_at    = COALESCE(p_ends_at, now() + interval '1 month'),
    updated_at             = now()
  WHERE id = p_org_id;
END;
$$;
-- ── 3. Replace the dormant blanket reset with a per-org due-date reset ─────
DROP FUNCTION IF EXISTS reset_monthly_quota();
CREATE OR REPLACE FUNCTION reset_due_org_quotas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Orgs following a Stripe billing cycle: reset once the current period end
  -- passes. Don't self-advance next_quota_reset_at here — the next
  -- subscription.updated webhook will push it forward to the new period end.
  -- The last_quota_reset_at guard stops this from re-firing daily while
  -- waiting for that webhook.
  UPDATE organizations
  SET doc_used            = 0,
      last_quota_reset_at = next_quota_reset_at
  WHERE subscription_ends_at IS NOT NULL
    AND next_quota_reset_at <= now()
    AND (last_quota_reset_at IS NULL OR last_quota_reset_at < next_quota_reset_at);

  -- Free / no-subscription orgs: roll their own monthly anchor forward.
  UPDATE organizations
  SET doc_used            = 0,
      last_quota_reset_at = next_quota_reset_at,
      next_quota_reset_at = next_quota_reset_at + interval '1 month'
  WHERE subscription_ends_at IS NULL
    AND next_quota_reset_at <= now()
    AND (last_quota_reset_at IS NULL OR last_quota_reset_at < next_quota_reset_at);
END;
$$;
COMMENT ON FUNCTION reset_due_org_quotas() IS
  'Resets doc_used to 0 for orgs whose billing-cycle boundary
   (next_quota_reset_at) has passed. Intended to run daily via the
   reset-org-quotas Edge Function (cron) — billing cycles end on different
   days for different orgs, so this cannot run once a month like the old
   reset_monthly_quota() did.';
