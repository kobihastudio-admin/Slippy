# Opt-in sync of slips and files from LINE groups

Status: DRAFT SPEC for user review. Not an implementation plan.
Date: 2026-11-09 (Asia/Bangkok).
Traces to: user request "สร้างความสามารถสำหรับ sync chat จาก LINE โดยเลือกกลุ่มที่ต้องการ sync ได้" (2026-11-09); D-077.
Governance note: this is a NEW_WORKSTREAM (🟠). It needs a schema/RLS migration, a webhook change that is deployed to the NAS by the user, and a production-visible bot announcement. Schema/RLS/security, provider/credentials, production writes, deploy and Git mutations are separately gated by D-077; this spec approves none of them. It does not edit the governance repository.

## 1. Understanding (confirmed with the user)

- The user wants chat from LINE groups to reach Slippy, **choosing which groups** are synced.
- Purpose (user's answer): pull in **only what carries value — slips, appointments, photos, amounts** — not whole conversations.
- Approach approved (user): choose groups **with commands typed in the LINE group**; manage only through LINE commands in the first increment (no web or iOS screen yet).
- Success: a Slippy user who typed `/syncgroup` in a LINE group sees the slips/images/PDFs **they** post in that group appear as their own Slippy documents, processed by the existing slip pipeline; nobody else's content is read or stored; `/stopsync` stops it immediately; the group is told what is happening.

## 2. What exists today (verified in code 2026-11-09)

- `api/src/routes/line.ts`: webhook with `x-line-signature` verification. On `join` the bot greets and offers `/linkgroup` and `/connect`. Text commands (`/linkgroup`, `/connect`, …) are handled in the same file.
- `line_connections(line_user_id UNIQUE, user_id, organization_id, display_name)` maps a LINE user to a Slippy user and organization.
- Images/files are processed only in 1:1 chats with the bot. In groups/rooms they are ignored on purpose (line.ts ~281: "shouldn't trigger OCR for everyone in the group").
- The 1:1 slip path: plan check (`pricing_plans.feature_line_bot`), idempotency by `source_meta.message_id`, LINE CDN download, HEIC→JPEG, compression, storage upload, quota check, `documents` insert with `status: pending`, then **`replyMsg(replyToken, …)`** with an acknowledgement card. Errors are sent with `pushMsg(lineUserId, …)` or `replyMsg`.
- Not possible (to be confirmed against LINE documentation before implementation): history before the bot joined; listing the groups a bot is in. The bot learns about a group only from events it receives.

## 3. Design

### 3.1 Consent model: per user, per group

- Opt-in is individual. `/syncgroup` typed in a group by a user who has connected their LINE account to Slippy means: "process the images and files **I** post in **this** group into **my** Slippy documents". Another member must opt in separately for their own posts.
- Content from anyone who has not opted in (including people with no Slippy account) is never downloaded, parsed, stored or logged beyond the event's technical fields needed to ignore it.
- Text messages are never stored by this feature (only the command text is read).

### 3.2 Commands (in a LINE group or room, from a connected user)

- `/syncgroup` — enable for me in this group. Requires a `line_connections` row for the sender, otherwise the bot replies privately "ยังไม่เชื่อมบัญชี … /connect ก่อน". The bot then **announces in the group**: "<ชื่อ> เปิดซิงก์สลิป/รูป/ไฟล์ที่ <ชื่อ> ส่งในกลุ่มนี้เข้า Slippy ของตัวเอง — ข้อความแชทไม่ถูกเก็บ และคนอื่นไม่ได้รับผลกระทบ พิมพ์ /stopsync เพื่อหยุด".
- `/stopsync` — disable for me in this group; the bot confirms in the group.
- `/syncstatus` — the bot replies **privately to the sender** with the groups they currently sync (name when known) and how to stop.
- These commands in a 1:1 chat reply "คำสั่งนี้ใช้ในกลุ่ม LINE เท่านั้น".
- The `join` greeting gains one line mentioning `/syncgroup`; the existing `/linkgroup` and `/connect` behavior is unchanged.

### 3.3 Webhook behavior for images/files in a group

- Today: ignored. After: if `source.type` is `group` or `room` and the sender (`source.userId`) has an **enabled** row in `line_synced_groups` for this `groupId/roomId`, run the existing 1:1 slip path with these differences:
  1. Attribution: use the sender's own `line_connections` row (their user and organization); the plan check, quota check and idempotency key (`message_id`) are the sender's, exactly as for 1:1.
  2. **No messages are posted into the group.** The acknowledgement card and every error go to the sender privately with `pushMsg(lineUserId, …)`, never `replyMsg` to the group. (The reply token of a group event would otherwise post into the group.)
  3. `source_meta` additionally records `line_group_id` (or room id) so the origin is visible.
- If the sender has not opted in, or the event has no `source.userId`, the event is ignored silently, as today.
- File types and size limits are unchanged (JPG/PNG, HEIC, PDF). Unsupported files in a group are ignored silently (no "❌ ไฟล์ประเภทนี้ยังไม่รองรับ" reply into a group).

### 3.4 Data model (migration — gated)

- New table `line_synced_groups`:
  - `id uuid pk`, `user_id uuid not null references users`, `line_group_id text not null` (group or room id), `group_name text null`, `enabled boolean not null default true`, `created_at`, `updated_at`; unique `(user_id, line_group_id)`.
- RLS enabled: a user may `select` their own rows; all writes come from the webhook with the service role. No policy exposes another user's rows or group ids.
- Group name is optional and best-effort (read with the bot's existing token where the LINE API allows it); failure to read it never blocks enabling.
- No change to `documents`, `line_connections` or storage buckets.

### 3.5 What is explicitly deferred (next increments)

- Appointments and amounts read from **text**: they require interpreting message text (an LLM/provider decision, gated) and would mean reading text from the group. Not in this increment.
- A web/iOS screen listing synced groups with toggles; per-group category rules; syncing a LINE group to a trip/split bill.

## 4. Non-Goals

- Storing or mirroring chat history; reading other members' messages; reading messages before the user opted in; synced history before the bot joined.
- Replying into groups other than the one-time announcements in 3.2.
- Sending anything from Slippy back to the LINE group.
- New LINE channel/credentials, a new bot, LIFF changes.
- Any iOS or web UI in this increment.

## 5. Verification

- Pure decision logic, tested without network: a function that classifies a webhook event (`ignore`, `command: sync|stop|status`, `process-slip`) from `(source, message, opted-in set, connected set)`; table-driven tests covering: 1:1 vs group vs room, missing `source.userId`, opted-in vs not, disabled row, unconnected sender, non-image messages, command variants (`/syncgroup`, extra spaces, uppercase, wrong chat type).
- Existing 1:1 slip behavior is not regressed: its handler is reused, and a test asserts the 1:1 path still replies via `replyMsg` while the group path uses `pushMsg` only (or the plan's equivalent stub-based check).
- Migration SQL is reviewed and applied only after explicit approval; RLS is checked with the same style of check used for other tables (a user cannot read another user's row).
- Webhook signature verification stays unchanged and is not bypassed in tests.
- Not claimed unless actually done: real behavior inside a LINE group (needs the real bot and real group), the production migration, the NAS deploy of `api` (the user runs the docker build), `source.userId` availability for members who have not added the bot as a friend (see 7), PDPA/consent adequacy.

## 6. Acceptance Criteria

- [ ] `/syncgroup` by a connected user creates/enables only their own `(user, group)` row and announces it in the group; by an unconnected user it replies privately and creates nothing.
- [ ] After opt-in, an image/PDF posted by that user in that group becomes their `documents` row (status `pending`, `source_meta` with the group id); the same message processed twice creates one document.
- [ ] An image from a member who has not opted in, or whose event has no `source.userId`, is not downloaded or stored.
- [ ] The group never receives an OCR acknowledgement or an error message; the sender receives them privately.
- [ ] `/stopsync` stops processing at once; `/syncstatus` answers only the sender, privately.
- [ ] 1:1 slip handling and `/linkgroup`/`/connect` are unchanged.
- [ ] Only the gated items listed in the governance note are touched, each after its own approval; no commit/push/deploy without separate approval.

## 7. Risks and Open Points

- **Sender identity in groups.** LINE may omit `source.userId` for group members who have not added the Official Account as a friend. If so, those members cannot be attributed and their images stay ignored; a connected user would need to add the bot as a friend first. To be confirmed in LINE's documentation and with a real test before relying on it.
- **Privacy / PDPA.** Even with individual opt-in, the bot sits in a group with people who did not choose it. The announcement is the mitigation; whether it is sufficient for the user's context is the user's decision, not this spec's.
- **Spam and cost.** A synced group can flood the pipeline (each image costs storage, OCR and plan quota). Existing plan and quota checks apply per sender; no extra rate limit is added here — decide in the plan if one is needed.
- **Non-slip images.** Photos of food or friends in a synced group will also be ingested as documents (the user asked for photos too). A later increment may add a classifier or a "slips only" switch.
- **Command trust.** `/syncgroup` is honored only from the sender's own LINE user id as reported in the signed webhook event; no one can enable sync for someone else.
- **Deploy.** The webhook change reaches users only after the user rebuilds and deploys `api` on the NAS; the migration must be applied first.
- Sequencing: queued behind the LINE invite-to-app increment (`2026-11-09-line-invite-open-in-app-design.md`) unless the user reorders; the D-077 reorder note still stands.

## 8. Planning amendments (2026-11-09, from `plans/2026-11-09-line-group-sync.md`)

- Status: the user asked for the plan after reading this spec, so it was treated as approved for planning. Migration apply, deploy, real-group test and commit remain separately gated.
- `/syncgroup` when already on and `/stopsync` when already off answer the sender privately and do not post in the group (stops a member spamming the group by repeating the command).
- `/syncgroup` enables, then announces; if the announcement fails (`replyMsg` now returns `Promise<boolean>`) sync is switched back off and the sender told privately. Sync never runs unannounced.
- If the opt-in lookup fails, the sender is treated as not opted in.
- No new rate limiter; the plan check and `increment_doc_used` quota run before any OCR.
- Pre-existing, not changed, needs a decision: (P1) the bot already replies in any group to unrecognised text and to a connected user's sticker; (P2) the 1:1 path stores PDFs labelled as JPG; (P3) `source.userId` may be missing for some group members; (P4) private pushes need the user to have added the bot.
- **Post-review change (implemented):** the opt-in is keyed on the LINE sender, not the Slippy user. `line_connections.user_id` is not unique (several LINE accounts can share one user), so `line_synced_groups` carries `line_user_id text NOT NULL` with `UNIQUE (line_user_id, line_group_id)`; `user_id` stays for RLS and attribution. A thrown announcement (network error) is treated like a failed one: sync is switched back off.
