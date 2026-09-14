-- 058: Guests added by a participant (e.g. via the public join-link "ลงชื่อให้
-- เพื่อนที่ไม่ได้อยู่ในกลุ่ม LINE" form) no longer carry their own tracked
-- amount — their share is folded into whoever added them, and they're
-- displayed nested under that person (tree) instead of as a flat row.

ALTER TABLE split_participants
  ADD COLUMN IF NOT EXISTS added_by_participant_id uuid
    REFERENCES split_participants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_split_parts_added_by ON split_participants(added_by_participant_id);
