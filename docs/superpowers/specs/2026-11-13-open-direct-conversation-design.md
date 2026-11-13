# Chat on the phone: open a direct chat on the server, and keep a friend invite alive across sign-in

Status: migration APPLIED 2026-11-13 (hosted version 20261113072109), web deployed (image d682e08e45fb), iOS built and installed on the user's iPhone. Approved by the user on 2026-11-13 ("ยืนยันตามแนวทางแก้ไข"). Date: 2026-11-13 (Asia/Bangkok).
Migration: `supabase/migrations/20261113130000_open_direct_conversation.sql`.
Tests: `supabase/tests/open-direct-conversation-migration.test.mjs` (10), `ios/scripts/verify-chat-history-contract.mjs`, `ios/scripts/verify-chat-presentation.mjs`, `web/src/lib/invite-next.test.mjs` (4), `web/src/lib/invite-login-wiring.test.mjs` (6).

## 1. Report

"Chat still does not work, and adding a friend from LINE does not work from the phone."

## 2. How chat works (as built)

- Tables: `conversations` (direct / group, `direct_pair_key`), `conversation_members`, `messages`. RLS: members read their rooms and messages; a user may insert a conversation as its creator (`conversations_creator_insert`); `conversation_members` has NO insert policy; members insert only text / image / video / file messages (`messages_member_insert`).
- Web: API routes with the service role (`POST /api/conversations`, messages, payment-request cards) after their own membership checks; `getOrCreateDirectConversation` (chat-access.ts) creates rooms with the pair key.
- iOS: reads and writes straight to Supabase with the user's JWT (so every step must pass RLS); the friend picker lists accepted friends (profiles through `get_related_profiles`); new messages arrive by polling every 4 s.
- Expo app: opens existing rooms and sends text only.

## 3. Findings (all checked on 2026-11-13; the tests ran in transactions that were rolled back, counts unchanged afterwards)

1. **iOS could never start a chat.** The app inserted the conversation `returning id`, then both members. As a signed-in user the first step fails (42501: the new row is hidden from its creator by `conversations_member_read` because the creator is not a member yet) and so would the second (42501: no INSERT policy on `conversation_members`). The database confirms it: no room created since 2026-09-01, no message since 2026-08-25, no orphan rooms. The chat list also showed nothing when it failed (the error was set on the view model and never displayed).
2. **Adding a friend from LINE had never completed.** Redeeming works in the database (`accept_friend_invite` as a second user: friendship created, the owner visible in the friend list through `get_related_profiles`), but no invite had been redeemed since 2026-07-03 (the one friendship, source `qr_scan`). Before the redeem: the web fallback "ดำเนินการต่อบนเว็บ" (`/friends/join/<token>`) sent a visitor without a session to a bare `/login` (the middleware did not pass the token) and neither the login nor the register form honoured a `next`, so after signing in or up the token was gone. The "open in Slippy" button needs the iOS app, which only exists as a development-signed build on the user's own iPhone. The automatic "friends from LINE" (`line_mutual`) has no code that creates it.

## 4. Change

- **DB**: `open_direct_conversation(p_friend_id uuid)` (SECURITY DEFINER, `search_path = public, pg_temp`, authenticated and service_role only). The caller must be signed in, cannot be the friend, and must have an ACCEPTED friendship with them (also closes the gap that nothing checked friendship before a room was created). It reuses the direct room of exactly the two (by `direct_pair_key`, else by its two members for a room made before the key), otherwise creates the room with the key and both members in one step; a lost race returns the winner's room. `guard_direct_pair_key()` now refuses the user's own role (`current_user IN ('authenticated','anon')`) instead of looking at `auth.uid()`, so this function can set the key while a user's own JWT still cannot. No policy was added or changed.
- **iOS**: `MessagesViewModel.getOrCreateDirectConversation` is one `rpc("open_direct_conversation")` call (no client-side insert); a failure is published as `openChatError` (Thai wording from `ChatPresentation.openChatFailureMessage`) and `FriendChatListView` shows it in an alert.
- **Web**: `lib/invite-next.ts`. The middleware redirects a visitor without a session to `/login?next=/friends/join/<token>` for that exact path shape only (12 lower-case hex, no extra segment; the path is rebuilt from the matched token, the query is dropped); the login and register forms carry it through email sign-in (and the MFA step), Google / Facebook (`/auth/callback?next=`), LINE (`/api/auth/line?next=`, which already validated it) and the links between the two pages. `/auth/callback` now validates `next` with `safeRedirectPath` (it used to append it to the origin unchecked).

## 5. Verified

- `open_direct_conversation` as simulated signed-in users, rolled back: the real friend pair reuses its existing room from both sides; a new friendship pair gets one room with 2 members and the key, from either side and on a second call; a stranger and a pending friend are refused (`not_friends`, 42501); yourself is refused (22023); `anon` cannot execute; a user cannot set `direct_pair_key` or add a member directly (42501).
- Web: tests above, `tsc --noEmit` clean, `next build`, manifests identical to the previous image, all 1,271 files byte-identical; offline probe of the built image and then the public URL: `/friends/join/<token>` -> `/login?next=%2Ffriends%2Fjoin%2F<token>`; `?src=line` still the public landing (200); an extra segment, an upper-case or malformed token, other pages and `/api/*` -> bare `/login`; the login page carries `next` to its register link and the register page to its login link; a hostile `next` (another origin) is dropped.
- iOS: host tests (contract, presentation), simulator and device builds, the new strings in the installed binary.

## 6. Not verified

- Nobody has opened a chat from the phone with real accounts yet; a real friend invite from LINE end to end (LINE's in-app browser, sign-in or sign-up on the web with `next`, the friendship appearing, then a chat). The web "friends/join" page itself was not changed.
- Still not possible without distribution: a friend without the iOS app can only use the web path; the app is not on TestFlight / the App Store.
- Not built: automatic "friends from LINE", and accepting an invite inside LINE through LIFF.

## 7. Rollback

DB: `DROP FUNCTION public.open_direct_conversation(uuid)` and the previous guard function (both in the migration file's comments); iOS then cannot start a chat again, as before. Web: `solutionx-web:rollback-20261113-pre-invite-next` (= 6888f0503c50).
