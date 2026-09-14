-- 055_recent_features_security.sql
-- Security hardening for LIFF scanner, trip/community, social, chat, and payments.

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
ALTER TABLE session_court_slots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_uploads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_itinerary_days      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_itinerary_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_settlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships              ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_invite_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests         ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_slots_org_member" ON session_court_slots
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = session_court_slots.split_bill_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = session_court_slots.split_bill_id
        AND om.user_id = auth.uid()
    )
  );
CREATE POLICY "scan_uploads_owner_or_org" ON scan_uploads
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "trip_days_org_member" ON trip_itinerary_days
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = trip_itinerary_days.split_bill_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = trip_itinerary_days.split_bill_id
        AND om.user_id = auth.uid()
    )
  );
CREATE POLICY "trip_items_org_member" ON trip_itinerary_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM trip_itinerary_days d
      JOIN split_bills b ON b.id = d.split_bill_id
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE d.id = trip_itinerary_items.day_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM trip_itinerary_days d
      JOIN split_bills b ON b.id = d.split_bill_id
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE d.id = trip_itinerary_items.day_id
        AND om.user_id = auth.uid()
    )
  );
CREATE POLICY "trip_settlements_org_member" ON trip_settlements
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = trip_settlements.split_bill_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM split_bills b
      JOIN organization_members om ON om.organization_id = b.organization_id
      WHERE b.id = trip_settlements.split_bill_id
        AND om.user_id = auth.uid()
    )
  );
CREATE POLICY "community_groups_org_member" ON community_groups
  FOR SELECT TO authenticated
  USING (
    creator_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "community_groups_creator_write" ON community_groups
  FOR ALL TO authenticated
  USING (creator_id = auth.uid())
  WITH CHECK (
    creator_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "community_members_visible_to_group" ON community_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM community_groups g
      WHERE g.id = community_members.group_id
        AND (
          g.creator_id = auth.uid()
          OR g.organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY "community_members_self_write" ON community_members
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "friendships_participant" ON friendships
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "friendships_requester_insert" ON friendships
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());
CREATE POLICY "friendships_participant_update" ON friendships
  FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid())
  WITH CHECK (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "friendships_participant_delete" ON friendships
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "friend_invites_owner" ON friend_invite_links
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "conversations_member_read" ON conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(id));
CREATE POLICY "conversations_creator_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "conversations_admin_update" ON conversations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversations.id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );
CREATE POLICY "conversation_members_member_read" ON conversation_members
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id));
CREATE POLICY "conversation_members_self_update" ON conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "messages_member_read" ON messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id));
CREATE POLICY "messages_member_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id)
  );
CREATE POLICY "payment_requests_participant" ON payment_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR payer_id = auth.uid());
CREATE POLICY "payment_requests_requester_insert" ON payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND (
      organization_id IS NULL
      OR organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  );
CREATE POLICY "payment_requests_participant_update" ON payment_requests
  FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR payer_id = auth.uid())
  WITH CHECK (requester_id = auth.uid() OR payer_id = auth.uid());
ALTER TABLE payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_amount_positive;
ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_amount_positive CHECK (amount > 0);
ALTER TABLE trip_settlements
  DROP CONSTRAINT IF EXISTS trip_settlements_amount_positive;
ALTER TABLE trip_settlements
  ADD CONSTRAINT trip_settlements_amount_positive CHECK (amount > 0);
ALTER TABLE trip_settlements
  DROP CONSTRAINT IF EXISTS trip_settlements_distinct_participants;
ALTER TABLE trip_settlements
  ADD CONSTRAINT trip_settlements_distinct_participants
  CHECK (from_participant_id <> to_participant_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
