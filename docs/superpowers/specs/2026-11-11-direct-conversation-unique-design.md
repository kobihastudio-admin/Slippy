# One direct room per pair: a database-level unique key

Status: migration APPLIED 2026-11-11 to the hosted project (version 20261111024912) with the user's explicit approval; verified read-only from the catalog afterwards. Approach A approved by the user on 2026-11-11. NOT yet committed or deployed: each needs its own approval, and the web deploy that uses the column must come after this (done). Date: 2026-11-11 (Asia/Bangkok).
Traces to: independent review of the chat authorization repairs (2026-11-10), known gap "duplicate direct rooms from concurrent creates need a unique constraint"; D-077 (schema changes are separately gated).
Migration (applied): `supabase/migrations/20261111120000_direct_conversation_pair_key.sql`.
Tests: `supabase/tests/direct-pair-key-migration.test.mjs` (static shape checks) and `web/src/lib/chat-access.test.mjs` (helper, fake client).

## 1. Problem

Direct rooms are found with "my rooms, their rooms among mine, keep type=direct with exactly these two members", and created
when none is found. Two requests for the same pair that overlap (double tap, web and LINE together, `send-qr` and
`POST /api/conversations`) both find nothing and both create a room, so one pair ends up with two direct rooms and the
messages are split. The pair of a room is stored as two `conversation_members` rows, which a UNIQUE constraint cannot express.

Checked read-only on 2026-11-11 (counts only): 3 rooms, 1 direct, no pair with two direct rooms, no direct room with other than two members.

## 2. Change

- `conversations.direct_pair_key text` (nullable): `<smaller user id>:<larger user id>`, lower-case, plain code-unit order.
- CHECK: only direct rooms carry a key, in that exact shape.
- Partial UNIQUE index `conversations_direct_pair_key_key` on the key where `type = 'direct'` and the key is not null.
- Backfill of existing direct rooms with exactly two members (1 today).
- Trigger `conversations_guard_direct_pair_key`: a user's own JWT (`auth.uid()` not null) cannot set or change the key; the
  service role and SQL can. Without it any user could insert a room with the key of two other people and block their chat.
  The existing policies `conversations_creator_insert` / `conversations_admin_update` are unchanged.
- Code: one helper, `getOrCreateDirectConversation` in `web/src/lib/chat-access.ts`, used by `POST /api/conversations` and
  `liff/split-groups/[id]/send-qr` (it replaces two copies of the lookup/create code). It looks the room up (failing closed),
  creates it with the key, and on a unique violation (23505) uses the room that won, found by its key.

## 3. Writers of direct rooms

| Writer | Role | Effect |
|---|---|---|
| Web `POST /api/conversations` (direct) | admin | uses the helper: sets the key, race-safe |
| `liff/split-groups/[id]/send-qr` | admin | uses the helper: sets the key, race-safe |
| iOS `MessagesViewModel.getOrCreateDirectConversation` | user JWT | cannot set the key (trigger); inserts without it, so it is not covered, as before |
| `lib/trips/trip-conversation.ts`, trip RPCs | admin / SQL | group rooms, no key |

Side effect of the helper: `POST /api/conversations` used to ignore errors in its lookup and then create a room; a failed
lookup now answers 500 and creates nothing.

## 4. Risks and limits

- The constraint only covers writers that set the key. A future writer that forgets is not covered; use the helper.
- iOS is not covered. Separately (not part of this change), `conversation_members` has no INSERT policy, so the iOS flow of
  adding both members with the user's JWT appears to be refused by RLS; that is its own work item.
- A loser of a race gets the winner's room id while the winner may still be adding its members. Callers that only write rows
  keyed by the room id (payment request, message) are fine; if the winner then fails to add members it deletes the room and the
  loser's next write fails with a foreign-key error (the caller answers 500).
- Rooms created before this change keep a null key unless backfilled; only the 1 existing direct room was.
- `CREATE UNIQUE INDEX` fails, rolling the whole migration back, if a duplicate pair exists when it runs.
- Not proven by the static test: the SQL itself (no Postgres here). To be verified read-only from the catalog after applying, then
  with two test accounts: two simultaneous "open chat" calls return the same room id.

## 5. Verification after applying (read-only, catalog and counts only)

```sql
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema='public' and table_name='conversations' and column_name='direct_pair_key';
select indexname, indexdef from pg_indexes where tablename='conversations' and indexname='conversations_direct_pair_key_key';
select conname, pg_get_constraintdef(oid) from pg_constraint where conname='conversations_direct_pair_key_shape';
select tgname from pg_trigger where tgrelid='public.conversations'::regclass and not tgisinternal;
select count(*) filter (where direct_pair_key is not null) as keyed, count(*) filter (where type='direct') as direct from public.conversations;
```

## 6. Rollback

Commented at the bottom of the migration (drop trigger, function, index, constraint, column). Nothing else depends on them;
the code keeps working without the column only if the helper is rolled back too (it inserts the key).

## 7. Approval needed

1. Apply the migration to `ntzztcnkedcxfjvfxjrf`.
2. Commit and push.
3. Deploy web (the helper inserts `direct_pair_key`, so the migration must be applied BEFORE the web deploy; the reverse order
   would make every direct-room creation fail with an unknown-column error).
