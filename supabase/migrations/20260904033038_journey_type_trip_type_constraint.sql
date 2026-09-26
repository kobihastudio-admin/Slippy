-- trip_type is only meaningful when journey_type='trip'; enforce at the DB
-- level now that both the create_trip_full RPC and the trips API route
-- agree on this convention.
ALTER TABLE life_journeys
  ADD CONSTRAINT life_journeys_trip_type_requires_trip_journey
  CHECK (trip_type = 'general' OR journey_type = 'trip');
