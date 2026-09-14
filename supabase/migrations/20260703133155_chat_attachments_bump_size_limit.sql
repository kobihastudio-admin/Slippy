-- 10MB was fine for images/PDFs but too tight for video clips (even short
-- ones commonly exceed it). Bumping to 50MB now that video is a supported
-- attachment type in chat.
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'chat-attachments';;
