-- The trip list is a lifestyle surface as well as a Life Graph source.  A
-- trip is therefore readable only by its owner or an active participant.
-- Non-trip life_journeys deliberately keep the original organisation-wide
-- behaviour: they are the shared Life Graph, not a private trip workspace.
--
-- `is_trip_participant` was introduced in 094 and is SECURITY DEFINER so the
-- policy can safely consult trip_participants without RLS recursion.

DROP POLICY IF EXISTS "life_journeys_member" ON public.life_journeys;

CREATE POLICY "life_journeys_life_graph_or_trip_participant"
ON public.life_journeys
FOR ALL TO authenticated
USING (
  (
    journey_type <> 'trip'
    AND organization_id IN (
      SELECT organization_id
      FROM public.organization_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    journey_type = 'trip'
    AND public.is_trip_participant(id)
  )
)
WITH CHECK (
  (
    journey_type <> 'trip'
    AND organization_id IN (
      SELECT organization_id
      FROM public.organization_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    journey_type = 'trip'
    AND public.is_trip_participant(id)
  )
);

COMMENT ON POLICY "life_journeys_life_graph_or_trip_participant" ON public.life_journeys IS
  'Life Graph journeys remain organization-visible. Trip journeys are private to their owner and active participants.';
