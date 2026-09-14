-- ---------------------------------------------------------------------------
-- Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
-- All rights reserved. Proprietary and confidential.
-- ---------------------------------------------------------------------------

-- ══════════════════════════════════════════════════════════════
--  005_grants_and_onboarding.sql
--  GRANT table permissions to authenticated/anon roles
--  + SECURITY DEFINER function for first-time org creation
-- ══════════════════════════════════════════════════════════════

-- ── Grant table-level access to authenticated users ────────────
-- (Supabase auto-grants these when tables are made via Dashboard,
--  but SQL migrations need explicit grants)

GRANT SELECT, INSERT, UPDATE          ON TABLE organizations        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON TABLE organization_members TO authenticated;
GRANT SELECT, INSERT                  ON TABLE invitations          TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON TABLE integrations         TO authenticated;
GRANT SELECT                          ON TABLE integration_accounts TO authenticated;
GRANT SELECT                          ON TABLE integration_contacts TO authenticated;
GRANT SELECT                          ON TABLE account_mappings     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON TABLE documents            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON TABLE document_line_items  TO authenticated;
GRANT SELECT, INSERT                  ON TABLE document_audit_logs  TO authenticated;
GRANT SELECT, INSERT                  ON TABLE document_push_logs   TO authenticated;
GRANT SELECT, INSERT                  ON TABLE line_connections      TO authenticated;
GRANT SELECT, INSERT                  ON TABLE line_connection_tokens TO authenticated;
GRANT SELECT                          ON TABLE users                TO authenticated;
-- service_role always bypasses RLS — no grants needed for it

-- ── Fix: allow authenticated to update their own full_name ──────
-- (triggers cover INSERT from auth signup, but profile updates
--  need explicit policy + grant)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = auth.uid());
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
GRANT UPDATE (full_name, avatar_url) ON TABLE users TO authenticated;
-- ── SECURITY DEFINER function: first-time org creation ─────────
-- Called from the onboarding wizard; bypasses RLS/grant issues
-- by running as the DB owner (postgres role).

CREATE OR REPLACE FUNCTION public.create_org_for_current_user(
  p_name           text,
  p_slug           text,
  p_tax_id         text    DEFAULT NULL,
  p_address        text    DEFAULT NULL,
  p_fiscal_year_end int    DEFAULT 12,
  p_full_name      text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Update display name if provided
  IF p_full_name IS NOT NULL AND trim(p_full_name) != '' THEN
    UPDATE public.users
    SET full_name = trim(p_full_name)
    WHERE id = v_user_id;
  END IF;

  -- Create org
  INSERT INTO public.organizations
    (name, slug, tax_id, address, fiscal_year_end, plan, doc_quota, doc_used)
  VALUES
    (trim(p_name), trim(p_slug), nullif(trim(p_tax_id),''), nullif(trim(p_address),''),
     p_fiscal_year_end, 'free', 30, 0)
  RETURNING id INTO v_org_id;

  -- Add caller as owner (bypasses member_insert RLS)
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  RETURN v_org_id;
END;
$$;
-- Grant execute to any logged-in user
GRANT EXECUTE ON FUNCTION public.create_org_for_current_user TO authenticated;
