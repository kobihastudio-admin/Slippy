-- ═══════════════════════════════════════════════════════════════════════════
-- 086_ai_usage_log.sql — Durable token accounting for the extraction pipeline
--
-- Nothing recorded a single token before this, which made every cost question
-- unanswerable and every answer a guess. That is not hypothetical: the estimate
-- this table exists to replace was built on a system prompt measured at 46KB
-- when it is actually 8KB — a scripting mistake that pointed the whole
-- optimisation effort at the wrong component. Numbers from the API itself
-- cannot be mis-measured that way.
--
-- What it is for:
--   • Is prompt caching engaging at all? Claude Haiku will not cache a system
--     block below its minimum size, and when it declines it does so SILENTLY —
--     `cache_creation` and `cache_read` both stay 0 while you believe you are
--     caching. That is invisible without this table.
--   • Do images or the prompt dominate? (Slicing a tall receipt into 3 costs
--     roughly 7× the image tokens of sending it whole.)
--   • How often does the Haiku→Sonnet escalation fire, and at 3× the input
--     rate, is it earning its keep?
--
-- Content is never stored — only counts, the model name, and the document id.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  model           text NOT NULL,
  -- Which attempt this was: the first pass, an escalation to a stronger model,
  -- or the DocAI-assisted re-read. Lets cost be attributed to the decision that
  -- caused it rather than averaged away.
  phase           text NOT NULL DEFAULT 'extract'
                    CHECK (phase IN ('extract', 'escalate', 'docai_retry', 'other')),

  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cache_write_tokens    integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer NOT NULL DEFAULT 0,
  -- Estimate only. Rates move; recompute from the token columns when it matters.
  estimated_usd   numeric(10,6) NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org     ON ai_usage_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_doc     ON ai_usage_log (document_id);

-- Written only by the API's service-role client, and it is operational data
-- about our own spend rather than customer content. RLS on with no policy means
-- no anon/authenticated client can read it, which is the intent.
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_usage_log IS
  'Per-call token usage for AI extraction. Counts only, never document content.';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS ai_usage_log;
