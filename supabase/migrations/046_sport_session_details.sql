-- ─────────────────────────────────────────────────────────────────────────────
-- 046_sport_session_details.sql
-- Splits "core club info" (sport_groups) from "per-session info" (split_bills):
--   - sport_groups.concept_text  — club concept/rules, set once, rarely changes
--   - split_bills.extra_notes    — free-text per-session extras (shuttlecock
--                                   brand, prizes, special rules for that day)
--   - session_court_slots        — multiple time/court-count slots per session
--                                   (e.g. "19:00 เปิด 1 สนาม, 20:00 เปิด 3 สนาม")
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sport_groups
  ADD COLUMN IF NOT EXISTS concept_text text;
ALTER TABLE split_bills
  ADD COLUMN IF NOT EXISTS extra_notes text;
CREATE TABLE IF NOT EXISTS session_court_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_bill_id uuid NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  start_time    time NOT NULL,
  court_count   integer NOT NULL CHECK (court_count > 0),
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_court_slots_bill ON session_court_slots(split_bill_id);
