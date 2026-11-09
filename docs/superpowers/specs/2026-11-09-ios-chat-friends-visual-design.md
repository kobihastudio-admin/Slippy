# iOS Chat and Add-Friend Visual Redesign (LINE-like)

Status: DRAFT SPEC for user review. Not an implementation plan.
Date: 2026-11-09 (Asia/Bangkok).
Traces to: IN-07 / IN-10; D-077 (friends/chat continuation). Governance note: the user asked to start friends/chat before the Trip contract's closure, which reorders D-077's Trip -> friends -> chat sequence. The reorder must be recorded in CURRENT.md/DECISIONS.md by the governance owner; this spec does not edit the governance repository. This increment needs no schema/RLS/security/provider approval because it changes presentation and client-only behavior (see Non-Goals).
Parent draft (not superseded): `docs/superpowers/specs/2026-10-18-friends-chat-design.md`.

## 1. Understanding (confirmed with the user)

- Goal: iOS chat list, 1:1 chat room and add-friend screens should feel as familiar and polished as the LINE app. "LINE-like" means familiar layout and behavior, not LINE branding, and not LINE interoperability.
- First increment: iOS only, appearance plus one small client-side behavior fix (keep the typed message until it is sent successfully). Web follows in a later increment.
- Visual decisions, chosen by the user from mockups:
  1. Chat room: LINE layout with Slippy brand colors, single-corner bubble tail like LINE.
  2. Chat list: flat LINE-style rows.
  3. Add friend: one screen (search, three icon tiles, friend requests).
- Success: a user opening these three screens sees the agreed layouts in Light and Dark, every visible control works, nothing displays a state the system cannot know, and existing capabilities (QR, scan, LINE share, search, request, accept, start chat, send) still work.

## 2. Non-Goals (explicitly out of this increment)

- Read receipts ("อ่านแล้ว"), unread counts, pin/mute/archive: need server-side read state or schema. Not shown, not faked.
- New decline behavior: not added. (Correction 2026-11-09: a decline ✕ already exists on pending requests in `SocialView`, calling `SocialViewModel.removeFriend`. It is preserved unchanged in the shared request list; see section 8.)
- Attachments, stickers, voice, emoji picker, calls in the composer: no placeholder buttons.
- Group chat, message history paging/"newest page" repair, realtime replacing 4-second polling, web API membership authorization repair: remain separate gated work from the parent draft.
- Email/Teams invitations, contact import, "people you may know".
- Web UI, schema/RLS/security changes, providers/credentials, deployment, commit/push/merge, signing, physical-device install.

## 3. Design

### 3.1 Chat room (`ios/Slippy/Views/Chat/FriendChatRoomView.swift`)

- Bubble: corner radius 16; the corner adjacent to the sender (top-left for friend, top-right for me) uses radius 4. Me: `Color.brand500` with white text. Friend: `Color.surface`. Screen background `Color.surfaceMuted`. All adaptive; Dark must be legible (verified by screenshot).
- Avatar: shown beside the first message of each consecutive run from the friend; later messages in the run keep the same left indent without repeating the avatar. No sender name label in 1:1.
- Time: `HH:mm` (device timezone, 24-hour) beside each bubble on the inner side, small secondary text.
- Day chip: when a message's local calendar day differs from the previous message's (or for the first message), show a centered chip: "วันนี้", "เมื่อวาน", otherwise `d/M` (`d/M/yy` if not the current year).
- Composer: capsule text field (1-4 lines) plus send button. No other buttons. Send disabled for blank text or while a send is in flight.
- Draft retention (behavior fix): the text is cleared only after `sendMessage` reports success, and only if the field still equals the text that was sent (newer typing is never wiped). On failure the text stays and a one-line error ("ส่งไม่สำเร็จ แตะส่งเพื่อลองใหม่") shows above the composer; tapping send retries with the retained text.
- Unchanged: 4-second polling, scroll-to-newest on change, navigation.
- Accessibility: each bubble has a VoiceOver label "<ฉัน|ชื่อเพื่อน>, <ข้อความ>, <เวลา>".

### 3.2 `MessagesViewModel.sendMessage` (client-only change)

