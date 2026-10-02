# LINE OA

Status: **derived from code** (`api/src/routes/line.ts`, `web/src/lib/liff-auth.ts`, `web/src/app/api/liff/*`, `tools/line-rich-menu/`). Where this document and the code disagree, the code is right.

Slippy's LINE Official Account is two separate surfaces that share one account:

1. **The bot webhook** (`api/src/routes/line.ts`) — a chat interface: text commands, images/files for OCR, location, and postback buttons on Flex messages.
2. **LIFF mini-apps** (`web/src/app/liff/*`, backed by `web/src/app/api/liff/*`) — full web pages opened from LINE (rich menu, quick replies, or links) that call the same web API as the desktop app.

They share one identity table, `line_connections` (`line_user_id` ↔ `user_id` + `organization_id`), but authenticate completely differently — see *Authentication*.

## Webhook

`POST /line` (`lineRoutes` in `api/src/routes/line.ts`). Every request is verified with `x-line-signature`: HMAC-SHA256 of the raw body using `LINE_CHANNEL_SECRET`, compared with `crypto.timingSafeEqual`. An invalid or missing signature gets `400` immediately, before the body is touched.

**Reply before processing.** The handler responds `{ ok: true }` immediately, then processes `events` in the background (`Promise.allSettled`). LINE retries a webhook that does not answer within 10 seconds, and a retry would otherwise create duplicate records — this is why replying first matters.

### Event types

| Event | Handling |
|---|---|
| `follow` | Sends the welcome card with quick replies for menu, connect, help. |
| `join` (bot added to a group/room) | Greets and prompts `/linkgroup` (for sport groups) and `/connect`. |
| `message` / `location` | Requires a linked account. Resolves the LIFF places map URL and searches nearby places (internal vendors first, Google as fallback); replies with a Flex carousel. |
| `postback` | Routed by a `namespace:action[:id...]` string in `postback.data`. Namespaces seen: `sport` (join/leave a bill, group-link confirmation flow, a diagnostic `testshare`). |
| `message` / `image`, `message` / `file` (HEIC/PDF) | The OCR intake path — see below. Ignored when the source is a group/room, not a 1:1 chat, so a photo shared with friends does not trigger OCR for everyone. |
| `message` / `text` | Dispatched to one of the text commands below. |
| Anything else | Silently ignored. |

### Image/file intake (OCR via chat)

1. Require a linked account (`line_connections`), and that the organization's plan has `pricing_plans.feature_line_bot` (Starter and above).
2. **Idempotency:** skip if a document with this `message_id` in `source_meta` already exists for the organization — LINE's own retries land here as duplicates of the *webhook*, on top of the earlier reply-first behaviour.
3. Download the binary from `api-data.line.me` (not `api.line.me` — a separate host for binary content).
4. HEIC/HEIF → JPEG (`heic-convert`); then resize to at most 1200×1600 and re-encode as progressive JPEG at 80% quality (`sharp`) to save storage. Both steps fail soft: a conversion or compression error falls back to the previous buffer rather than failing the upload.
5. Upload to Supabase Storage at `<organization_id>/line_<message_id>.jpg`.
6. Increment the organization's document quota (`increment_doc_used`); if it is full, roll back the storage upload and reply with a quota warning **at most once per week per LINE user** (`line_connections.quota_warned_at`).
7. Insert a `documents` row (`source: "line"`, `source_meta: { line_user_id, message_id, file_name }`, `status: "pending"`).
8. Reply with an ack card, then call `ingestDocument()` — the same ingestion contract every channel uses (see [document-ingestion.md](document-ingestion.md)) — passing `lineUserId` so a worker-side completion can notify without re-querying the database. If ingestion runs inline (queue unreachable), this handler pushes the result itself, since the worker's completion hook never fires for an inline run.

### Text commands

Parsed as `cmd = text.split(" ")[0].toLowerCase()`, `parts = text.split(" ")`.

**Available before `/connect`:** `/connect CODE` only. Every other command below replies with a "connect your account first" message if `line_connections` has no row for this `line_user_id`.

**Account:**
- `/connect CODE` — redeems a `line_connection_tokens` row (must be unused and unexpired), fetches the LINE display name via the Profile API, upserts `line_connections`, marks the token used.

