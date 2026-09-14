-- 052: Friend graph + phone on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio   text;
CREATE TABLE IF NOT EXISTS friendships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','blocked')),
  source        text NOT NULL DEFAULT 'search'
    CHECK (source IN ('line_mutual','qr_scan','search','split_activity','trip_activity')),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendship_addr ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendship_req  ON friendships(requester_id, status);
CREATE TABLE IF NOT EXISTS friend_invite_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  expires_at timestamptz DEFAULT now() + interval '7 days',
  used_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invite_token ON friend_invite_links(token);
