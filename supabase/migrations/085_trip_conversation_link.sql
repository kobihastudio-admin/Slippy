-- ═══════════════════════════════════════════════════════════════════════════
-- 085_trip_conversation_link.sql — Link a trip to its group conversation
--
-- Phase 1 of docs/SLIPPY_TRIP_FULL_LOOP_CLAUDE_HANDOFF.md. Acceptance criterion:
-- "A trip conversation is created exactly once."
--
-- Today nothing connects `life_journeys` to `conversations`, so there is no way
-- to ask "does this trip already have a chat?" — which means every call site has
-- to remember not to create a second one, and any concurrent request (two
-- members opening the trip at the same moment, a retried POST) creates a
-- duplicate that silently splits the conversation in half. A code-level guard
-- cannot fix that; only the database can.
--
-- Hence a nullable FK plus a UNIQUE index. Uniqueness is the actual guarantee:
-- the second concurrent insert fails on the constraint and the caller falls back
-- to reading the winner, so "exactly once" holds without a lock or a transaction
-- spanning services.
--
-- Deliberately NOT changed:
--   • RLS. Access to conversations/members/messages already flows through
--     `is_conversation_member()`, and that stays the only gate. Granting access
--     via trip participation instead would be strictly wider: `trip_participants`
--     is readable by ANY member of the owning org (policy `tp_org_member`), so
--     deriving chat access from it would hand every colleague a seat in every
--     trip's private conversation. Membership stays explicit rows in
--     `conversation_members`.
--   • `conversations.type`. A trip chat is an ordinary 'group', which the
--     existing type CHECK already allows; no new enum value to coordinate with
--     the web/iOS/LIFF clients.
--   • `messages`. `msg_type` already permits 'system' and `meta jsonb` is
--     already there, which is all structured trip system messages need.
--
-- Rollback: see the commented block at the bottom. Dropping the column is safe
-- and loses only the trip↔chat association; conversations, members and messages
-- are untouched.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS journey_id uuid REFERENCES life_journeys(id) ON DELETE CASCADE;

COMMENT ON COLUMN conversations.journey_id IS
  'Set when this conversation is a trip group chat (life_journeys.id). NULL for '
  'ordinary direct/group chats. Unique — one conversation per trip.';

-- Partial, so the many NULLs on ordinary conversations do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_journey_id_key
  ON conversations (journey_id)
  WHERE journey_id IS NOT NULL;

-- ── One participant row per Slippy account per trip ─────────────────────────
--
-- Acceptance criterion: "Reusing an invite cannot create duplicate membership."
-- `trip_participants` already guarantees that for LINE users, via
-- `trip_participants_journey_id_line_user_id_key` — but there is no equivalent
-- for `user_id`, so a Slippy friend accepting the same invite twice (a
-- double-tap, a replayed link) becomes two participants. That is not cosmetic:
-- expense splitting counts participant rows, so the duplicate silently changes
-- everyone's share of every bill.
--
-- Partial, because `user_id` is legitimately NULL for LINE-only and non-LINE
-- participants and those must still be allowed in any number.
-- Verified empty before adding (0 rows), so this cannot fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS trip_participants_journey_user_key
  ON trip_participants (journey_id, user_id)
  WHERE user_id IS NOT NULL;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS trip_participants_journey_user_key;
-- DROP INDEX IF EXISTS conversations_journey_id_key;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS journey_id;
