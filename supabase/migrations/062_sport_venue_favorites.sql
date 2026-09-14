-- ---------------------------------------------------------------------------
-- 062_sport_venue_favorites.sql
--
-- Org-shared list of saved sport venues, so teammates can pick a court/field
-- they've used before instead of re-searching MapKit every time they create
-- a sport group. Mirrors the sport_groups table's RLS pattern (migration 043).
-- ---------------------------------------------------------------------------

CREATE TABLE sport_venue_favorites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  address           text,
  map_url           text,
  latitude          double precision,
  longitude         double precision,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sport_venue_favorites_org
  ON sport_venue_favorites(organization_id, created_at DESC);
ALTER TABLE sport_venue_favorites ENABLE ROW LEVEL SECURITY;
-- All org members can see and add favorites — it's a shared team list.
CREATE POLICY "sport_venue_favorites_select" ON sport_venue_favorites FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "sport_venue_favorites_insert" ON sport_venue_favorites FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
-- Only the member who saved it can remove it (mirrors sport_groups_delete).
CREATE POLICY "sport_venue_favorites_delete" ON sport_venue_favorites FOR DELETE
  USING (created_by = auth.uid());
COMMENT ON TABLE sport_venue_favorites IS
  'Org-shared saved venues for sport groups — populated when a member saves
   a MapKit search result as a favorite from CreateSportGroupView (iOS).';
