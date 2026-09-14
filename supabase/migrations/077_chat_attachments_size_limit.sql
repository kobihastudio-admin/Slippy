-- ═══════════════════════════════════════════════════════════════════════════
-- 077_chat_attachments_size_limit.sql
-- 10MB (set in 076) was fine for images/PDFs but too tight for video clips,
-- now a supported chat attachment type — bump to 50MB.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'chat-attachments';
