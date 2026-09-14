-- A trip-scoped identity is separate from the account profile: it lets a
-- traveller choose an appropriate avatar, role and emergency contact for one
-- journey without overwriting their global Slippy profile.
ALTER TABLE trip_participants
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS trip_role text,
  ADD COLUMN IF NOT EXISTS emergency_contact text;

COMMENT ON COLUMN trip_participants.avatar_url IS 'Optional photo shown only in this journey.';
COMMENT ON COLUMN trip_participants.trip_role IS 'Traveller-selected role in this journey.';
COMMENT ON COLUMN trip_participants.emergency_contact IS 'Optional trip-only emergency contact.';
