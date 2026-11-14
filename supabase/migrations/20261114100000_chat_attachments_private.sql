-- 20261114100000_chat_attachments_private.sql
-- NOT APPLIED. Applying it to the hosted project (D-077 schema / security gate) needs the user's explicit approval, and
-- only AFTER the web image and the iOS build that sign their own URLs are live (see "ORDER" below).
-- Spec: docs/superpowers/specs/2026-11-14-private-chat-files-design.md
--
-- The `chat-attachments` bucket was PUBLIC: anyone holding a file's link could open it without signing in, and any
-- signed-in user could upload into any conversation's folder (the INSERT policy only checked the bucket). It is used by
-- chat only (trip photos live in `trip-photos`, documents in `documents` / `trip-documents`).
--
-- After this migration:
--   * the bucket is private: nothing is readable by a plain URL;
--   * an object is readable and uploadable only by a MEMBER of the conversation named in its path
--     `chat/<conversationId>/<millis>.<ext>` (the same shape the web and iOS chat already write);
--   * clients open files with short-lived signed URLs minted with their own session (Storage checks the SELECT policy
--     first), and a forwarded file is COPIED into the target conversation's folder (copy needs SELECT on the source and
--     INSERT on the destination, which the forwarder has as a member of both rooms);
--   * deleting stays "your own objects" (`chat_attachments_delete_own`, not touched here); the service role is never
--     subject to these policies.
-- No row of `messages` or `storage.objects` is changed. Existing messages keep their stored public URL; clients read the
-- object path out of it and sign that.
--
-- ORDER: 1) deploy the web image and install the iOS build that sign URLs (they work while the bucket is still public
-- too), 2) apply this migration. Applying it first would make today's iOS build and web page show no pictures.

-- The conversation id inside an object name, or NULL when the name is not `chat/<uuid>/<name>.<ext>`.
CREATE OR REPLACE FUNCTION public.chat_attachment_conversation(p_name text) RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_name ~* '^chat/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]+\.[a-z0-9]{1,8}$'
    THEN split_part(p_name, '/', 2)::uuid
  END
$$;
REVOKE ALL ON FUNCTION public.chat_attachment_conversation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_attachment_conversation(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "chat_attachments_select_public" ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_insert_authenticated" ON storage.objects;

CREATE POLICY "chat_attachments_select_members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.is_conversation_member(public.chat_attachment_conversation(name))
  );

CREATE POLICY "chat_attachments_insert_members" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND public.is_conversation_member(public.chat_attachment_conversation(name))
  );

UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- ROLLBACK (run by hand if needed; files become readable by anyone with the link again):
--   UPDATE storage.buckets SET public = true WHERE id = 'chat-attachments';
--   DROP POLICY IF EXISTS "chat_attachments_select_members" ON storage.objects;
--   DROP POLICY IF EXISTS "chat_attachments_insert_members" ON storage.objects;
--   CREATE POLICY "chat_attachments_select_public" ON storage.objects FOR SELECT USING (bucket_id = 'chat-attachments');
--   CREATE POLICY "chat_attachments_insert_authenticated" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-attachments');
--   DROP FUNCTION IF EXISTS public.chat_attachment_conversation(text);
