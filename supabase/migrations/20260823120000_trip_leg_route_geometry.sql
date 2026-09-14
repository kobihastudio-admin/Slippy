-- ═══════════════════════════════════════════════════════════════════════════
-- 20260823120000_trip_leg_route_geometry.sql
--
-- Somewhere to keep the actual path a leg takes.
--
-- Until now a transport leg was drawn as a straight line from its departure
-- coordinate to its arrival one. For a flight or a ferry that is honest — there
-- is no road to follow. For a walk across Hiroshima or a drive to Onomichi it is
-- a lie of the useful-looking kind: it implies a path through buildings and
-- across water, and it under-states the distance by whatever the road actually
-- does.
--
-- WHY A COLUMN AND NOT A LOOKUP EVERY TIME
-- Routing is a network call to somebody else's service. Doing it on every render
-- would be slow, would break offline, and would hammer a provider for an answer
-- that does not change — the walk from Hiroshima Station to the Peace Park is
-- the same walk today as yesterday. So it is fetched once and kept.
--
-- WHY ONE JSONB AND NOT SEVERAL COLUMNS
-- The payload is only ever read as a whole (draw this line, label it with this
-- distance) and it carries the endpoints it was computed FOR, which is what
-- makes it invalidatable: move a pin, and the stored `from`/`to` no longer match
-- the row's coordinates, so the geometry is known to be stale without any
-- separate flag to keep in sync.
--
-- Shape:
--   {
--     "mode":        "foot" | "driving" | "direct",
--     "coordinates": [[lat, lng], ...],
--     "distance_m":  1234.5,
--     "duration_s":  900,
--     "from":        [lat, lng],     -- what it was computed for
--     "to":          [lat, lng],
--     "provider":    "osrm" | "geodesic",
--     "fetched_at":  "2026-08-23T..."
--   }
--
-- `provider: "geodesic"` is not a failure — it is the right answer for a flight,
-- a ferry and a rail leg, none of which follow a road network. The map says
-- which it is drawing rather than presenting a straight line as a route.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE trip_itinerary_items
  ADD COLUMN IF NOT EXISTS route_geometry jsonb;

COMMENT ON COLUMN trip_itinerary_items.route_geometry IS
  'The drawn path for a transport leg, with the endpoints it was computed for so staleness is detectable. See 20260823120000_trip_leg_route_geometry.sql.';

-- Only legs have one, and only some of those. A partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_tii_has_route
  ON trip_itinerary_items ((route_geometry IS NOT NULL))
  WHERE route_geometry IS NOT NULL;
