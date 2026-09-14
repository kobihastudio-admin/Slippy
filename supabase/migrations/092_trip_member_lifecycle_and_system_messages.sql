-- 086 — Preserve expense history when somebody leaves a trip, and allow
-- automated system messages without inventing a fake sender account.

ALTER TABLE trip_participants
  ADD COLUMN IF NOT EXISTS left_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_trip_participants_active
  ON trip_participants (journey_id, user_id)
  WHERE left_at IS NULL;

COMMENT ON COLUMN trip_participants.left_at IS
  'Set when access to the trip is revoked. The row remains because expenses, splits and payments reference it.';

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_required;
ALTER TABLE messages ADD CONSTRAINT messages_sender_required CHECK (
  msg_type = 'system' OR sender_id IS NOT NULL
);

COMMENT ON CONSTRAINT messages_sender_required ON messages IS
  'Only structured system events may omit a human sender.';

-- Rollback (only after confirming no departed participants or sender-less
-- system messages exist):
-- DROP INDEX IF EXISTS idx_trip_participants_active;
-- ALTER TABLE trip_participants DROP COLUMN IF EXISTS left_at;
-- ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_required;
-- ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;
