-- ============================================================
-- Migration 083: Give a quota slot back when a document is discarded
-- ============================================================
-- The iOS capture flow now uploads as soon as the photo is enhanced, so the AI
-- reading is ready by the time the user finishes reviewing it. That means a
-- capture the user then abandons ("เลือกใหม่" / ยกเลิก) has already consumed a
-- slot via increment_doc_used. Hand it back, so retaking a bad shot doesn't
-- quietly eat the monthly allowance.
--
-- Clamped at zero and never touches unlimited orgs, so repeated or stray calls
-- can't drive the counter negative.

create or replace function public.decrement_doc_used(p_org_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update organizations
  set doc_used = greatest(0, doc_used - 1)
  where id = p_org_id
    and doc_quota > 0
    and doc_quota < 99999;
end;
$$;

grant execute on function public.decrement_doc_used(uuid) to authenticated, service_role;
