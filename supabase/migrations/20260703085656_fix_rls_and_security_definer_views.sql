-- 1) pricing_plans: existing policy only covers superadmin write (ALL cmd,
--    superadmin-only), RLS was never enabled so the policy never took
--    effect (table fully open). Plans need to stay publicly READABLE
--    (pricing/register pages fetch this for anonymous visitors), so add an
--    explicit public SELECT policy alongside the existing write policy.
ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_plans_select_public" ON public.pricing_plans FOR SELECT USING (true);

-- 2) image_quality_logs has no owner column directly, but is 1:1 with a
--    document — scope through documents' organization_id + org membership,
--    same pattern as the rest of this org-scoped app. No client-side
--    INSERT policy: this table is only ever written by the server-side OCR
--    pipeline via the service-role client, which bypasses RLS regardless.
ALTER TABLE public.image_quality_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "image_quality_logs_select" ON public.image_quality_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.documents d
    JOIN public.organization_members om ON om.organization_id = d.organization_id
    WHERE d.id = image_quality_logs.document_id AND om.user_id = auth.uid()
  ));

-- 3) Four views are SECURITY DEFINER (Postgres default for views), so they
--    bypass the RLS of their underlying tables entirely — any caller sees
--    every organization's/user's aggregated data. All four underlying
--    tables (expense_claims, medication_logs, receipt_corrections,
--    organizations) already have correct RLS policies (verified), so
--    switching to security_invoker just makes the view respect them.
ALTER VIEW public.expense_claim_stats SET (security_invoker = true);
ALTER VIEW public.medication_adherence SET (security_invoker = true);
ALTER VIEW public.vendor_correction_map SET (security_invoker = true);
ALTER VIEW public.org_plan_details SET (security_invoker = true);
;
