-- Atomically create the trip, host membership and exactly-one group chat.
-- Native clients call this instead of issuing several independent inserts.

ALTER TABLE public.life_journeys
  ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_trip_full(
  p_organization_id uuid,
  p_title text,
  p_trip_type text DEFAULT 'travel',
  p_started_at timestamptz DEFAULT NULL,
  p_ended_at timestamptz DEFAULT NULL,
  p_destination text DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_base_currency text DEFAULT 'THB',
  p_timezone text DEFAULT 'Asia/Bangkok'
)
RETURNS TABLE(journey_id uuid, conversation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_journey_id uuid;
  v_conversation_id uuid;
  v_display_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_organization_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'Organization membership required'; END IF;
  IF btrim(coalesce(p_title, '')) = '' THEN RAISE EXCEPTION 'Trip title required'; END IF;
  IF p_ended_at IS NOT NULL AND p_started_at IS NOT NULL AND p_ended_at < p_started_at THEN
    RAISE EXCEPTION 'End date must not precede start date';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'Host')
    INTO v_display_name FROM users WHERE id = v_user_id;

  INSERT INTO life_journeys (
    organization_id, user_id, creator_id, title, trip_type, journey_type,
    started_at, ended_at, destination, venue, event_date, notes,
    base_currency, status, metadata
  ) VALUES (
    p_organization_id, v_user_id, v_user_id, btrim(p_title), p_trip_type, 'trip',
    p_started_at, p_ended_at, nullif(btrim(p_destination), ''), nullif(btrim(p_venue), ''),
    p_started_at::date, nullif(btrim(p_notes), ''), upper(p_base_currency), 'active',
    jsonb_build_object('timezone', p_timezone)
  ) RETURNING id INTO v_journey_id;

  INSERT INTO trip_participants (
    journey_id, user_id, display_name, is_host, amount_owed, amount_paid
  ) VALUES (v_journey_id, v_user_id, coalesce(v_display_name, 'Host'), true, 0, 0);

  INSERT INTO conversations (type, name, created_by, journey_id)
  VALUES ('group', btrim(p_title), v_user_id, v_journey_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES (v_conversation_id, v_user_id, 'admin');

  INSERT INTO messages (conversation_id, sender_id, body, msg_type, meta)
  VALUES (
    v_conversation_id, NULL, 'สร้างทริปแล้ว', 'system',
    jsonb_build_object('event', 'trip_created', 'journey_id', v_journey_id)
  );

  RETURN QUERY SELECT v_journey_id, v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trip_full(uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip_full(uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) TO authenticated;
