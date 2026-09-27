# Split Bill

Status: **derived from code** (`api/src/services/line-split.ts`, `web/src/app/api/split/*`, `web/src/app/api/liff/join-split/route.ts`, `web/src/app/api/liff/split-groups/*`). Where this document and the code disagree, the code is right.

Splits one document's line items among several people. There are **two entry points that create the same kind of record** (`split_bills`), one from the LINE bot and one from the web/LIFF app, and they diverge in a few places noted below.

## Data model

- **`split_bills`**: `organization_id`, `creator_id` (a LINE user id for a bot-created bill, a system `user_id` for a web-created one — the column holds either), `document_id` (nullable), `title`, `total_amount`, `vat_amount`, `note`, `line_group_id`, `share_token`, `promptpay_id`, `category` (`general` is used by the QR/payment-request path; sport bills use their own category — see SPORT_GROUPS_LINE.md), `status` (`open` → `finalized`).
- **`split_participants`**: `split_bill_id`, `name`, `email`, `line_user_id`, `line_display`, `is_non_line`, `amount`, `paid_at`.
- **`split_item_claims`**: one row per `(split_bill_id, line_item_id)` — a claim is an upsert, so re-claiming an item just changes who owns it; `claimer_name`, `claimer_line_id`, `participant_id`.
- Items come from the source document's `document_line_items`; the split never copies or duplicates them.

## Creating a bill

### From LINE (`/split DOCID`, `handleSplitCommand` in `line-split.ts`)

1. Find a document owned by the organization whose id starts with `DOCID` and whose status is `reviewing`, `approved` or `pushed` (not `pending`/`processing`/`rejected`).
2. Require the document to have at least one line item.
3. Insert `split_bills` with `creator_id` = the LINE user id, `status: "open"`.
4. Auto-add the creator as the first `split_participants` row, `amount: 0`.
5. Reply with an interactive Flex card listing every line item, unclaimed, plus a share link `${APP_URL}/split/join/<share_token>` for anyone without the bot.

### From the web app (`POST /api/split`)

1. Requires a signed-in user; `creator_id` = the system `user_id`.
2. Takes an explicit `participants[]` array with names and amounts already computed — the web flow does not build the per-item claim state the way the LINE flow does.
3. Optional `lineGroupId`: when a bill is created from a linked LINE group, the API best-effort notifies the Fastify `/split/notify` endpoint (`x-internal-key`) so the group hears about it; a failed notify is swallowed, never surfaces to the creator.

## Claiming items

Three separate code paths write to `split_item_claims`, and they differ in trust level:

| Path | Caller | Participant creation | Trust |
|---|---|---|---|
| `/claim BILLID INDEX` (LINE) | `handleClaimCommand` | Creates a `split_participants` row for the LINE user if none exists | LINE user id comes from the verified webhook event |
| `POST /api/split/[id]/claim` (web/LIFF) | anyone with the link | `isNonLine: true` creates a participant flagged `is_non_line`, looked up/created by **name**, not identity | **Unauthenticated by design** — this is the public join page for people without a Slippy account; `claimerName` is trusted as given |
| `DELETE /api/split/[id]/claim` | same route | — removes a claim by `(split_bill_id, line_item_id, claimer_name)` | same as above |

A claim is idempotent per item (`onConflict: split_bill_id,line_item_id`) — claiming an already-claimed item reassigns it rather than erroring.

## Status and settlement

`/splitstatus BILLID` and `/splitdone BILLID` both call `handleSplitStatus(billIdPrefix, finalize)`:

1. Load the bill's line items and claims.
2. Group claimed items by claimer (`line_user_id` if present, else name); every unclaimed item is listed separately, not silently dropped.
3. VAT is apportioned **proportionally**: `vatRate = bill.vat_amount / bill.total_amount`, applied to each person's item subtotal — not divided evenly.
4. Write each participant's `amount = subtotal * (1 + vatRate)` back to `split_participants`.
5. `finalize = true` (i.e. `/splitdone`) sets `split_bills.status = "finalized"`. A finalized bill can still be viewed, but the public join API (`POST /api/liff/join-split`) refuses further changes to it (`400 Bill is finalized`).

The web app also supports marking a participant paid directly (`PATCH /api/split`, sets `paid_at`) — a manual settlement step independent of the claim/VAT calculation above.

## Payment collection (PromptPay)

`POST /api/liff/split-groups/[id]/send-qr` (category `general` bills only): generates a PromptPay QR (`lib/promptpay.ts`) for the bill's `promptpay_id` and the participant's `amount`, then posts it as a message into a direct conversation between the bill's creator and that participant (creating the conversation if it does not already exist). This requires the participant to be a LINE-identity-verified system user — it is not the public join flow.

## Joining without the bot

`web/src/app/(app)/split/join/[token]/page.tsx` — a public page keyed by `split_bills.share_token`. It reads the bill, its participants and the source document's line items with the admin client (no auth), and renders `SplitJoinClient`, which calls the claim API above.

`POST /api/liff/join-split` (one of the three routes the web middleware exempts from LIFF authentication — see LINE_OA_SPEC.md) is a different, broader join endpoint shared with sport-group rosters (`isRegistrationClosed`, `rebalance` from `../sport-groups/_lib`); it looks up the bill by `share_token`, rejects a `finalized` bill, and best-effort pushes a roster-update card back into the bill's LINE group if one is linked.

## Deleting a bill

`DELETE /api/split` removes the `split_bills` row outright (web app, signed-in creator only in intent — the route itself does not check `creator_id` against the caller, see *Known gaps*). There is no LINE-side delete command.

## Known gaps

- ~~`DELETE /api/split` does not verify the caller is the bill's creator~~ — **correction (2026-09-27): this is not a gap.** The route uses the RLS-bound client, and `split_bills`' `split_bills_delete` policy already restricts `DELETE` to `creator_id = auth.uid()`. An earlier version of this document flagged this as an unchecked deletion without verifying whether RLS covered it; it does.
- The web (`POST /api/split`) and LINE (`handleSplitCommand`) creation paths compute participants' amounts differently: the web caller supplies amounts up front, while LINE derives them from claims and VAT apportionment at `/splitstatus` time. A bill created on the web never gets automatic per-item claiming unless someone runs `/splitstatus` on it, which needs the document id, not the bill id.
- `category` on `split_bills` distinguishes at least `general` from a sport-session category (see SPORT_GROUPS_LINE.md); the full set of values and what changes per category was not enumerated here.
- ~~`creator_id` type mismatch breaks `/split` on LINE~~ — **fixed (2026-09-27).** `creator_id` is `uuid`, `REFERENCES users(id)` (`015_split_bills.sql`); `handleSplitCommand` was inserting the raw LINE user id string, which is neither a UUID nor a row in `users`, and its error was discarded, so `/split` always failed silently. It now takes the caller's own resolved `line_connections.user_id` as `creatorUserId` and logs the insert error instead of swallowing it — the `split_participants` row still records the LINE identity separately via its own `line_user_id` (a `text` column, unaffected).
- `expense_splits` is a **different feature**: it holds each trip participant's share of a `trip_expenses` row (see `060_trip_expense_split_modes.sql`), not a split bill. Do not confuse the two when searching the schema.
