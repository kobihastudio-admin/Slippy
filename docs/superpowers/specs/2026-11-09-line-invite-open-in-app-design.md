# Friend invite from LINE opens the Slippy iOS app

Status: DRAFT SPEC for user review. Not an implementation plan.
Date: 2026-11-09 (Asia/Bangkok).
Traces to: user request "สามารถเพิ่มเพื่อนจาก LINE Application ได้" (2026-11-09); IN-07 / IN-10; D-077.
Governance note: this is SCOPE_EXPANSION. The approved visual spec (`2026-11-09-ios-chat-friends-visual-design.md`) listed LINE interoperability as out of scope; the user then explicitly asked for this feature and approved approach A (below). Provider/credential changes, schema/RLS, deployment, signing and Git mutations remain separately gated. This spec does not edit the governance repository.

## 1. Understanding (confirmed with the user)

- Goal: a person who receives a Slippy friend-invite link inside the LINE app can tap it and end up in the Slippy iOS app, where they become friends with the sender.
- Chosen approach (user): **A — custom URL scheme with a button on a web landing page.** Not universal links (B).
- Success: from a LINE chat, tapping the shared link opens a landing page; tapping "เปิดใน Slippy" opens the installed iOS app on a confirmation screen; confirming makes the two users friends exactly as scanning the QR does today; every failure path ends in a clear message, never a silent no-op or an unintended friendship.

## 2. What exists today (verified in code 2026-11-09)

- iOS shows a LINE-share button that opens `line://msg/text/…` (fallback `https://line.me/R/msg/text/?…`) with the text "มาเป็นเพื่อนกันใน Slippy กันเถอะ! <inviteURL>"; `inviteURL = Config.webAppURL + "/friends/join/<token>"` (`Config.webAppURL = https://dev.slippyai.app`).
- Web page `web/src/app/friends/join/[token]/page.tsx`: validates the token with the admin client, redirects to `/login?next=…` when signed out, then **upserts an accepted friendship immediately** (source `qr_scan`) and redirects to `/social/friends?joined=1`. LINE Login/LIFF sign-in already exists on web.
- iOS `SocialViewModel.acceptInvite(token:)` calls RPC `accept_friend_invite(p_token)` (migration 070; SECURITY DEFINER; errors `invite_not_found`, `invite_expired`, `cannot_add_self`; creates an accepted friendship; bumps `used_count`). Tokens are 12 hex characters, valid 7 days, reusable.
- The app registers URL scheme `slippy` and has an `.onOpenURL` handler in `SlippyApp.swift` that today handles `slippy://import-shared` and forwards everything else to the LINE SDK. No associated-domains entitlement exists.
- Not possible and not attempted: reading the user's LINE friend list (LINE does not expose it to third-party apps; to be re-checked against LINE documentation before anyone proposes it).

## 3. Design

### 3.1 Web landing page (web)

