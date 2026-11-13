# iOS: show other people's profiles (friends, chat) without opening `public.users`

Status: migration APPLIED 2026-11-13 (hosted version 20261113042118), iOS built and installed on the user's iPhone, web (LINE invite landing) deployed. Approved by the user on 2026-11-13 ("ดำเนินการ ข้อ 1–4"). Date: 2026-11-13 (Asia/Bangkok).
Migration: `supabase/migrations/20261113100000_related_profiles_rpc.sql`.
Tests: `supabase/tests/related-profiles-migration.test.mjs` (9), `ios/scripts/verify-profile-directory.mjs`.

## 1. Problem

Reported: adding a friend from LINE does not work, and the chat's "start a chat" picker shows nobody.

- `public.users` has one SELECT policy, `users_select_own` (`id = auth.uid()`), on purpose: the table holds phone, date_of_birth and
  is_superadmin. The iOS app selected other people's profiles straight from that table, so every such read returned nothing:
  `SocialViewModel` friends list, the profiles of people who sent a request, and the chat list's names and avatars
  (`MessagesViewModel`, a `users(...)` embed). The chat picker lists `socialVM.friends`, so it was always empty, even with friends.
  The web app reads through the service role and was not affected. Chat was only ever tested with fixtures, so this was not seen.
- The share-to-LINE button sends `…/friends/join/<token>?src=line`; the page that answers it ("open in Slippy", commit `6a7a623`) had
  deliberately not been deployed (it makes one URL shape public in `middleware.ts`), so the link redirected to `/login` and lost the token.
  Checked live before the fix: `?src=line` and the plain link both answered 307 to `/login`.

## 2. Change

- `public.get_related_profiles(p_ids uuid[])`: SECURITY DEFINER, STABLE, `search_path = public, pg_temp`. Returns only `id, full_name, avatar_url, email`, and only for
  the caller, people with a pending or accepted friendship with the caller (a blocked one is not related), and people in a conversation the caller is in.
  `email` is real only for the caller and accepted friends, `''` otherwise. At most 200 ids per call; nothing for an unauthenticated caller.
  EXECUTE for `authenticated` and `service_role` only. No policy on `public.users` changed; no phone, date of birth or flags are exposed.
- iOS: `ProfileDirectory.fetch(ids:)` (chunks of 200, lower-case keys) replaces the three reads in `SocialViewModel` (friends, requesters) and `MessagesViewModel`
  (conversation peers). `UserProfile.displayName` falls back to a placeholder when there is neither a name nor an email.
- Web: deployed the "open in Slippy" landing (`6a7a623`) on top of the 2026-11-11 image. The only URL shape reachable without a session is
  `/friends/join/<12 lower-case hex>` with exactly one `src` query item equal to `line`; the plain link stays behind login because it creates a friendship.

## 3. Verified

- Migration shape (9 checks). Behaviour of the function in a rolled-back transaction with simulated JWTs, counts only: a friend is visible in both directions with
  an email, the caller sees themself, a stranger is not returned (a mixed request returns only the related ids), `null` and empty input return nothing, `anon` cannot execute,
  and a direct select on `public.users` as an authenticated user still returns only the caller's own row.
- iOS host tests (id preparation, chunking, RPC row decoding, placeholder name) and the existing chat/invite/balance host tests; simulator and device builds succeed.
- Web: route manifests and headers identical to the previous image, all 1,271 files byte-identical to the build, an offline smoke boot, then the public URL:
  `?src=line` answers 200 with the landing and the `slippy://friends/join/<token>` link; the plain link, a repeated `src`, `src=LINE`, an upper-case or short token, an extra path segment,
  `/api/conversations` and `/social/friends` all still 307 to `/login`.

## 4. Not verified

- The screens were not driven with real accounts (needs two signed-in users). Not seen on a device: the friend list, the chat picker, the chat list names, tapping the LINE link
  and "open in Slippy", accepting the invite in the app, and that the new friend then appears. The pending-request branch of the function had no data to test.
- Opening a link from LINE's in-app browser: its handling of the `slippy://` tap is unproven here.

## 5. Left as it was

- The plain invite link (no `src=line`) still redirects an anonymous visitor to `/login` and loses the token (`/login` ignores `next`).
- User search by name in the app (`SocialViewModel.searchUsers`) still selects from `public.users`, so it only ever finds the caller. Opening it to strangers would expose people
  who have not connected with the caller; an exact-email lookup or invite link/QR is the safer replacement, not built here.
- `conversation_members` has no INSERT policy, so the iOS flow that adds both members itself still appears to be refused (separate item).

## 6. Rollback

`DROP FUNCTION IF EXISTS public.get_related_profiles(uuid[]);` (the iOS reads then return nothing again, as before). Web: `solutionx-web:rollback-20261113-pre-invite-landing` (= the previous image 8370694ee9f9).
