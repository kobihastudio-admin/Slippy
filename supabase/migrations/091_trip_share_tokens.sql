-- Existing LIFF `/liff/trips/[token]` is the single invitation surface.
-- New journeys receive a token automatically. Existing journeys receive one
-- only when an active participant explicitly chooses to share that trip.

ALTER TABLE public.life_journeys
  ALTER COLUMN share_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE OR REPLACE FUNCTION public.ensure_trip_share_token(p_journey_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_token text;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1
    FROM trip_participants
    WHERE journey_id = p_journey_id
      AND user_id = v_user
      AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active trip membership required';
  END IF;

  UPDATE life_journeys
  SET share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', ''))
  WHERE id = p_journey_id
  RETURNING share_token INTO v_token;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_trip_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_trip_share_token(uuid) TO authenticated;
