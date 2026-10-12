-- Defence in depth (security review): the app opens maps_url, and any participant of the trip can write it,
-- so only https Google Maps links are accepted.
--
-- Applied to production on 2026-10-12 (remote ledger version 20261012073623); this file mirrors it.
ALTER TABLE public.trip_place_candidates
  ADD CONSTRAINT trip_place_candidates_maps_url_check
  CHECK (maps_url IS NULL OR maps_url ~ '^https://(www\.google\.com/maps(/|\?)|maps\.google\.com/|maps\.app\.goo\.gl/|goo\.gl/maps/)');
