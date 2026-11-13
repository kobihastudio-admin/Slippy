-- 20261113130000_open_direct_conversation.sql
-- APPLIED 2026-11-13 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval (D-077
-- schema/RLS gate); the hosted migration list records it as version 20261113072109 (name open_direct_conversation).
-- Spec: docs/superpowers/specs/2026-11-13-open-direct-conversation-design.md
--
-- The iOS app opened a chat with a friend in three client-side steps: insert the conversation `returning id`, then
-- insert both members. Both steps are refused by RLS for a signed-in user (checked on 2026-11-13 with a simulated JWT in
-- a rolled-back transaction): the new row is not visible to its creator through `conversations_member_read` because the
-- creator is not a member yet (42501 on the INSERT ... RETURNING), and `conversation_members` has no INSERT policy at all
-- (42501). So a chat could never be started from the phone, with or without friends.
--
-- This function does it on the server, as one step, with the caller's identity:
--   * the caller must be signed in and must have an ACCEPTED friendship with `p_friend_id` (this also closes the old gap
--     that nothing checked friendship before a room was created);
--   * an existing direct room of exactly these two people is reused (found by `direct_pair_key`, or, for a room made
--     before the key existed, by its two members), otherwise the room and both members are created together;
--   * two simultaneous calls end up in the same room (the unique index on direct_pair_key decides).
-- No policy is added or changed: the table-level rules stay as they are and nobody can write members directly.
--
-- guard_direct_pair_key() refused any write of the key when auth.uid() is not null, which would also refuse this function
-- (it runs with the caller's JWT claims). It now looks at who is executing the statement instead: a user's own role
-- (authenticated / anon) is refused, the function owner (SECURITY DEFINER), the service role and SQL are not.

CREATE OR REPLACE FUNCTION public.guard_direct_pair_key() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (TG_OP = 'INSERT' AND NEW.direct_pair_key IS NOT NULL
          OR TG_OP = 'UPDATE' AND NEW.direct_pair_key IS DISTINCT FROM OLD.direct_pair_key) THEN
    RAISE EXCEPTION 'direct_pair_key is set by the server only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_direct_conversation(p_friend_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me   uuid := auth.uid();
  key  text;
  room uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_friend_id IS NULL OR p_friend_id = me THEN
    RAISE EXCEPTION 'invalid_friend' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE f.status = 'accepted'
       AND ((f.requester_id = me AND f.addressee_id = p_friend_id)
         OR (f.addressee_id = me AND f.requester_id = p_friend_id))
  ) THEN
    RAISE EXCEPTION 'not_friends' USING ERRCODE = '42501';
  END IF;

  -- smaller id first, plain code-unit order: the same key web/src/lib/chat-access.ts directPairKey() builds
  IF me::text COLLATE "C" < p_friend_id::text COLLATE "C" THEN
    key := me::text || ':' || p_friend_id::text;
  ELSE
    key := p_friend_id::text || ':' || me::text;
  END IF;

  SELECT c.id INTO room FROM public.conversations c WHERE c.type = 'direct' AND c.direct_pair_key = key;
  IF room IS NULL THEN
    -- a direct room made before direct_pair_key existed: exactly these two members
    SELECT c.id INTO room
      FROM public.conversations c
     WHERE c.type = 'direct'
       AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = me)
       AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = p_friend_id)
       AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
     ORDER BY c.created_at
     LIMIT 1;
  END IF;
  IF room IS NOT NULL THEN
    RETURN room;
  END IF;

  BEGIN
    INSERT INTO public.conversations (type, created_by, direct_pair_key)
    VALUES ('direct', me, key)
    RETURNING id INTO room;
  EXCEPTION WHEN unique_violation THEN
    -- a simultaneous call created it first: use that room
    SELECT c.id INTO room FROM public.conversations c WHERE c.type = 'direct' AND c.direct_pair_key = key;
    RETURN room;
  END;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (room, me, 'admin'), (room, p_friend_id, 'member');

  RETURN room;
END;
$$;

REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.open_direct_conversation(uuid) IS
  'The direct room of the signed-in user and an accepted friend: reused if it exists, else created with both members in one step. Replaces the iOS client-side insert of the conversation and its members, which RLS refuses.';

-- ROLLBACK (run by hand if needed; the iOS app would then be unable to start a chat again, as before):
--   DROP FUNCTION IF EXISTS public.open_direct_conversation(uuid);
--   -- restore the previous guard (refuses any user JWT that sets the key; note it also refuses a SECURITY DEFINER caller):
--   CREATE OR REPLACE FUNCTION public.guard_direct_pair_key() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$
--   BEGIN
--     IF auth.uid() IS NOT NULL
--        AND (TG_OP = 'INSERT' AND NEW.direct_pair_key IS NOT NULL
--             OR TG_OP = 'UPDATE' AND NEW.direct_pair_key IS DISTINCT FROM OLD.direct_pair_key) THEN
--       RAISE EXCEPTION 'direct_pair_key is set by the server only' USING ERRCODE = '42501';
--     END IF;
--     RETURN NEW;
--   END;
--   $f$;