**Documents:**
- `/summary` — monthly spending overview.
- `/status` — recent documents list.
- `/approve DOCID` / `/reject DOCID` — only from `reviewing`; sets `approved` / `rejected`.
- `/retry DOCID` — resets to `pending` and re-ingests with `force: true` (a finished job already holds this document's normal id, so a plain retry would be silently de-duplicated by the queue).
- `/delete DOCID` — deletes a failed/rejected document.
- `/slip`, or the rich-menu button "📸 ส่งสลิป" — prompts the user to send a photo.

**Split bills:** `/split`, `/claim ID ITEM`, `/splitstatus ID`, `/splitdone ID` → `services/line-split.ts`.

**Medications:** `/meds` (alias "ยาวันนี้"), `/medtaken ID`, `/medskip ID`.

**Trip groups:** `/tripgroup` / `/trip` (alias "ทริป"), `/tripstatus ID`, `/trippay ID`, `/tripdone ID` → `services/line-trip.ts`.

**Sport groups:** `/sportgroup` / `/sport`, `/sportclub`, `/sportclubconcept NAME TEXT`, `/sportclubmap ID NAME`, `/sportsession`, `/sportstatus ID`, `/sportpay ID`, `/sportdone ID`, `/sportroster ID`, `/sportinvite`, `/linkgroup` (list linkable groups/sessions in this chat) → `services/line-sport.ts` and the `postback` `sport:*` actions above.

**Places:** `/food ID` — nearby food search.

**"Nova" intro:** `/ai`, "nova", "คุยกับ Nova 🤖", or a message starting with "สวัสดี nova" (case-insensitive). **Correction (2026-10-02):** this does not route to the real AI Assistant — it only sends one fixed, canned introduction with quick-reply buttons. See AI_ASSISTANT_SPEC.md. An earlier version of this document said it "routes to the chat assistant," which overstated what the code does.

**Help:** `/menu`, `/help`, "help", "เมนู", "menu" — the command menu card.

### Push notifications after extraction

`notifyLineAfterExtraction(documentId, organizationId, result, lineUserIdHint?)` is called from the pipeline once a `source: "line"` document finishes (or immediately, for an inline run). It re-reads the document (vendor, amounts, VAT, up to 8 line items) and pushes either a failure message or a full result Flex card with quick-reply actions. It refuses to push if the document's `source` is not `"line"`, or if no LINE user id is available from either the hint or `source_meta`.

## LIFF mini-apps

Pages under `web/src/app/liff/*` (home, scan, dashboard, split, trip, sport, places, health, community, friends, chat, profile, join, join/[token], test-share, trips/[token], sport/pay) call the matching route under `web/src/app/api/liff/*`. These run inside LINE's in-app browser via the LIFF SDK, not through the bot webhook.

### Authentication (`web/src/lib/liff-auth.ts`)

LIFF requests never trust a `lineUserId` the client claims:

1. The client sends `Authorization: Bearer <LIFF access token>`.
2. Next.js middleware verifies it against `https://api.line.me/v2/profile` and sets an internal header, `x-slippy-verified-line-user-id`; any client-supplied value for that header is stripped first.
3. `getVerifiedLineUserId(request, claimedLineUserId?)` reads the verified header and rejects the request if a claimed id is present and does not match it.
4. A mutation route that receives a `lineUserId` in its body or form must call `verifyClaimedLineUser()` and reject a mismatch — never read the client-supplied value directly.

**Public exceptions** (`web/src/middleware.ts`): `/api/liff/bill-info`, `/api/liff/join-split`, `/api/liff/join-trip`. These serve bill/join information to someone who may not be signed in yet; a request that *does* claim a LINE identity there is still verified before it can act as that user. A manual (non-LINE) join is stored as a non-LINE participant and must never be given a synthetic LINE user id.

## Rich menu

`tools/line-rich-menu/` holds `rich-menu-config.json` (a 2500×1686 image map with tap areas, each firing a `message` action such as "ส่งสลิป") and `upload-rich-menu.js` to push it to the LINE Messaging API. This is a one-off admin tool, not part of the request path.

## Configuration

| Variable | Effect |
|---|---|
| `LINE_CHANNEL_SECRET` | Webhook signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | Reply/push API calls, content download, profile lookup |
| `LIFF_ID` / `NEXT_PUBLIC_LIFF_ID` | Builds LIFF URLs (e.g. the Nearby Places map) |

## Known gaps

- This document does not enumerate every LIFF route's own business logic (split groups, sport sessions, trip settlements, etc.) — each is its own feature; see the relevant `SPEC.md` once written, or the route source directly.
- `services/line-split.ts`, `services/line-trip.ts`, `services/line-sport.ts`, and `services/line-flex.ts` (the Flex message builders) were not inventoried function-by-function here.
