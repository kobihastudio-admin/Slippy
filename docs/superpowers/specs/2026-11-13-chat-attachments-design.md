# Chat on the phone: own messages on the right, any file, share / forward, and a movable AI button

Status: implemented and tested locally; iOS Release build installed on the user's iPhone (2026-11-13). NOT committed, web NOT deployed: each needs its own approval. Approved by the user on 2026-11-13 ("ดำเนินการทั้ง 4 ข้อเลย"). Date: 2026-11-13 (Asia/Bangkok).
Tests: `ios/scripts/verify-chat-presentation.mjs`, `verify-chat-attachment-rules.mjs` (new), `verify-friend-message-meta.mjs` (new); `web/src/lib/assistant-fab.test.mjs` (10), `chat-attachment.test.mjs` (3).

## 1. Report

After opening a chat with a friend worked: every message sits on the left; files other than pictures cannot be attached; sharing like LINE is missing; the floating AI button covers the bottom-right button.

## 2. Causes and changes

1. **Everything on the left (iOS).** The app's own id is `UUID.uuidString` (UPPER-case); Postgres returns `sender_id` lower-case; the room compared them with `==`, so no message was ever "mine" (left side, with an avatar). `ChatPresentation.isSameUser` compares trimmed, lower-cased ids and is used by the room row and by `layouts` (avatar runs). The trip chat uses the same room view, so it is fixed too. The web chat compares correctly and was not affected. The fixture now uses an upper-case id so a simulator screenshot shows the real situation.
2. **Any file (iOS + web).** Same storage and message shape as the web chat already used: public bucket `chat-attachments` (50 MB), `chat/<conversationId>/<millis>.<ext>`, message `image` / `video` / `file` with `body` = file name and `meta` = `{fileName, fileSize}`. No migration: the `messages` insert policy and type check already allow these types (20261110130000).
   - iOS: "+" next to the text field: camera (only where one can capture), photos and videos, any file. Videos are copied to a temporary file first (no 500 MB `Data`). Photos keep HEIC / PNG / JPEG originals and are re-encoded as JPEG only when needed or over the limit. Size is checked before reading and before upload; errors are Thai (`ChatAttachmentRules.friendlyError`). A failed message insert removes the file it just uploaded. Messages show a thumbnail (images) or a card with icon, name and size; tapping opens it in QuickLook (which has its own share button).
   - Web: the paperclip accepts any file (it used to be limited to image / video / PDF, and the picture button left the paperclip stuck on images); a separate input for photos and videos; file cards show the size.
3. **Share like LINE.** iOS: long-press a message: open, share (system share sheet: LINE, AirDrop, Files, ...), copy (text, or the link of a file), forward (to another chat of the user, sent as a copy of the same text / file URL; nothing is uploaded again; payment requests, slips and system lines are not forwarded). Web: a share button on file cards (Web Share API, else the link is copied).
4. **AI button (web).** `SupportChat` is draggable (snaps to the left or right edge at the height where it is dropped, position kept in `localStorage`), and "ซ่อนไอคอน" in its window hides it behind a small edge tab that brings it back. While the window is open the button returns to the bottom corner it opens from. A click right after a drag is ignored by time, not by a flag, because some browsers send no click after a drag. The native iOS app has no such button.

## 3. Verified

- Host tests above (the alignment test fails without the fix: `[true, true, false, true]` and passes with it); `tsc --noEmit` clean; iOS simulator and device builds.
- Simulator (fixture, no network): own messages right and friend's left with avatar even with an upper-case id; file cards (pdf, xlsx) and a failed-image placeholder; "+" menu (camera hidden on the simulator as designed); long-press menu; forward sheet lists the other chats and not the current one.
- Browser harness of the real `support-chat.tsx` at phone width: drag to the left edge and back to the right, position kept after reload, open, hide, hidden state kept after reload, edge tab restores it.

## 4. Not verified

- A real send from the phone (photo, video, any file) and forward with real accounts; the upload and the insert were not run against the hosted project here (the Supabase connector answered 500 during this work; the earlier reads of the policy and type check were from the migration files).
- Opening / sharing a downloaded file from a real message (QuickLook and the share sheet need a real URL); camera capture (the simulator cannot).
- The web changes in the real app with a signed-in session (not deployed).

## 5. Privacy note

`chat-attachments` is a PUBLIC bucket, as before: anyone who has a file's link can open it without signing in. Making chat files private needs a private bucket and signed URLs (a migration and a change in both clients); not done.

## 6. Rollback

iOS: reinstall the build of commit `96371d2`. Web: not deployed yet; after deploy, the previous image tag (`rollback-...`) is the rollback. No database change to undo.
