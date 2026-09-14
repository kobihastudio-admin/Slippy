-- ---------------------------------------------------------------------------
-- 063_server_error_logging.sql
--
-- Phase 1 of the ops/monitoring backlog: client_error_logs currently only
-- captures browser-side errors (HEIC conversion, camera, upload). There is
-- no durable record of server-side failures anywhere — api/ and the queue
-- workers only console.log, Stripe webhook handler errors aren't logged,
-- and Supabase Edge Functions failures vanish once their run completes.
--
-- Reuses client_error_logs (same shape already fits: error_type, name,
-- message, stack, context jsonb) instead of a new table — just tags rows
-- with where they came from.
-- ---------------------------------------------------------------------------

ALTER TABLE client_error_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'browser'
    CHECK (source IN ('browser', 'server'));
COMMENT ON COLUMN client_error_logs.source IS
  'browser = client-side (Next.js page/component, original use case).
   server  = api/ Fastify routes, BullMQ queue workers, Supabase Edge
   Functions, or any Next.js API route — inserted via logServerError().';
CREATE INDEX IF NOT EXISTS client_error_logs_source_unresolved
  ON client_error_logs (source, created_at DESC)
  WHERE resolved = false;
-- service_role (used by api/ and Edge Functions) bypasses RLS already, but
-- the existing anon/authenticated insert policy only covers browser use —
-- add an explicit service_role policy so this is documented, not implicit.
CREATE POLICY "error_logs_service_role_all" ON client_error_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
