-- ═══════════════════════════════════════════════════════════════════════════
-- 076_chat_attachments_bucket.sql — Dedicated public bucket for chat images/files
--
-- ChatRoom.tsx was uploading attachments into the shared "documents" bucket
-- and rendering them via getPublicUrl(). That bucket is PRIVATE
-- (storage.buckets.public = false, holds sensitive receipts/invoices), so
-- getPublicUrl() returned a URL that a plain <img> tag (no auth header)
-- can't actually load — broken image icon in chat every time. Rather than
-- making the shared documents bucket public (would expose unrelated
-- sensitive files), chat attachments get their own public bucket, same
-- pattern as the existing "avatars" bucket.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', true, 10485760) -- 10MB
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "chat_attachments_select_public" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');

CREATE POLICY "chat_attachments_insert_authenticated" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-attachments');

CREATE POLICY "chat_attachments_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid());
