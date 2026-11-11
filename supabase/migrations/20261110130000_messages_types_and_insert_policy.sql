-- 20261110130000_messages_types_and_insert_policy.sql
-- APPLIED 2026-11-11 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval (D-077
-- schema/RLS gate); the hosted migration list records it as version 20261111005113 (name messages_types_and_insert_policy).
-- Spec: docs/superpowers/specs/2026-11-10-chat-message-types-design.md
--
-- 1. The web chat sends msg_type 'video' and 'file', but messages_msg_type_check only allowed
--    text/image/payment_request/slip/system, so those sends failed (the route used to answer 200 anyway).
-- 2. messages_member_insert only checked sender_id = auth.uid() and membership, so any member could insert
--    'payment_request', 'slip' or 'system' rows directly through PostgREST with their own JWT and fake a payment card
--    or a system notice. Those types are written by server code with the service role (payment-requests,
--    liff/split-groups send-qr, trips/trip-conversation), which bypasses RLS, so they keep working.
--
-- Existing data: 8 rows (text 4, image 3, system 1), all inside the new CHECK. iOS and the Expo app insert only
-- 'text' with the user's JWT, so they are unaffected.

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text', 'image', 'video', 'file', 'payment_request', 'slip', 'system'));

DROP POLICY IF EXISTS messages_member_insert ON public.messages;
CREATE POLICY messages_member_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id)
    AND msg_type IN ('text', 'image', 'video', 'file')
  );

-- ROLLBACK (run by hand if needed; restores the previous behaviour exactly):
--   ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
--   ALTER TABLE public.messages ADD CONSTRAINT messages_msg_type_check
--     CHECK (msg_type IN ('text', 'image', 'payment_request', 'slip', 'system'));
--   DROP POLICY IF EXISTS messages_member_insert ON public.messages;
--   CREATE POLICY messages_member_insert ON public.messages
--     FOR INSERT TO authenticated
--     WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id));
