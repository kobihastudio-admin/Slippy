-- Secure collaboration helpers for native clients. Table RLS stays narrow;
-- membership changes are validated and performed atomically here.

CREATE OR REPLACE FUNCTION public.ensure_trip_conversation(p_journey_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_conv uuid; v_title text;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM trip_participants WHERE journey_id = p_journey_id AND user_id = v_user AND left_at IS NULL
  ) THEN RAISE EXCEPTION 'Active trip membership required'; END IF;
  SELECT id INTO v_conv FROM conversations WHERE journey_id = p_journey_id;
  IF v_conv IS NULL THEN
    SELECT title INTO v_title FROM life_journeys WHERE id = p_journey_id;
    INSERT INTO conversations(type, name, created_by, journey_id)
      VALUES ('group', v_title, v_user, p_journey_id) RETURNING id INTO v_conv;
  END IF;
  INSERT INTO conversation_members(conversation_id, user_id, role)
    VALUES (v_conv, v_user, 'member') ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN v_conv;
END; $$;

CREATE OR REPLACE FUNCTION public.add_friend_to_trip(p_journey_id uuid, p_friend_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_conv uuid; v_participant uuid; v_name text;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM trip_participants WHERE journey_id = p_journey_id AND user_id = v_user AND is_host AND left_at IS NULL
  ) THEN RAISE EXCEPTION 'Trip host required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM friendships WHERE status = 'accepted' AND
      ((requester_id = v_user AND addressee_id = p_friend_id) OR (requester_id = p_friend_id AND addressee_id = v_user))
  ) THEN RAISE EXCEPTION 'Accepted friendship required'; END IF;
  SELECT coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'Traveler') INTO v_name FROM users WHERE id = p_friend_id;
  INSERT INTO trip_participants(journey_id, user_id, display_name, is_host, amount_owed, amount_paid)
    VALUES (p_journey_id, p_friend_id, v_name, false, 0, 0)
    ON CONFLICT (journey_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET left_at = NULL, display_name = excluded.display_name
    RETURNING id INTO v_participant;
  v_conv := ensure_trip_conversation(p_journey_id);
  INSERT INTO conversation_members(conversation_id, user_id, role)
    VALUES (v_conv, p_friend_id, 'member') ON CONFLICT DO NOTHING;
  INSERT INTO messages(conversation_id, sender_id, body, msg_type, meta)
    VALUES (v_conv, NULL, v_name || ' เข้าร่วมทริป', 'system', jsonb_build_object('event','member_joined','user_id',p_friend_id));
  RETURN v_participant;
END; $$;

REVOKE ALL ON FUNCTION public.ensure_trip_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_friend_to_trip(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_trip_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_friend_to_trip(uuid,uuid) TO authenticated;
