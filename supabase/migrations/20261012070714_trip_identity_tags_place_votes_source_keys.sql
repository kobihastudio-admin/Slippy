-- CR-004: identity tags and place/restaurant votes become real tables (they were hard-coded or
-- kept in life_journeys.metadata JSON). CR-005: stable source keys so a Notion importer can be
-- re-run without duplicating rows. RLS follows the other trip tables: any participant of the trip.
--
-- Applied to production on 2026-10-12 (remote ledger version 20261012070714); this file mirrors it.

CREATE TABLE IF NOT EXISTS public.trip_identity_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id     uuid NOT NULL REFERENCES public.life_journeys(id) ON DELETE CASCADE,
  member_key     text NOT NULL,
  participant_id uuid REFERENCES public.trip_participants(id) ON DELETE SET NULL,
  name           text,
  animal         text,
  image_path     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, member_key)
);

CREATE TABLE IF NOT EXISTS public.trip_place_candidates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid NOT NULL REFERENCES public.life_journeys(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'place' CHECK (kind IN ('place', 'food', 'souvenir')),
  day_number    integer,
  title         text NOT NULL,
  note          text,
  maps_url      text,
  price_hint    text,
  needs_booking boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'wanted', 'chosen', 'dropped')),
  sort_order    integer NOT NULL DEFAULT 0,
  source_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trip_place_votes (
  candidate_id   uuid NOT NULL REFERENCES public.trip_place_candidates(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.trip_participants(id) ON DELETE CASCADE,
  journey_id     uuid NOT NULL REFERENCES public.life_journeys(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, participant_id)
);

CREATE INDEX IF NOT EXISTS trip_place_candidates_journey_idx ON public.trip_place_candidates (journey_id, kind, sort_order);
CREATE INDEX IF NOT EXISTS trip_place_votes_journey_idx ON public.trip_place_votes (journey_id);

-- source keys for the importer (nullable; unique only when set)
ALTER TABLE public.trip_itinerary_days  ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE public.trip_itinerary_items ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE public.trip_checklist_items ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE public.trip_notes           ADD COLUMN IF NOT EXISTS source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS trip_itinerary_days_source_uniq  ON public.trip_itinerary_days  (journey_id, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trip_itinerary_items_source_uniq ON public.trip_itinerary_items (day_id, source_id)     WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trip_checklist_items_source_uniq ON public.trip_checklist_items (journey_id, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trip_notes_source_uniq           ON public.trip_notes           (journey_id, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trip_place_candidates_source_uniq ON public.trip_place_candidates (journey_id, source_id) WHERE source_id IS NOT NULL;

-- updated_at maintenance (function already exists)
DROP TRIGGER IF EXISTS trip_identity_tags_updated_at ON public.trip_identity_tags;
CREATE TRIGGER trip_identity_tags_updated_at BEFORE UPDATE ON public.trip_identity_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trip_place_candidates_updated_at ON public.trip_place_candidates;
CREATE TRIGGER trip_place_candidates_updated_at BEFORE UPDATE ON public.trip_place_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS: same posture as trip_photos / trip_notes (participants of the trip)
ALTER TABLE public.trip_identity_tags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_place_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_place_votes      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_identity_tags_participant ON public.trip_identity_tags;
CREATE POLICY trip_identity_tags_participant ON public.trip_identity_tags FOR ALL
  USING (public.is_trip_participant(journey_id)) WITH CHECK (public.is_trip_participant(journey_id));
DROP POLICY IF EXISTS trip_place_candidates_participant ON public.trip_place_candidates;
CREATE POLICY trip_place_candidates_participant ON public.trip_place_candidates FOR ALL
  USING (public.is_trip_participant(journey_id)) WITH CHECK (public.is_trip_participant(journey_id));
DROP POLICY IF EXISTS trip_place_votes_participant ON public.trip_place_votes;
CREATE POLICY trip_place_votes_participant ON public.trip_place_votes FOR ALL
  USING (public.is_trip_participant(journey_id)) WITH CHECK (public.is_trip_participant(journey_id));

-- carry over identity tags edited before this migration (metadata.identity_tags), if any
INSERT INTO public.trip_identity_tags (journey_id, member_key, name, animal, image_path)
SELECT j.id, e.key, e.value->>'name', e.value->>'animal', e.value->>'image_path'
  FROM public.life_journeys j, LATERAL jsonb_each(j.metadata->'identity_tags') e
 WHERE jsonb_typeof(j.metadata->'identity_tags') = 'object'
ON CONFLICT (journey_id, member_key) DO NOTHING;
