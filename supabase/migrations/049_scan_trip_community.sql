-- ─── 049: Document Scanner + Trip Itinerary + Community Groups ─────────────
-- scan_uploads: store LIFF scan sessions; trip tables: itinerary + settlements;
-- community_groups + members; extend split_bills for debt simplification.

-- 1. scan_uploads
CREATE TABLE IF NOT EXISTS scan_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_user_id    text,
  receipt_url     text,
  ocr_result      jsonb,
  linked_doc_id   uuid REFERENCES documents(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ocr_done','linked','dismissed')),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_org ON scan_uploads(organization_id, created_at DESC);
-- 2. trip_itinerary_days
CREATE TABLE IF NOT EXISTS trip_itinerary_days (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  day_number    int  NOT NULL,
  date          date,
  title         text,
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_day_uniq ON trip_itinerary_days(split_bill_id, day_number);
-- 3. trip_itinerary_items
CREATE TABLE IF NOT EXISTS trip_itinerary_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id      uuid NOT NULL REFERENCES trip_itinerary_days(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  type        text DEFAULT 'activity'
    CHECK (type IN ('activity','meal','transport','hotel','booking','other')),
  title       text NOT NULL,
  location    text,
  notes       text,
  amount      numeric(14,2) DEFAULT 0,
  time_from   time,
  time_to     time,
  image_url   text,
  booking_ref text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_items_day ON trip_itinerary_items(day_id, sort_order);
-- 4. trip_settlements
CREATE TABLE IF NOT EXISTS trip_settlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id       uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  from_participant_id uuid NOT NULL REFERENCES split_participants(id) ON DELETE CASCADE,
  to_participant_id   uuid NOT NULL REFERENCES split_participants(id) ON DELETE CASCADE,
  amount              numeric(14,2) NOT NULL,
  settled             bool NOT NULL DEFAULT false,
  settled_at          timestamptz,
  created_at          timestamptz DEFAULT now()
);
-- 5. community_groups
CREATE TABLE IF NOT EXISTS community_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_group_id   text,
  share_token     text UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  name            text NOT NULL,
  description     text,
  type            text NOT NULL DEFAULT 'general'
    CHECK (type IN ('home','savings','event','community','coop','general')),
  emoji           text DEFAULT '👥',
  status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  settings        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cgroup_org ON community_groups(organization_id);
-- 6. community_members
CREATE TABLE IF NOT EXISTS community_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  line_user_id text,
  display_name text,
  role         text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin','member','viewer')),
  joined_at    timestamptz DEFAULT now(),
  UNIQUE(group_id, line_user_id)
);
CREATE INDEX IF NOT EXISTS idx_cmember_group ON community_members(group_id);
-- 7. Extend split_bills for debt simplification + recurring + split mode
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS debt_simplified   bool DEFAULT false;
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS recurring_template_id uuid;
ALTER TABLE split_bills ADD COLUMN IF NOT EXISTS split_mode text DEFAULT 'equal'
  CHECK (split_mode IN ('equal','custom','percentage'));
