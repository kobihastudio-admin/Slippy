\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.life_journeys (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id));
CREATE TABLE public.community_groups (id uuid PRIMARY KEY);
CREATE TABLE public.community_members (group_id uuid NOT NULL, user_id uuid);
CREATE TABLE public.trip_itinerary_days (id uuid PRIMARY KEY, journey_id uuid NOT NULL REFERENCES public.life_journeys(id));
CREATE TABLE public.trip_itinerary_items (
  id uuid PRIMARY KEY,
  day_id uuid NOT NULL REFERENCES public.trip_itinerary_days(id),
  title text NOT NULL,
  type text NOT NULL DEFAULT 'activity',
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'planned'
);

\i /workspace/supabase/migrations/20260903012138_activity_graph.sql

INSERT INTO public.users (id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.life_journeys (id, user_id) VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.trip_itinerary_days (id, journey_id) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010');
INSERT INTO public.trip_itinerary_items (id, day_id, title, location, starts_at, status)
VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'Kumamoto Castle', 'Kumamoto', '2026-11-21T09:00:00Z', 'confirmed');

\i /workspace/supabase/migrations/20260903053736_activity_trip_projection.sql

DO $$
DECLARE
  first_activity_id uuid;
BEGIN
  SELECT activity_id INTO first_activity_id FROM public.trip_itinerary_items
  WHERE id = '00000000-0000-0000-0000-000000000030';
  IF first_activity_id IS NULL THEN
    RAISE EXCEPTION 'itinerary item was not linked to an activity';
  END IF;
  IF (SELECT count(*) FROM public.activities WHERE trip_id = '00000000-0000-0000-0000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'projection must create exactly one activity';
  END IF;
END;
$$;

\i /workspace/supabase/migrations/20260903053736_activity_trip_projection.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.activities WHERE trip_id = '00000000-0000-0000-0000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'projection must be idempotent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_trip_reconciliation WHERE unlinked_item_count = 0) THEN
    RAISE EXCEPTION 'reconciliation view did not report a fully linked trip';
  END IF;
END;
$$;
