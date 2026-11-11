# Chat message types: allow video/file, and keep payment/system messages server-only

Status: APPLIED 2026-11-11 to the hosted project (version 20261111005113) with the user's explicit approval; verified read-only from the catalog afterwards. Date: 2026-11-10 (Asia/Bangkok).
Traces to: independent review of the chat authorization repairs (2026-11-10); D-077 (schema/RLS changes are separately gated).
Migration (draft, NOT applied): `supabase/migrations/20261110130000_messages_types_and_insert_policy.sql`.
Test: `supabase/tests/messages-types-migration.test.mjs` (static shape checks, 6/6).

## 1. Two findings, both verified against the hosted database on 2026-11-10

1. **Video and file messages cannot be sent from the web chat.** `messages_msg_type_check` is
   `text, image, payment_request, slip, system`; the web client sends `video` and `file`. Before the web release of
   2026-11-10 the send route answered 200 although nothing was stored (and notified the other members); it now answers
   500 and the client shows "send failed". Either way the feature does not work.
2. **Any room member can forge server-only message types.** The insert policy `messages_member_insert` checks only
   `sender_id = auth.uid()` and membership. A member can insert `payment_request`, `slip` or `system` rows with arbitrary
   `meta` directly through PostgREST with their own JWT; the web chat renders them as payment/slip cards that link to
   `/pay/<meta.payment_request_id>` and `/documents/<meta.document_id>/review`. The web route's allowlist
   (`chat-access.ts`) is defense in depth only, because this policy is the boundary.

## 2. Change

- Widen the CHECK to `text, image, video, file, payment_request, slip, system`.
- Replace the insert policy so a member may insert only `text, image, video, file`, as themselves, into rooms they belong to.
- No change to the read policy, RLS settings, other constraints (`messages_sender_required`) or data.

## 3. Who writes messages today, and what changes for them

| Writer | Client / role | Types | Effect |
|---|---|---|---|
| iOS `MessagesViewModel.sendMessage` | user JWT (RLS applies) | `text` | none |
| Expo `mobile/src/app/(app)/messages/[id].tsx` | user JWT | `text` | none |
| Web `POST /api/conversations/[id]/messages` | admin (after a membership check) | `text, image, video, file` | video/file start working |
| `api/payment-requests` | admin | `payment_request` | none (service role bypasses RLS) |
| `api/liff/split-groups/[id]/send-qr` | admin | `payment_request` | none |
| `api/liff/chat` | admin | `text` | none |
| `lib/trips/trip-conversation.ts` | admin | `system` | none |

Found by reading every `messages` insert in `web/`, `api/`, `ios/` and `mobile/`; `android/` has none. No web client
component writes the table directly. Existing rows: 8 (text 4, image 3, system 1), all inside the new CHECK.

## 4. Risks

- A client that inserts one of the three server-only types with a user JWT would start getting RLS errors. None exists
  in this repository; an unknown external client could not be checked.
- `ADD CONSTRAINT ... CHECK` validates all rows while holding a lock; with 8 rows this is instant.
- This does not validate `attachment_url` or `meta` of user-authored types (a member can still post an `image` whose URL
  points anywhere) and does not cap message size. Separate follow-ups.

## 5. Verification after applying (read-only, catalog only; no user data touched)

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.messages'::regclass and contype = 'c';          -- the 7-type CHECK + messages_sender_required
select polname, polcmd::text, pg_get_expr(polwithcheck, polrelid) from pg_policy
 where polrelid = 'public.messages'::regclass order by polname;            -- insert policy lists only 4 types
```

Not proven by this check: the behaviour with two real users (that needs test accounts; no real rooms are used).
Manual test after applying, with two test accounts: a web video/PDF send is stored and shown; a direct PostgREST insert
of `payment_request` as a member is refused (403 / RLS violation).

## 6. Rollback

Commented at the bottom of the migration file; it restores the old CHECK and the old insert policy exactly.

## 7. Approval needed

Apply to the hosted project `ntzztcnkedcxfjvfxjrf` (migration version will be recorded with its own timestamp, as with
`line_synced_groups`). Nothing else (no deploy) is required: the web route already accepts `video`/`file` and the
server writers use the service role.
