-- ═══════════════════════════════════════════════════════════════════════════
-- 032_location_suggestions.sql — Location-Based Suggestions
-- Adds coordinates to merchants/journeys + spatial search functions
-- Supports: ร้านอาหาร, ร้านยา, โรงแรม, ท่องเที่ยว, คาเฟ่ etc.
-- ═══════════════════════════════════════════════════════════════════════════

-- PostGIS (usually pre-enabled in Supabase — IF NOT EXISTS handles gracefully)
CREATE EXTENSION IF NOT EXISTS postgis;
-- ─── Extend life_merchants with location + place data ─────────────────────────
ALTER TABLE life_merchants
  ADD COLUMN IF NOT EXISTS latitude        double precision,
  ADD COLUMN IF NOT EXISTS longitude       double precision,
  ADD COLUMN IF NOT EXISTS place_type      text DEFAULT 'establishment',
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS rating          numeric(3,2),
  ADD COLUMN IF NOT EXISTS user_ratings_total int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone_number    text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS opening_hours   jsonb,
  ADD COLUMN IF NOT EXISTS photo_url       text,
  ADD COLUMN IF NOT EXISTS price_level     int CHECK (price_level BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS geocoded_at     timestamptz;
-- Unique constraint on google_place_id (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'life_merchants_google_place_id_key') THEN
    ALTER TABLE life_merchants ADD CONSTRAINT life_merchants_google_place_id_key UNIQUE (google_place_id);
  END IF;
END $$;
-- Spatial index for fast nearby queries
-- Spatial GIST index (add manually after enabling PostGIS extension in Supabase Dashboard)

-- Regular index for bounding box pre-filter
CREATE INDEX IF NOT EXISTS idx_lm_latlon ON life_merchants(latitude, longitude)
  WHERE latitude IS NOT NULL;
-- ─── Extend life_journeys with coordinates ────────────────────────────────────
ALTER TABLE life_journeys
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
-- ─── Place cache (Google Maps results stored to reduce API calls) ─────────────
CREATE TABLE IF NOT EXISTS place_cache (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id text    NOT NULL UNIQUE,
  name            text    NOT NULL,
  place_type      text,                         -- restaurant|pharmacy|hotel|etc
  address         text,
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  rating          numeric(3,2),
  user_ratings_total int DEFAULT 0,
  phone_number    text,
  website         text,
  opening_hours   jsonb,
  photo_url       text,
  price_level     int,
  cached_at       timestamptz DEFAULT now(),
  expires_at      timestamptz DEFAULT now() + interval '7 days'  -- refresh weekly
);
CREATE INDEX IF NOT EXISTS idx_pc_location ON place_cache
  USING GIST(ST_GeogFromText('SRID=4326;POINT(' || longitude || ' ' || latitude || ')'));
CREATE INDEX IF NOT EXISTS idx_pc_type ON place_cache(place_type);
-- ─── Location search history (for AI learning) ────────────────────────────────
CREATE TABLE IF NOT EXISTS location_searches (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid    REFERENCES organizations(id) ON DELETE SET NULL,
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  place_type      text,
  query           text,
  result_count    int DEFAULT 0,
  source          text DEFAULT 'google' CHECK (source IN ('internal','google','both')),
  searched_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ls_user ON location_searches(user_id, searched_at DESC);
-- ─── Nearby merchants function (Haversine — works without full PostGIS) ────────
CREATE OR REPLACE FUNCTION find_nearby_merchants(
  p_org_id uuid, p_lat double precision, p_lng double precision,
  p_radius_km double precision DEFAULT 1.0, p_type text DEFAULT NULL, p_limit int DEFAULT 10
) RETURNS TABLE (
  id uuid, name text, category text, place_type text, address text,
  latitude double precision, longitude double precision,
  visit_count int, total_spent numeric, rating numeric, photo_url text,
  distance_km double precision, is_internal bool
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT sub.id, sub.name, sub.category, sub.place_type, sub.address,
    sub.latitude, sub.longitude, sub.visit_count, sub.total_spent,
    sub.rating, sub.photo_url, sub.dist, true
  FROM (
    SELECT m.id, m.name, m.category, m.place_type, m.address,
      m.latitude, m.longitude, m.visit_count, m.total_spent, m.rating, m.photo_url,
      6371.0 * 2 * asin(sqrt(
        power(sin(radians((m.latitude - p_lat) / 2)), 2) +
        cos(radians(p_lat)) * cos(radians(m.latitude)) *
        power(sin(radians((m.longitude - p_lng) / 2)), 2)
      )) AS dist
    FROM life_merchants m
    WHERE m.organization_id = p_org_id
      AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
      AND (p_type IS NULL OR m.place_type = p_type OR m.category ILIKE '%' || p_type || '%')
      AND m.latitude  BETWEEN p_lat - (p_radius_km/111.0) AND p_lat + (p_radius_km/111.0)
      AND m.longitude BETWEEN p_lng - (p_radius_km/(111.0*cos(radians(p_lat)))) AND p_lng + (p_radius_km/(111.0*cos(radians(p_lat))))
  ) sub
  WHERE sub.dist <= p_radius_km
  ORDER BY sub.dist LIMIT p_limit;
END; $$;
-- ─── Nearby from cache (Google results already fetched) ───────────────────────
CREATE OR REPLACE FUNCTION find_nearby_cached(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision DEFAULT 1.0,
  p_type      text DEFAULT NULL,
  p_limit     int  DEFAULT 10
)
RETURNS TABLE (
  google_place_id text,
  name           text,
  place_type     text,
  address        text,
  latitude       double precision,
  longitude      double precision,
  rating         numeric,
  user_ratings_total int,
  photo_url      text,
  price_level    int,
  distance_km    double precision
) LANGUAGE sql STABLE AS $$
  SELECT sub.google_place_id, sub.name, sub.place_type, sub.address,
    sub.latitude, sub.longitude, sub.rating, sub.user_ratings_total,
    sub.photo_url, sub.price_level, sub.dist
  FROM (
    SELECT c.google_place_id, c.name, c.place_type, c.address,
      c.latitude, c.longitude, c.rating, c.user_ratings_total, c.photo_url, c.price_level,
      6371.0 * 2 * asin(sqrt(
        power(sin(radians((c.latitude - p_lat)/2)),2) +
        cos(radians(p_lat))*cos(radians(c.latitude))*power(sin(radians((c.longitude-p_lng)/2)),2)
      )) AS dist
    FROM place_cache c
    WHERE c.expires_at > now()
      AND (p_type IS NULL OR c.place_type = p_type)
      AND c.latitude  BETWEEN p_lat-(p_radius_km/111.0) AND p_lat+(p_radius_km/111.0)
      AND c.longitude BETWEEN p_lng-(p_radius_km/(111.0*cos(radians(p_lat)))) AND p_lng+(p_radius_km/(111.0*cos(radians(p_lat))))
  ) sub WHERE sub.dist <= p_radius_km ORDER BY sub.dist LIMIT p_limit;
$$;
-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE place_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_searches  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pc_public_read"  ON place_cache        FOR SELECT USING (true);
CREATE POLICY "ls_own"          ON location_searches   FOR ALL USING (user_id = auth.uid());
