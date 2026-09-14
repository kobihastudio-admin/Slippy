-- 024_enable_realtime.sql
-- Enable Supabase Realtime for documents table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE documents;
  END IF;
END $$;
-- REPLICA IDENTITY FULL ensures UPDATE events carry ALL column values
ALTER TABLE documents REPLICA IDENTITY FULL;
