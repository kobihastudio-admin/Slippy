# Private chat files: members only, signed URLs, no "copy link"

Status: implemented and tested locally. NOT committed, web NOT deployed, iOS NOT installed, migration NOT applied: each needs its own approval, in the order below. Approved by the user on 2026-11-14 ("ดำเนินการตามแนวทางนี้เลย เอา "คัดลอกลิงก์" ออก"). Date: 2026-11-14 (Asia/Bangkok).
Migration: `supabase/migrations/20261114100000_chat_attachments_private.sql` (NOT APPLIED).
Tests: `supabase/tests/chat-attachments-private-migration.test.mjs` (8), `web/src/lib/chat-attachment.test.mjs` (8), `ios/scripts/verify-chat-attachment-rules.mjs`; the policies were also run with simulated users in a rolled-back transaction (below).

## 1. Why

Chat files lived in the PUBLIC `chat-attachments` bucket: anyone holding a file's link could open it without signing in, and any signed-in user could upload into any conversation's folder (the INSERT policy only checked the bucket). Found 2026-11-14: the bucket is used by chat only (trip photos use `trip-photos`); 4 objects exist (3 images, 1 video), all at `chat/<conversationId>/<millis>.<ext>`; 4 messages hold a file URL (all images, all in the bucket).

## 2. Design

- **Database (one migration).** `chat_attachment_conversation(name)` reads the conversation id out of `chat/<uuid>/<name>.<ext>` (NULL for any other shape). The bucket becomes private; the two open policies are dropped; new policies let only a MEMBER of the path's conversation read (`chat_attachments_select_members`) or upload (`chat_attachments_insert_members`), authenticated only. The delete-own policy and all rows are untouched. No data changes.
- **What a message stores.** New messages store the object path in `attachment_url`; the 4 old ones keep their public URL and clients read the path out of it (`chatAttachmentPath` / `ChatAttachmentRules.attachmentPath`; refuses anything that is not a chat file, other buckets, traversal, other schemes).
- **Opening a file.** Clients mint a signed URL (1 hour) with their own session (Storage checks the SELECT policy first) and cache it until 5 minutes before it expires: web `useChatAttachmentUrl` / `signChatAttachment`, iOS `MessagesViewModel.signedURL(for:)` + `SignedURLCache`.
- **Forward.** A file is COPIED inside Storage into the target conversation's folder (`copy` needs SELECT on the source and INSERT on the destination, which the forwarder has as a member of both rooms), because members of the target room could not read a file in another room's folder. A failed message insert removes the copy.
- **No "copy link".** Removed from the iOS long-press menu (a signed link would expire in an hour). Share sends the file itself: iOS downloads it then opens the share sheet; web uses the Web Share API with the file, else opens it in a new tab.
- **Web API.** `POST /api/conversations/[id]/messages` accepts an attachment only if it is a chat file of THIS conversation and stores its path (an old client may still send the public URL).

## 3. Rollout order (the order matters)

1. Commit; deploy the web image and install the iOS build. Both sign URLs, which also works while the bucket is still public.
2. Apply the migration. Applying it first would make today's iOS build and web page show no pictures.
3. Check with real accounts (send, open, share, forward) and that an old public link no longer opens.

## 4. Verified

- Migration run with simulated users in a transaction that was rolled back (the hosted bucket, policies and objects were checked unchanged afterwards): helper accepts only the path shape (upper-case uuid accepted, traversal, sub-folders, garbage return NULL); a member reads and uploads in their room; four bad name shapes and a room they are not in are refused; an outsider reads nothing of that room and cannot upload into it; anon cannot upload and its read fails. Deleting was not tested (Storage refuses direct deletes on its tables; the delete policy is untouched).
- Host tests: path extraction (path, old public URL, signed URL, encoded slash, 18 refusals), forwarded path, signed URL cache (renewal boundary; the iOS test fails when the URL parsing is broken), web helper tests, migration shape test; `tsc --noEmit`; iOS simulator build; simulator fixture: file cards still render from path-shaped values, the long-press menu shows open / share / forward only.

## 5. Not verified

- Anything against real Storage: signing a URL, `copy`, opening / sharing a file, an image thumbnail from a signed URL, video playback, on web and iOS (needs the deploy and real accounts).
- That the old public links stop working after the migration (verified only after it is applied).
- `next build` of the web app with these changes (the deploy recipe runs it).
- The Expo app shows no attachments, so it is unaffected; not run.

## 6. Rollback

Database: `UPDATE storage.buckets SET public = true WHERE id = 'chat-attachments'` and restore the two old policies (SQL in the migration file's comments). Clients keep working either way. Web: the previous image tag; iOS: the previous build.