- Links shared **from LINE** carry `?src=line`. Both LINE-share entry points append it: iOS `shareViaLine()` and web `AddFriendModal.tsx` (`lineShareUrl`). The copy-link action and QR code keep the plain URL.
- `friends/join/[token]` behavior:
  - Without `src=line`: unchanged (existing auto-join flow).
  - With `src=line`: the page does **not** join anyone on load. It validates the token as today (invalid/expired → the existing red message) and shows a landing card with two actions:
    1. **"เปิดใน Slippy"** → `slippy://friends/join/<token>` (a normal link the user taps; no automatic redirect, because LINE's in-app browser blocks scheme navigation that is not triggered by a tap).
    2. **"ดำเนินการต่อบนเว็บ"** → the existing flow (`/friends/join/<token>` without `src=line`).
  - A short line under the buttons: "ยังไม่มีแอป Slippy? ใช้ทางเว็บได้เลย".
- No App Store link is added: the app's store listing is not known to this spec (see open points).
- No schema, RLS or API-contract change. The landing page only reads what the page reads today.

### 3.2 iOS deep link handling

- Accepted form: `slippy://friends/join/<token>` where `<token>` matches `^[0-9a-f]{12}$` (the format `friend_invite_links` generates). Anything else is ignored (falls through to the existing handlers) and never reaches the RPC.
- A pure, Foundation-only helper (`InviteLink.token(from: URL) -> String?`) does the parsing so a host script can test it, as `ChatPresentation` is tested.
- `.onOpenURL` in `SlippyApp.swift`: before forwarding to the LINE SDK, if the URL is an invite link, store the token as a **pending invite** and stop. The change to this already-dirty file must be one additive hunk.
- **Never auto-accept.** A custom URL scheme can be opened by any web page or app, so opening the link must not by itself create a friendship. After the app has a signed-in session, it shows a confirmation sheet: title "เพิ่มเพื่อนจากลิงก์เชิญ", text "คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy ต้องการรับคำเชิญนี้ไหม?", actions "รับคำเชิญ" and "ยกเลิก". Only "รับคำเชิญ" calls `acceptInvite(token:)`. (The sheet cannot show the inviter's name: the existing RPC returns it only after joining, and adding a read RPC is a schema change that this increment does not make.)
- Signed out: keep the pending token in memory, let the user sign in as usual, then show the confirmation sheet. The token is not persisted to disk; if the app is killed, the user taps the link again.
- Results (reusing wording already in `SocialAddFriendSheet`): success → "เพิ่ม <ชื่อ> เป็นเพื่อนแล้ว 🎉" and the pending token is cleared; `invite_not_found` / `invite_expired` → "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว"; `cannot_add_self` → "นี่คือลิงก์ของคุณเอง"; any other error → "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" and the token stays so the user can retry. Cancel clears the token.
- A second invite link while one is pending replaces the pending token (latest wins).
- After a successful accept the friends list is reloaded (`SocialViewModel.load`).

### 3.3 Reuse and files

- Reuse `SocialViewModel.acceptInvite` unchanged. No change to `friend_invite_links`, `friendships`, the RPC, or any policy.
- iOS: `ios/Slippy/Utils/InviteLink.swift` (parser), a small pending-invite holder plus confirmation sheet view, `SlippyApp.swift` (one additive hunk), the LINE-share text in `SocialAddFriendSheet.swift` (`?src=line`).
- Web: `web/src/app/friends/join/[token]/page.tsx` (landing branch), `web/src/app/(app)/social/friends/AddFriendModal.tsx` (`lineShareUrl` gets `?src=line`).
- New Swift files need the project regenerated; `xcodegen` does not run on this Mac without Rosetta, so the plan must either use an arm64 xcodegen or register the files in the generated (gitignored) project by script, and say which.

## 4. Non-Goals

- Reading, importing or syncing LINE friends; LINE Official Account friendship; LINE Messaging API; LIFF changes.
- Universal links, associated domains, the `apple-app-site-association` file, signing or provisioning changes.
- Android, or any change to how the QR code or copy-link work.
- Showing the inviter's name before accepting (needs a new read RPC), expiry/rate-limit changes, or making invites one-time use.
- A fix for the existing behavior that a signed-in web user is befriended the moment the plain link opens (kept as is; mentioned in risks).

## 5. Verification

- Host check (`verify-invite-link.mjs`, compiled with `swiftc` like the other host scripts): accepts `slippy://friends/join/0123456789ab`; rejects wrong host or path, uppercase or non-hex, 11 or 13 characters, extra path segments, empty token, query/fragment tricks (`…/0123456789ab?x=1` may be accepted only if the token part is still exactly 12 hex), URLs for other schemes.
- Web: type-check/lint of the touched files; a rendered check of the landing page (token valid / invalid / expired states) with a stubbed or local-only data path, never production rows.
- iOS build for the simulator succeeds; screenshots (Light/Dark) of the confirmation sheet using a Debug-only fixture screen; `xcrun simctl openurl <udid> "slippy://friends/join/0123456789ab"` shows the confirmation sheet and cancelling clears it (no network accept).
- Not claimed unless actually done: the real accept against hosted data, tapping the link inside the LINE app on a physical device (provisioning profile is expired; signing is a separate approval), behaviour of LINE's in-app browser on the user's LINE version, and the web deploy to the NAS (the user runs the docker build).

## 6. Acceptance Criteria

- [ ] A link shared from LINE (`?src=line`) shows the landing page and does not join anyone by itself; plain links behave as before.
- [ ] "เปิดใน Slippy" opens the app on the confirmation sheet; cancel makes no friendship; confirm uses the existing RPC and reports the result.
- [ ] Malformed or foreign `slippy://` URLs never reach the RPC and never break `slippy://import-shared` or LINE SDK callbacks.
- [ ] Signed-out users are asked to sign in, then see the confirmation sheet.
- [ ] No schema/RLS/credential/entitlement change; no commit/push/deploy without separate approval.
- [ ] Host check and builds pass; any unverified item is listed as not verified.

## 7. Risks and Open Points

- Custom URL schemes are not exclusive: another app could register `slippy`. Mitigated by the mandatory confirmation sheet and by the token being a bearer link, but not eliminated.
- The invite link is a bearer token that befriends instantly with no approval by its owner (existing design). Anyone who receives the link — including a forwarded one — can become a friend. Out of scope here; recommend revisiting (one-time use or owner approval) as a separate, gated change.
- LINE's in-app browser may handle the button differently across LINE versions; the web fallback button exists for that reason.
- No App Store URL is known; "ยังไม่มีแอป" currently points only to the web path. Add the store link when one exists.
- The deploy of the web change and any later release are outside this spec and need the user's action or approval.
- Sequencing: runs after the chat/friends visual increment (commit `e07a128`) and ahead of the Trip contract closure; the D-077 reorder still needs a governance record from the owner.

## 8. Planning amendments (2026-11-09, found while reading the code for the plan)

These refine the approved spec; none adds product scope.

1. **`/friends/join/*` is not public today.** `web/src/middleware.ts` redirects any anonymous request to `/login` (without the token) unless the path is in its public list, and `/login` ignores `next`. So the landing page could not be seen by the typical recipient (not yet logged in). The plan makes exactly one URL shape public: `/friends/join/<12-hex-token>?src=line`, via a pure helper, and the landing branch does **no database or session access**, so the public page cannot be used to test whether a token exists. This is a security-model change and needs explicit approval before deploy.
2. **The existing web fallback for signed-out users is already broken** (token lost at login). The landing's "ดำเนินการต่อบนเว็บ" therefore keeps pointing at the existing plain URL and works for signed-in users only; fixing login `next` handling is separate work (it also needs open-redirect protection).
3. **The landing does not validate the token against the database** (spec §3.1 said it would). It validates the token's *format* only; the app reports expired/unknown tokens when the user confirms.
4. **A second link while a redeem is in flight is ignored** (latest wins otherwise), so the confirmation the user is looking at cannot change under them.
5. **No npm script is added** (`web/package.json` is dirty with other work); the web test is run with an explicit `node --experimental-strip-types --test` command. Web type-check, lint and a rendered page check are not obtainable on this machine (`web/node_modules` has no `tsc`/`next`).
6. **Presentation:** the confirmation sheet is attached at the app root and shown only when a session exists. If another sheet is already presented by `RootView` at that moment, SwiftUI shows the invite sheet after it is dismissed.
