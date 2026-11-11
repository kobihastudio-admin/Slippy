-- 20261111120000_direct_conversation_pair_key.sql
-- APPLIED 2026-11-11 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval (D-077
-- schema gate); the hosted migration list records it as version 20261111024912 (name direct_conversation_pair_key).
-- Spec: docs/superpowers/specs/2026-11-11-direct-conversation-unique-design.md
--
-- Two requests that open the same direct chat at the same moment (a double tap, web and LINE together, send-qr and the
-- web route) both ran "look for the room, none, create one", and each created its own room: two direct rooms for one
-- pair, with the messages split between them. The pair of a direct room lives in conversation_members (two rows), which
-- a UNIQUE constraint cannot express, so the pair is also stored on the room itself:
--
--   conversations.direct_pair_key = '<smaller user id>:<larger user id>'   (lower-case, plain code-unit order)
--
-- with a partial UNIQUE index, so the database refuses a second direct room for the same two people. The server code that
-- creates direct rooms (web/src/lib/chat-access.ts getOrCreateDirectConversation) sets it and, on a unique violation,
-- uses the room that won.
--
-- The column is nullable: a room created by a writer that does not set it (the iOS app, today) is simply not covered,
-- exactly as before. Only the service role / SQL may set or change it; a user's own JWT may not, otherwise any user
-- could claim the key of two other people and block their chat.
--
-- If a pair already has two direct rooms when this runs, the CREATE UNIQUE INDEX fails and the whole migration is
-- rolled back with nothing changed (checked before drafting: 3 rooms, 1 direct, no duplicates, no direct room with
-- other than two members).

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS direct_pair_key text;

-- Only direct rooms carry a key; it is two different lower-case uuids, smaller first (COLLATE "C" = code-unit order,
-- the same order the application sorts in).
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_direct_pair_key_shape;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_direct_pair_key_shape CHECK (
  direct_pair_key IS NULL
  OR (
    type = 'direct'
    AND direct_pair_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND split_part(direct_pair_key, ':', 1) COLLATE "C" < split_part(direct_pair_key, ':', 2) COLLATE "C"
  )
);

-- Existing direct rooms with exactly two members get their key. (A direct room with any other member count is left
-- without one: it is not a valid pair.)
UPDATE public.conversations c
   SET direct_pair_key = k.pair_key
  FROM (
    SELECT m.conversation_id,
           min(m.user_id::text COLLATE "C") || ':' || max(m.user_id::text COLLATE "C") AS pair_key
      FROM public.conversation_members m
      JOIN public.conversations cc ON cc.id = m.conversation_id AND cc.type = 'direct'
     GROUP BY m.conversation_id
    HAVING count(*) = 2 AND count(DISTINCT m.user_id) = 2
  ) k
 WHERE c.id = k.conversation_id
   AND c.direct_pair_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_key_key
  ON public.conversations (direct_pair_key)
  WHERE type = 'direct' AND direct_pair_key IS NOT NULL;

-- A user's own JWT (auth.uid() is not null) cannot set or change the key; the service role and SQL (auth.uid() is null)
-- can. conversations_creator_insert and conversations_admin_update are left exactly as they are.
CREATE OR REPLACE FUNCTION public.guard_direct_pair_key() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (TG_OP = 'INSERT' AND NEW.direct_pair_key IS NOT NULL
          OR TG_OP = 'UPDATE' AND NEW.direct_pair_key IS DISTINCT FROM OLD.direct_pair_key) THEN
    RAISE EXCEPTION 'direct_pair_key is set by the server only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_guard_direct_pair_key ON public.conversations;
CREATE TRIGGER conversations_guard_direct_pair_key
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_direct_pair_key();

-- ROLLBACK (run by hand if needed; nothing else depends on these objects):
--   DROP TRIGGER IF EXISTS conversations_guard_direct_pair_key ON public.conversations;
--   DROP FUNCTION IF EXISTS public.guard_direct_pair_key();
--   DROP INDEX IF EXISTS public.conversations_direct_pair_key_key;
--   ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_direct_pair_key_shape;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS direct_pair_key;
