-- ─────────────────────────────────────────────────────────────────────────────
-- 045_split_participant_picture.sql
-- Cache each LINE participant's profile picture URL so sport invite/roster
-- cards can show avatars instead of plain text names.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE split_participants
  ADD COLUMN IF NOT EXISTS line_picture_url text;
