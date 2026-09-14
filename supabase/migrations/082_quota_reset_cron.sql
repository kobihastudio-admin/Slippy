-- ============================================================
-- Migration 082: Schedule the monthly org-quota reset (pg_cron)
-- ============================================================
-- reset_due_org_quotas() (migration 061) resets doc_used and rolls each org's
-- next_quota_reset_at forward, but NOTHING was ever invoking it — the intended
-- caller (the reset-org-quotas Edge Function) had no scheduler, and pg_cron was
-- not installed. Result: every free-plan org got permanently stuck at its quota
-- once the first period ended (next_quota_reset_at stayed in the past forever,
-- so uploads returned 402 "quota exceeded" and the pipeline never ran).
--
-- Fix: run the reset directly from pg_cron once a day. The function is
-- idempotent (the last_quota_reset_at guard stops double-resets), so a daily
-- run only ever resets orgs whose period has actually elapsed.

create extension if not exists pg_cron;

-- Daily at 01:00 UTC. cron.schedule upserts by job name, so re-running is safe.
select cron.schedule(
  'reset-org-quotas-daily',
  '0 1 * * *',
  $$select public.reset_due_org_quotas()$$
);

-- NOTE (one-time, already applied on prod, not re-run by this migration):
-- orgs that had been stuck for several months were multiple periods behind, so
-- reset_due_org_quotas() was looped until `next_quota_reset_at > now()` for all
-- of them:
--   do $$ declare due int; begin loop
--     perform reset_due_org_quotas();
--     select count(*) into due from organizations
--       where next_quota_reset_at <= now()
--         and (last_quota_reset_at is null or last_quota_reset_at < next_quota_reset_at);
--     exit when due = 0; end loop; end $$;