- Signature becomes `@discardableResult func sendMessage(...) async -> Bool`.
- Returns true once the message insert succeeded. Returns false for blank/in-flight guard hits and when the insert fails (error message set as today).
- The follow-up `conversations.updated_at` touch is non-critical: if it fails, keep recording the error text but still return true, because the message was already stored. Returning false there would restore the draft and cause a duplicate send.
- No other behavior changes (history loading, polling and the conversation lookup stay untouched).

### 3.3 Chat list (`ios/Slippy/Views/Chat/FriendChatListView.swift`)

- Title "แชท". Flat full-width rows separated by a thin divider: 44 pt avatar, bold name, one-line preview (existing icons for image/video/file), time at top-right.
- List time format (replaces `relTime` here only): same local day = `HH:mm`; previous day = "เมื่อวาน"; within the last 6 days = Thai weekday abbreviation; older = `d/M` (`d/M/yy` for a different year).
- Search field filters the already loaded conversations locally by display name or last-message text (case-insensitive contains). No network call. Empty result shows a "ไม่พบ" state.
- The compose button (square-and-pencil) keeps opening the friend picker; the picker sheet uses the same flat rows and avatar. Empty state is restyled with the brand color and keeps its "เริ่มแชทกับเพื่อน" action.
- Not shown: unread badge, pin, mute (see Non-Goals).

### 3.4 Add friend (`ios/Slippy/Views/Social/SocialAddFriendSheet.swift`)

- One scrolling screen: (1) search field by name, (2) three icon tiles: สแกน QR, QR ของฉัน, แชร์ลิงก์, (3) section "คำขอเป็นเพื่อน (n)" listing pending requests with an accept button.
- Reuses existing logic with no behavior change: `SocialViewModel.searchUsers`, `sendFriendRequest`, `acceptRequest`, `acceptInvite`, `loadOrCreateInviteLink`, the existing QR generation and scanner, and the existing LINE share (`line://` with `https://line.me` fallback) including the LINE green on that button.
- Search and request sections currently live in `SocialView`; extract them into shared subviews used by both `SocialView` and the sheet. `SocialView` keeps showing them; only the code is shared, not the behavior.
- "สแกน QR" and "QR ของฉัน" each push a detail panel inside the add-friend sheet's navigation (back button returns to the one-screen list); "แชร์ลิงก์" pushes a panel with the LINE share button and copy-link as a secondary action. Existing toasts (success, invalid/expired QR, copied) are kept.
- Not added: email/Teams invite, contact import. The existing accept (✓) and decline (✕) buttons of the request rows are kept exactly as `SocialView` has them today (correction, section 8).

### 3.5 Shared pieces

- `ios/Slippy/Views/Chat/ChatAvatar.swift`: `ChatAvatar(name:url:size:)` — remote image with an initial fallback on `Color.brand50`. Initial selection skips leading Thai vowels (เ แ โ ใ ไ) and non-letters so "เอ" shows "อ", falls back to "?" for empty names.
- `ios/Slippy/Utils/ChatPresentation.swift`: pure Foundation-only functions: ISO timestamp parsing (with/without fractional seconds and offsets), list time label, day-chip label, same-day check, run grouping ("show avatar here?"), avatar initial, local conversation filter. No SwiftUI/Supabase imports so a host script can compile it standalone.
- Files and generation: new Swift files require `xcodegen generate` (project is generated from `ios/project.yml`; `ios/Slippy.xcodeproj` is gitignored).

## 4. Files

Modify: `FriendChatRoomView.swift`, `FriendChatListView.swift`, `SocialAddFriendSheet.swift`, `SocialView.swift` (extract shared subviews only), `MessagesViewModel.swift` (`sendMessage` only).
Create: `ChatAvatar.swift`, `ChatPresentation.swift`, `ios/scripts/verify-chat-presentation.mjs`, and a Debug-only fixture entry (see 5).
All target files were clean (no uncommitted changes) when checked on 2026-11-09, so no existing uncommitted work is overwritten. Re-check immediately before editing. The 48 other dirty files must stay untouched.

## 5. Verification

