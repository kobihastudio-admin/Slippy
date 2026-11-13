-- 20261113100000_related_profiles_rpc.sql
-- APPLIED 2026-11-13 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval (D-077
-- schema/RLS gate); the hosted migration list records it as version 20261113042118 (name related_profiles_rpc).
-- Spec: docs/superpowers/specs/2026-11-13-related-profiles-design.md
--
-- public.users is readable only by its owner (users_select_own: id = auth.uid(); the table also holds phone,
-- date_of_birth and is_superadmin, which is why). The iOS app reads other people's profiles with a plain
-- select on public.users, so under RLS it always got an empty result: the friend list, the profiles of people who sent
-- a friend request, and the names/avatars in the chat list were all empty, and "start a chat" had nobody to pick.
-- The web app is not affected (it reads through the service role).
--
-- This function is the narrow door: it returns ONLY id, full_name, avatar_url and email, and only for people who are
-- related to the caller:
--   * the caller;
--   * someone with a pending or accepted friendship with the caller (either direction; a blocked one is not related);
--   * someone who shares a conversation with the caller.
-- The email is returned only for the caller and accepted friends (the app falls back to it when there is no name);
-- for everyone else it is ''. No phone, no date of birth, no flags. The policies on public.users are not touched.

CREATE OR REPLACE FUNCTION public.get_related_profiles(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text, avatar_url text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.full_name,
         u.avatar_url,
         CASE
           WHEN u.id = auth.uid() THEN COALESCE(u.email, '')
           WHEN EXISTS (
             SELECT 1 FROM public.friendships f
              WHERE f.status = 'accepted'
                AND ((f.requester_id = auth.uid() AND f.addressee_id = u.id)
                  OR (f.addressee_id = auth.uid() AND f.requester_id = u.id))
           ) THEN COALESCE(u.email, '')
           ELSE ''
         END AS email
    FROM public.users u
   WHERE auth.uid() IS NOT NULL
     AND u.id = ANY (p_ids[1:200])
     AND (
       u.id = auth.uid()
       OR EXISTS (
         SELECT 1 FROM public.friendships f
          WHERE f.status IN ('pending', 'accepted')
            AND ((f.requester_id = auth.uid() AND f.addressee_id = u.id)
              OR (f.addressee_id = auth.uid() AND f.requester_id = u.id))
       )
       OR EXISTS (
         SELECT 1 FROM public.conversation_members mine
           JOIN public.conversation_members theirs ON theirs.conversation_id = mine.conversation_id
          WHERE mine.user_id = auth.uid() AND theirs.user_id = u.id
       )
     );
$$;

REVOKE ALL ON FUNCTION public.get_related_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_related_profiles(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_related_profiles(uuid[]) IS
  'Profiles (id, full_name, avatar_url, email) of the caller, their pending/accepted friends and the people they share a conversation with. Email only for the caller and accepted friends. Replaces the iOS reads of public.users, which users_select_own hides.';

-- ROLLBACK (run by hand if needed; nothing else depends on it):
--   DROP FUNCTION IF EXISTS public.get_related_profiles(uuid[]);
