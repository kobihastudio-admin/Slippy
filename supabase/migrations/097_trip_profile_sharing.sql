-- Each member owns a separate journey profile. Profiles default to private;
-- the owner can explicitly share their avatar and role in the trip Crew area.
ALTER TABLE trip_participants
  ADD COLUMN IF NOT EXISTS profile_shared_with_trip boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN trip_participants.profile_shared_with_trip IS
  'Member consent to show their trip avatar and role to other active trip members.';
