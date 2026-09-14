-- Activity Graph foundation. Additive only: legacy trip resources remain
-- authoritative and are linked through activity_resources when appropriate.

CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES public.life_journeys(id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.community_groups(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'group', 'public')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  location_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'imported', 'line', 'partner', 'calendar')),
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS activities_owner_idx ON public.activities(owner_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS activities_trip_idx ON public.activities(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_group_idx ON public.activities(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_explore_idx ON public.activities(starts_at ASC)
  WHERE visibility = 'public' AND status = 'published';

CREATE TABLE IF NOT EXISTS public.activity_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_name text,
  sort_order integer NOT NULL DEFAULT 0,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS activity_occurrences_activity_idx
  ON public.activity_occurrences(activity_id, starts_at, sort_order);

CREATE TABLE IF NOT EXISTS public.activity_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  invited_email text,
  invited_line_user_id text,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'organizer', 'member', 'guest')),
  rsvp_status text NOT NULL DEFAULT 'going'
    CHECK (rsvp_status IN ('invited', 'going', 'interested', 'declined', 'waitlisted')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL OR invited_line_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_participants_user_uniq
  ON public.activity_participants(activity_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_participants_activity_idx
  ON public.activity_participants(activity_id, rsvp_status);

CREATE TABLE IF NOT EXISTS public.activity_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN (
    'document', 'note', 'album', 'file', 'voice', 'link', 'calendar_event', 'line_message'
  )),
  resource_role text NOT NULL DEFAULT 'reference'
    CHECK (resource_role IN ('reference', 'document', 'attachment', 'gallery', 'registration')),
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(activity_id, resource_id, resource_type)
);
CREATE INDEX IF NOT EXISTS activity_resources_activity_idx
  ON public.activity_resources(activity_id, sort_order);

CREATE TABLE IF NOT EXISTS public.activity_registration_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  invited_email text,
  invited_line_user_id text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_registration_links_activity_idx
  ON public.activity_registration_links(activity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.activity_interests (
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('saved', 'interested', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

-- Security-definer helpers avoid recursive participant/group RLS checks.
CREATE OR REPLACE FUNCTION public.can_view_activity(p_activity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
    WHERE a.id = p_activity_id
      AND (
        a.owner_id = auth.uid()
        OR (a.visibility = 'public' AND a.status = 'published')
        OR EXISTS (
          SELECT 1 FROM activity_participants ap
          WHERE ap.activity_id = a.id AND ap.user_id = auth.uid()
        )
        OR (
          a.visibility = 'group' AND EXISTS (
            SELECT 1 FROM community_members cm
            WHERE cm.group_id = a.group_id AND cm.user_id = auth.uid()
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_activity(p_activity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
    WHERE a.id = p_activity_id AND a.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM activity_participants ap
    WHERE ap.activity_id = p_activity_id
      AND ap.user_id = auth.uid()
      AND ap.role IN ('owner', 'organizer')
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_activity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_activity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_activity(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_activity(uuid) TO authenticated;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_registration_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_select_visible ON public.activities FOR SELECT
  USING (public.can_view_activity(id));
CREATE POLICY activities_insert_owner ON public.activities FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY activities_update_manager ON public.activities FOR UPDATE TO authenticated
  USING (public.can_manage_activity(id)) WITH CHECK (public.can_manage_activity(id));
CREATE POLICY activities_delete_owner ON public.activities FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY occurrences_select_visible ON public.activity_occurrences FOR SELECT
  USING (public.can_view_activity(activity_id));
CREATE POLICY occurrences_manage ON public.activity_occurrences FOR ALL TO authenticated
  USING (public.can_manage_activity(activity_id)) WITH CHECK (public.can_manage_activity(activity_id));

CREATE POLICY participants_select_visible ON public.activity_participants FOR SELECT
  USING (public.can_view_activity(activity_id));
CREATE POLICY participants_manage ON public.activity_participants FOR ALL TO authenticated
  USING (public.can_manage_activity(activity_id)) WITH CHECK (public.can_manage_activity(activity_id));

CREATE POLICY resources_select_visible ON public.activity_resources FOR SELECT
  USING (public.can_view_activity(activity_id));
CREATE POLICY resources_manage ON public.activity_resources FOR ALL TO authenticated
  USING (public.can_manage_activity(activity_id)) WITH CHECK (public.can_manage_activity(activity_id));

CREATE POLICY registration_links_manage ON public.activity_registration_links FOR ALL TO authenticated
  USING (public.can_manage_activity(activity_id)) WITH CHECK (public.can_manage_activity(activity_id));
CREATE POLICY interests_self ON public.activity_interests FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- A token is accepted only for a signed-in user and is never returned or stored
-- in plaintext. The row lock makes capacity checks and use_count increments atomic.
CREATE OR REPLACE FUNCTION public.join_activity_registration(p_raw_token text)
RETURNS TABLE(activity_id uuid, participant_id uuid, joined boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_link public.activity_registration_links%ROWTYPE;
  v_participant_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_raw_token IS NULL OR char_length(p_raw_token) < 24 THEN
    RETURN;
  END IF;

  SELECT * INTO v_link
  FROM public.activity_registration_links
  WHERE token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND OR v_link.revoked_at IS NOT NULL
    OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
    OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RETURN;
  END IF;

  INSERT INTO public.activity_participants (activity_id, user_id, role, rsvp_status)
  VALUES (v_link.activity_id, auth.uid(), 'member', 'going')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_participant_id;

  IF v_participant_id IS NULL THEN
    SELECT ap.id INTO v_participant_id
    FROM public.activity_participants ap
    WHERE ap.activity_id = v_link.activity_id AND ap.user_id = auth.uid();

    RETURN QUERY SELECT v_link.activity_id, v_participant_id, false;
    RETURN;
  END IF;

  UPDATE public.activity_registration_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  RETURN QUERY SELECT v_link.activity_id, v_participant_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.join_activity_registration(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_activity_registration(text) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_occurrences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_registration_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_interests TO authenticated;
