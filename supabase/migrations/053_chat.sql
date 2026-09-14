-- 053: Chat — conversations + messages
CREATE TABLE IF NOT EXISTS conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL DEFAULT 'direct'
    CHECK (type IN ('direct','group')),
  name         text,
  avatar_url   text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_read_at    timestamptz DEFAULT now(),
  joined_at       timestamptz DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON conversation_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text,
  attachment_url  text,
  msg_type        text NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text','image','payment_request','slip','system')),
  meta            jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at DESC);
ALTER TABLE messages REPLICA IDENTITY FULL;
