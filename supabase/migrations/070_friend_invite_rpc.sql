-- ═══════════════════════════════════════════════════════════════════════════
-- 070_friend_invite_rpc.sql
-- QR-code "add friend" flow needs a way for the SCANNING user to redeem
-- someone else's invite token. `friend_invite_links` RLS (055) restricts all
-- access to `user_id = auth.uid()` (the link owner) — correct for the web
-- flow, which redeems tokens via the service-role admin client in a Next.js
-- route (web/src/app/friends/join/[token]/page.tsx), but native clients
-- (iOS) have no service-role key to bypass RLS with. This adds a narrow
-- SECURITY DEFINER RPC that does exactly what that page does — resolve
-- token → owner, upsert the friendship, bump used_count — without exposing
-- raw row access to other users' invite links.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.accept_friend_invite(p_token text)
RETURNS TABLE (owner_id uuid, owner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link friend_invite_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM friend_invite_links WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_link.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_link.user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_add_self';
  END IF;

  INSERT INTO friendships (requester_id, addressee_id, status, source)
  VALUES (auth.uid(), v_link.user_id, 'accepted', 'qr_scan')
  ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted';

  UPDATE friend_invite_links SET used_count = used_count + 1 WHERE token = p_token;

  RETURN QUERY
    SELECT v_link.user_id, u.full_name FROM users u WHERE u.id = v_link.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_friend_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_friend_invite(text) TO authenticated;
