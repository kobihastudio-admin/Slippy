-- 042_users_rls_repair.sql
--
-- Repairs the RLS policies + grants for `public.users` that should have
-- been put in place by 005_grants_and_onboarding.sql.
--
-- Symptom: with RLS enabled and no (or missing) policies, an authenticated
-- user's SELECT on their own `users` row returns 0 rows and UPDATE affects
-- 0 rows (no error thrown by PostgREST) — so:
--   * /profile shows the email-derived fallback name + initials avatar
--     instead of the real full_name/avatar_url
--   * picking/uploading an avatar on /profile appears to "save" (no error
--     toast) but the row is never actually updated
--   * /dashboard reads avatar_url from auth user_metadata (OAuth provider
--     photo) and shows a different picture than /profile
--
-- This migration is idempotent so it's safe to re-run even if 005 already
-- applied successfully.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = auth.uid());
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
GRANT SELECT ON TABLE users TO authenticated;
-- `authenticated` previously held a table-wide UPDATE/INSERT grant from when
-- this table was created (Supabase Studio grants ALL by default). Combined
-- with the row-level policy above (id = auth.uid()), that would let any
-- signed-in user PATCH their own row's `is_superadmin`, `email`, `id`, etc.
-- via a raw PostgREST request. Narrow it to just the two profile fields the
-- app actually lets users edit.
REVOKE INSERT, UPDATE ON TABLE users FROM authenticated;
GRANT UPDATE (full_name, avatar_url) ON TABLE users TO authenticated;