- Host checks: `verify-chat-presentation.mjs` compiles `ChatPresentation.swift` with `swiftc` (module cache under `/private/tmp`, as the existing `verify-trip-*` scripts) and asserts: list time labels (today/yesterday/weekday/older/other year, midnight and day-boundary cases), day chips, run grouping, Thai-vowel initials, local filtering, and timestamps with microseconds, without fractional part, and with `+00:00`/`Z`.
- Behavior check for draft retention: a host test of the decision logic ("clear only on success and only if text unchanged") and review that the touch-failure path returns true.
- Build: `xcodebuild` for the iOS simulator succeeds with no new warnings in the touched files.
- Visual evidence: simulator screenshots of the three screens in Light and Dark using synthetic fixture data through a Debug-only launch fixture, following the pattern already used for the medication fixtures (confirm the mechanism in the planning phase). No credentials are entered, no real conversations/friends/requests are read or written. If a fixture cannot be wired without touching production paths, report visual verification as not obtained instead of claiming it.
- Not claimed by this increment: physical-device behavior (provisioning profile is expired; signing is a separate approval), hosted persistence, delivery, multi-user behavior.

## 6. Acceptance Criteria

- [ ] Chat room, chat list and add-friend screens match the three chosen mockups in structure, in Light and Dark.
- [ ] No control is a placeholder; no read/unread UI is shown; the only decline control is the pre-existing ✕ on request rows.
- [ ] Sending a message failure keeps the typed text and shows the error; success clears it; newer typing is preserved; insert-success with touch-failure does not restore the draft.
- [ ] Conversation search filters locally and shows an empty-result state.
- [ ] Add friend: search, request accept, QR show/scan, LINE share and copy link all behave as before.
- [ ] Host checks pass; simulator build succeeds; screenshot evidence recorded or the gap stated.
- [ ] No schema/security/web/governance edits; no commit/push; unrelated dirty files unchanged.

## 7. Risks and Open Points

- Timestamp parsing: `ISO8601DateFormatter` is strict about fractional seconds; the parser must fall back across formats (covered by host checks).
- Older year display uses Gregorian `d/M/yy`; if Buddhist-era display is preferred, change the formatter only.
- Shared-subview extraction touches `SocialView`; the plan must keep its behavior identical and verify by build plus screenshot.
- Sequencing: this runs ahead of the Trip contract closure (D-077). The Trip contract's remaining items (Journey/photo review, device/UI proof) are unaffected and stay open.

## 8. Planning amendments (2026-11-09, found while reading the code for the plan)

These correct or refine the approved spec; none adds product scope.

1. Decline already exists. `SocialView.pendingSection` has accept (✓, `acceptRequest`) and decline (✕, `removeFriend`). The extracted request list keeps both unchanged. Sections 2, 3.4 and 6 are corrected above.
2. `FriendChatRoomView` is shared. `JourneyPrototypeView.swift:1506` opens it for the trip chat with its own `.navigationTitle`. New parameters (`friendName`, `friendAvatarUrl`, `showsAvatars`) therefore have defaults that keep that call site compiling and unchanged: no title override, no avatar slot. The trip chat room gets the new bubble look as a side effect.
3. Fixtures need a small DEBUG-only addition to `MessagesViewModel` beyond `sendMessage`: an `isFixture` flag that makes `loadConversations`, `loadMessages` and `sendMessage` skip the network. Without it the 4-second poll would overwrite fixture messages with an (empty) anonymous query result. The flag does not exist in Release builds. `FriendChatListView` also gets an optional injected view model for the same reason.
4. Chat-room hygiene folded into the file being rewritten: clear stale messages from a previously opened conversation on entry; list spinner only when there is nothing to show (no flicker during pull-to-refresh); non-text messages show their placeholder ("📷 รูปภาพ") instead of an empty bubble.
5. Add-friend toast now auto-dismisses after 2 seconds (the existing "คัดลอกลิงก์แล้ว!" toast never cleared) because it now also overlays pushed panels.
6. Older-year dates use the Gregorian calendar explicitly even when the device calendar is Buddhist.
7. `SlippyApp.swift` already has uncommitted changes from other work. This increment adds three `case` lines to its Debug preview switch (additive hunk only); the rest of that file's diff must stay as it is.
