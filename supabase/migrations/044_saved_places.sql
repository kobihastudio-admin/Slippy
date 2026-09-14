-- ── Migration 044: Saved Places ───────────────────────────────────────────────
-- Org-scoped list of places (sport venues, restaurants, etc.) added either by
-- pasting a Google Maps share link (resolved server-side) or manual entry.
-- Replaces the GPS/Google-nearby-search venue picker for /liff/sport & /liff/trip.

CREATE TABLE saved_places (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  category        text NOT NULL DEFAULT 'other',
  address         text,
  latitude        double precision,
  longitude       double precision,
  maps_url        text,
  photo_url       text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_saved_places_org ON saved_places(organization_id, created_at DESC);
ALTER TABLE saved_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_places_select" ON saved_places FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "saved_places_insert" ON saved_places FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "saved_places_delete" ON saved_places FOR DELETE
  USING (creator_id = auth.uid());
