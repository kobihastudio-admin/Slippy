-- 20261109130000_line_synced_groups.sql
-- APPLIED 2026-11-09 to Supabase project ntzztcnkedcxfjvfxjrf ("slippy") with the user's explicit approval; the hosted
-- migration list records it as version 20261109131402 (name line_synced_groups), not as this file's timestamp.
-- Per-user, per-group opt-in for ingesting the slips/images/files a user posts in a LINE group.
-- Spec: docs/superpowers/specs/2026-11-09-line-group-sync-design.md
--
-- Only the webhook (service role) writes. A signed-in user may read their OWN rows and nothing else;
-- there is no policy that exposes another user's rows or group ids. No chat content is stored here.

CREATE TABLE IF NOT EXISTS public.line_synced_groups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  line_user_id  text        NOT NULL,            -- the LINE account that typed /syncgroup: the opt-in belongs to THIS sender
  line_group_id text        NOT NULL,            -- LINE groupId or roomId
  group_name    text,                            -- best effort, may stay NULL
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- line_connections.user_id is NOT unique (several LINE accounts can share one Slippy user), so the
  -- opt-in is keyed on the LINE sender; user_id stays for RLS ("my groups") and attribution.
  UNIQUE (line_user_id, line_group_id)
);

ALTER TABLE public.line_synced_groups ENABLE ROW LEVEL SECURITY;

-- REVOKE ... FROM PUBLIC alone does not remove grants Supabase gives anon/authenticated by default.
REVOKE ALL ON public.line_synced_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.line_synced_groups TO authenticated;
GRANT ALL    ON public.line_synced_groups TO service_role;

DROP POLICY IF EXISTS line_synced_groups_select_own ON public.line_synced_groups;
CREATE POLICY line_synced_groups_select_own ON public.line_synced_groups
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
