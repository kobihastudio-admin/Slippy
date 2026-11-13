# iOS document screen: make ดาวน์โหลด / แชร์ / รายงานปัญหา do what they say

Status: code written and built locally; migration APPLIED 2026-11-12 to the hosted project (version 20261112160553) with the user's explicit approval and verified read-only from the catalog afterwards. Design approved by the user on 2026-11-12; committing, pushing and releasing iOS each still need their own approval. Date: 2026-11-12 (Asia/Bangkok).
Migration (applied): `supabase/migrations/20261112100000_document_reports.sql`.
Tests: `ios/scripts/verify-document-actions.mjs`, `ios/scripts/verify-document-download.mjs`, `supabase/tests/document-reports-migration.test.mjs`.

## 1. What was wrong (iOS `DocumentDetailView` footer bar)

| Button | Before | Problem |
|---|---|---|
| ดาวน์โหลด | opened the in-app image viewer | nothing was downloaded or saved |
| แชร์ | `ShareLink` with a three-line text (shop, total, date) | the document itself was not attached |
| รายงานปัญหา | `ShareLink` with a text | not sent anywhere; nobody could receive it |

Not in scope: the mobile chat page. It has no download, share or report at all (text-only on iOS and Expo); the comparison with LINE was reported separately and nothing was changed for it.

## 2. Change

- **ดาวน์โหลด**: creates a fresh 10-minute signed URL, downloads the stored file to `<tmp>/slippy-share/<uuid>/<name>` and opens the system share sheet with the file alone ("Save to Files", "Save Image"). **แชร์**: same file plus the existing summary text. Both show a spinner on the tapped button, disable the other, and report failures in an alert. The temporary copy is deleted when the sheet closes and anything left over is purged at the next download.
- `DocumentFileSupport` (Foundation only): the file name keeps the stored name made safe (unsafe characters become `_`, Thai kept, 60 characters, never a path separator) and always ends in a real extension (from the path, else the response's content type, else `jpg`). `DocumentFileDownloader` refuses non-2xx, an HTML/JSON body served with 200, and an empty body.
- **รายงานปัญหา**: a form (category + optional note; the note is required for "other", max 1000 characters) that inserts a row into the new `document_reports` table with the user's own session, carrying the document id, organization, vendor, total, status, source, validator warning codes and app version. The sheet closes only after the database accepted the row; a failure stays on screen with the text. A second identical open report (same document, reporter, category) is a unique violation, shown as "already reported".
- **Database** (`document_reports`): RLS on. A member may insert only as themselves, for a document of their own organization, with status `open`; a user can read only their own reports; nobody with a user JWT can update or delete. Privileges are narrowed to SELECT+INSERT for `authenticated`; the service role reads and triages. The existing `ocr_feedback` (OCR corrections for training) is not reused: it is a different thing.
- Reused the existing `ActivityShareSheet` (`Utils/ActivityShareSheet.swift`), extended with an optional `onFinish`, and added `ShareRequest` next to it.

## 3. Verified

- Host tests (Swift compiled with `swiftc`): file names and extensions, report validation and the inserted row (including that `status` is never sent and a blank note is left out), the categories match the migration's CHECK.
- `DocumentFileDownloader` run for real against a throwaway local HTTP server: normal file (name, bytes, location), no-extension file named from the content type, an earlier copy purged by the next download, an HTML error page with status 200 refused, 404 reported with its code, an empty body refused, an unreachable server, `discard` removes only its own folder and never anything outside `slippy-share`.
- Migration shape test (11 checks) and a full simulator build (`ios/scripts/build-simulator.sh`, BUILD SUCCEEDED).

## 4. Not verified

- The UI was not driven in the simulator: the document screen needs a signed-in session and real documents, and there is no fixture for it (adding one means editing `SlippyApp.swift`, which has unrelated uncommitted changes). Layout of the footer bar, the spinner, the report form and the share sheet is unseen.
- A real download from storage and a real share to LINE/Files/Photos on a device.
- The SQL of the migration has never been run (no Postgres here) and RLS has never been tried with a real member JWT. Check after applying: the catalog (table, index, both policies, privileges), then with a test account: a report is accepted, the same report twice answers "already reported", a report for another organization's document is refused.
- Nothing reads `document_reports` back into the app or notifies anyone. The team sees reports only through the database until a screen or notification is built (separate work).

## 5. Approval needed

1. ~~Apply the migration~~ done 2026-11-12 (it had to come before an iOS build with this change reaches users; it has).
2. Commit and push the files of this work.
3. iOS release (not part of this).
