\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.life_journeys (id uuid PRIMARY KEY);
CREATE TABLE public.community_groups (id uuid PRIMARY KEY);
CREATE TABLE public.community_members (group_id uuid NOT NULL, user_id uuid);

\i /workspace/supabase/migrations/20260903012138_activity_graph.sql

DO $$
BEGIN
  IF to_regclass('public.activities') IS NULL THEN
    RAISE EXCEPTION 'activities table was not created';
  END IF;
  IF to_regclass('public.activity_registration_links') IS NULL THEN
    RAISE EXCEPTION 'activity_registration_links table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activities'
      AND policyname = 'activities_select_visible'
  ) THEN
    RAISE EXCEPTION 'activities visibility policy was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'join_activity_registration'
  ) THEN
    RAISE EXCEPTION 'registration join function was not created';
  END IF;
END;
$$;

INSERT INTO public.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

INSERT INTO public.activities (id, owner_id, title, status)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Test activity', 'published');

INSERT INTO public.activity_registration_links (activity_id, token_hash, max_uses, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  encode(extensions.digest('test-token-abcdefghijklmnopqrstuvwxyz', 'sha256'), 'hex'),
  2,
  '00000000-0000-0000-0000-000000000001'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SELECT * FROM public.join_activity_registration('test-token-abcdefghijklmnopqrstuvwxyz');
SELECT * FROM public.join_activity_registration('test-token-abcdefghijklmnopqrstuvwxyz');

DO $$
BEGIN
  IF (SELECT use_count FROM public.activity_registration_links) <> 1 THEN
    RAISE EXCEPTION 'joining twice must use one registration slot';
  END IF;
END;
$$;
