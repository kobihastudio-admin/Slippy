-- ═══════════════════════════════════════════════════════════════════════════
-- 027_pgvector_memory.sql — AI Memory with Vector Embeddings
-- Enables semantic search over life memories using pgvector
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
-- Add embedding column to life_memories for semantic search
ALTER TABLE life_memories
  ADD COLUMN IF NOT EXISTS embedding vector(1536);
-- text-embedding-3-small dimensions

-- Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_lm_embedding
  ON life_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- Document embeddings for semantic document search
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_doc_embedding
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- ─── Semantic memory search function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_memories(
  p_org_id      uuid,
  p_embedding   vector(1536),
  p_limit       int DEFAULT 10,
  p_threshold   float DEFAULT 0.7
)
RETURNS TABLE (
  id            uuid,
  memory_type   text,
  key           text,
  value         jsonb,
  similarity    float
)
LANGUAGE sql AS $$
  SELECT id, memory_type, key, value,
    1 - (embedding <=> p_embedding) AS similarity
  FROM life_memories
  WHERE organization_id = p_org_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> p_embedding) > p_threshold
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$;
-- ─── Semantic document search function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION search_documents_semantic(
  p_org_id      uuid,
  p_embedding   vector(1536),
  p_limit       int DEFAULT 10,
  p_threshold   float DEFAULT 0.5
)
RETURNS TABLE (
  id            uuid,
  vendor_name   text,
  total_amount  numeric,
  doc_date      text,
  doc_category  text,
  status        text,
  similarity    float
)
LANGUAGE sql AS $$
  SELECT id, vendor_name, total_amount, doc_date, doc_category, status,
    1 - (embedding <=> p_embedding) AS similarity
  FROM documents
  WHERE organization_id = p_org_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> p_embedding) > p_threshold
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$;
