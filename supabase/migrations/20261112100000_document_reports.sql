-- 20261112100000_document_reports.sql
-- APPLIED 2026-11-12 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval (D-077
-- schema/RLS gate); the hosted migration list records it as version 20261112160553 (name document_reports).
-- Spec: docs/superpowers/specs/2026-11-12-document-footer-actions-design.md
--
-- The "รายงานปัญหา" button on the iOS document screen only opened a share sheet with a text; nothing was recorded
-- anywhere. This table is where a report lands: one row per (document, reporter, category) while it is still open.
--
-- Who may do what:
--   insert  a member of the document's organization, as themselves, for a document of that organization, with
--           status 'open' (so a user cannot file a report that is already "resolved");
--   select  the reporter sees their own reports;
--   update/delete  nobody with a user JWT. The service role (the team, through SQL or a later admin screen) reads
--           and changes status; it bypasses RLS.
-- Nothing reads these rows back into the app yet. That is a separate piece of work, not part of this table.

CREATE TABLE IF NOT EXISTS public.document_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category        text        NOT NULL
    CHECK (category IN ('wrong_amount', 'wrong_vendor', 'wrong_date', 'wrong_tax', 'unreadable', 'duplicate', 'other')),
  note            text
    CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  context         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  app_version     text        CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  status          text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 'other' is the only category that has no meaning without a description.
  CONSTRAINT document_reports_other_needs_note CHECK (category <> 'other' OR note IS NOT NULL)
);

COMMENT ON TABLE public.document_reports IS
  'User-submitted problem reports about a document (iOS "รายงานปัญหา"). Inserted with the user''s JWT under RLS; read and triaged by the team through the service role. Nothing reads it back into the app yet.';

-- A second identical report while the first is open is refused (the app treats that as "already reported").
CREATE UNIQUE INDEX IF NOT EXISTS document_reports_open_unique
  ON public.document_reports (document_id, reporter_id, category)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS document_reports_document_idx ON public.document_reports (document_id);
CREATE INDEX IF NOT EXISTS document_reports_status_idx ON public.document_reports (status, created_at DESC);

ALTER TABLE public.document_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_reports_member_insert ON public.document_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'open'
    AND organization_id = ANY (get_my_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.documents d
       WHERE d.id = document_reports.document_id
         AND d.organization_id = document_reports.organization_id
    )
  );

CREATE POLICY document_reports_own_select ON public.document_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- Table privileges as narrow as the policies: the project's default privileges would otherwise hand every role
-- full access (RLS would still refuse, but a missing policy later must not silently open the table).
REVOKE ALL ON TABLE public.document_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.document_reports TO authenticated;
GRANT ALL ON TABLE public.document_reports TO service_role;

-- ROLLBACK (run by hand if needed; the table holds only reports, nothing else depends on it):
--   DROP TABLE IF EXISTS public.document_reports;
