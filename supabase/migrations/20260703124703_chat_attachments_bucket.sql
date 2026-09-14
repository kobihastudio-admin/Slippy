INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', true, 10485760)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "chat_attachments_select_public" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');

CREATE POLICY "chat_attachments_insert_authenticated" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-attachments');

CREATE POLICY "chat_attachments_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid());
;
