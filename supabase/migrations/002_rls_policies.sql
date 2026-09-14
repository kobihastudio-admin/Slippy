-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ══════════════════════════════════════════════════════════════
--  002_rls_policies.sql
--  Row Level Security — data isolation per organization
-- ══════════════════════════════════════════════════════════════

ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_audit_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_push_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_connection_tokens ENABLE ROW LEVEL SECURITY;
-- ── Helper functions ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_org_ids()
RETURNS uuid[] LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT ARRAY(
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  )
$$;
CREATE OR REPLACE FUNCTION get_my_role(org_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org_id
  LIMIT 1
$$;
-- ── Organizations ──────────────────────────────────────────────
CREATE POLICY "org_select" ON organizations FOR SELECT
  USING (id = ANY(get_my_org_ids()));
CREATE POLICY "org_insert" ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
-- anyone logged in can create org

CREATE POLICY "org_update" ON organizations FOR UPDATE
  USING (get_my_role(id) IN ('owner','admin'))
  WITH CHECK (get_my_role(id) IN ('owner','admin'));
-- ── Members ────────────────────────────────────────────────────
CREATE POLICY "member_select" ON organization_members FOR SELECT
  USING (organization_id = ANY(get_my_org_ids()));
CREATE POLICY "member_insert" ON organization_members FOR INSERT
  WITH CHECK (get_my_role(organization_id) IN ('owner','admin'));
CREATE POLICY "member_update" ON organization_members FOR UPDATE
  USING (get_my_role(organization_id) IN ('owner','admin'));
CREATE POLICY "member_delete" ON organization_members FOR DELETE
  USING (
    get_my_role(organization_id) IN ('owner','admin')
    AND user_id != auth.uid()   -- ลบตัวเองไม่ได้
  );
-- ── Invitations ────────────────────────────────────────────────
CREATE POLICY "invite_select" ON invitations FOR SELECT
  USING (organization_id = ANY(get_my_org_ids()));
CREATE POLICY "invite_insert" ON invitations FOR INSERT
  WITH CHECK (get_my_role(organization_id) IN ('owner','admin'));
CREATE POLICY "invite_delete" ON invitations FOR DELETE
  USING (get_my_role(organization_id) IN ('owner','admin'));
-- Public: anyone with valid token can read (for accepting invites)
CREATE POLICY "invite_public_token" ON invitations FOR SELECT
  USING (
    accepted_at IS NULL
    AND expires_at > now()
  );
-- ── Integrations ───────────────────────────────────────────────
CREATE POLICY "integration_select" ON integrations FOR SELECT
  USING (organization_id = ANY(get_my_org_ids()));
CREATE POLICY "integration_write" ON integrations FOR ALL
  USING (get_my_role(organization_id) IN ('owner','admin'))
  WITH CHECK (get_my_role(organization_id) IN ('owner','admin'));
CREATE POLICY "int_accounts_select" ON integration_accounts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.id = integration_id
      AND i.organization_id = ANY(get_my_org_ids())
  ));
CREATE POLICY "int_contacts_select" ON integration_contacts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.id = integration_id
      AND i.organization_id = ANY(get_my_org_ids())
  ));
CREATE POLICY "account_mappings_select" ON account_mappings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.id = integration_id
      AND i.organization_id = ANY(get_my_org_ids())
  ));
-- ── Documents ──────────────────────────────────────────────────
CREATE POLICY "doc_select" ON documents FOR SELECT
  USING (organization_id = ANY(get_my_org_ids()));
CREATE POLICY "doc_insert" ON documents FOR INSERT
  WITH CHECK (
    organization_id = ANY(get_my_org_ids())
    AND get_my_role(organization_id) IN ('owner','admin','accountant')
  );
CREATE POLICY "doc_update" ON documents FOR UPDATE
  USING (
    organization_id = ANY(get_my_org_ids())
    AND get_my_role(organization_id) IN ('owner','admin','accountant')
  );
CREATE POLICY "doc_delete" ON documents FOR DELETE
  USING (get_my_role(organization_id) IN ('owner','admin'));
-- ── Document sub-tables ────────────────────────────────────────
CREATE POLICY "line_items_select" ON document_line_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_id AND d.organization_id = ANY(get_my_org_ids())
  ));
CREATE POLICY "line_items_write" ON document_line_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_id
      AND d.organization_id = ANY(get_my_org_ids())
      AND get_my_role(d.organization_id) IN ('owner','admin','accountant')
  ));
CREATE POLICY "audit_select" ON document_audit_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_id AND d.organization_id = ANY(get_my_org_ids())
  ));
CREATE POLICY "push_select" ON document_push_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_id AND d.organization_id = ANY(get_my_org_ids())
  ));
-- ── Line ───────────────────────────────────────────────────────
CREATE POLICY "line_conn_select" ON line_connections FOR SELECT
  USING (user_id = auth.uid() OR organization_id = ANY(get_my_org_ids()));
CREATE POLICY "line_token_select" ON line_connection_tokens FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "line_token_insert" ON line_connection_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());
