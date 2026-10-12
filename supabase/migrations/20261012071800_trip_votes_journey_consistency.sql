-- Follow-up to 20261012070714 (security review): a vote's candidate and participant must belong to the
-- same trip as the vote's journey_id (which the RLS check is based on), and an identity tag's
-- participant must belong to the tag's trip. Votes may be cast by any participant on behalf of
-- members without an account (by design), so ownership of a vote is deliberately not enforced.
--
-- Applied to production on 2026-10-12 (remote ledger version 20261012071800); this file mirrors it.

ALTER TABLE public.trip_place_candidates
  ADD CONSTRAINT trip_place_candidates_id_journey_uniq UNIQUE (id, journey_id);
ALTER TABLE public.trip_participants
  ADD CONSTRAINT trip_participants_id_journey_uniq UNIQUE (id, journey_id);

ALTER TABLE public.trip_place_votes
  ADD CONSTRAINT trip_place_votes_candidate_journey_fkey
    FOREIGN KEY (candidate_id, journey_id) REFERENCES public.trip_place_candidates (id, journey_id) ON DELETE CASCADE,
  ADD CONSTRAINT trip_place_votes_participant_journey_fkey
    FOREIGN KEY (participant_id, journey_id) REFERENCES public.trip_participants (id, journey_id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.trip_identity_tags_same_trip()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.trip_participants p WHERE p.id = NEW.participant_id AND p.journey_id = NEW.journey_id
  ) THEN
    RAISE EXCEPTION 'participant % does not belong to trip %', NEW.participant_id, NEW.journey_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_identity_tags_same_trip ON public.trip_identity_tags;
CREATE TRIGGER trip_identity_tags_same_trip BEFORE INSERT OR UPDATE ON public.trip_identity_tags
  FOR EACH ROW EXECUTE FUNCTION public.trip_identity_tags_same_trip();
