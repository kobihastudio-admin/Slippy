# Split Bill

Status: **derived from code** (`api/src/services/line-split.ts`, `web/src/app/api/split/*`, `web/src/app/api/liff/join-split/route.ts`, `web/src/app/api/liff/split-groups/*`). Where this document and the code disagree, the code is right.

Splits one document's line items among several people. LINE, web/LIFF and iOS create the same kind of record (`split_bills`), with differences noted below.

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

## iOS receipt handoff and local friends (2026-10-15, local implementation)

- Document detail offers a split action after its line items load successfully. A failed fetch shows a retry action instead of silently starting an incomplete itemized split.
- The draft reuses the saved vendor, total, date and line items, retaining fractional quantities. It does not upload the image or run OCR again. Saving uses the existing `split_bills.document_id`; removing the source receipt from the draft clears that link.
- A single receipt's total can be corrected in the draft. Multiple receipts retain individually editable totals. Saving rejects non-finite/negative shares and shares that do not balance with the total. Equal shares distribute whole-satang remainders; valid percentage/item shares use largest-remainder rounding so final review and persistence use the same amounts.
- The participant picker supports manually added guests, optional manually entered LINE IDs, search/reuse/removal of device-local friends, and single-contact selection through Apple's Contacts picker. Only the selected display name is copied; phone numbers and the full address book are not retained or uploaded.
- Local friend records are Codable values with stable UUIDs stored in account-scoped UserDefaults. Deleting one does not alter saved bill participants. Names in existing bill records remain historical snapshots. No LINE API, account matching, automatic identity merge or cross-device friend sync is implemented; a later explicit account-linking feature must preserve those snapshots.
- Existing local OCR remains available from the split composer. This change adds no external OCR calls, database migrations, RLS changes or new backend endpoint.
- Verification scripts: `ios/scripts/verify-local-split-friends.swift` (compile with `ios/Slippy/Models/LocalSplitFriend.swift`) and `node ios/scripts/verify-receipt-split.mjs`. The latter compiles the production draft initializer and participant validation with UI/dependency stubs and checks handoff/persistence wiring; it is not a live database or Contacts UI test.
- Compile `ios/scripts/verify-split-amounts.swift` with `ios/Slippy/Models/SplitModels.swift` to verify equal-share remainders and balanced rounding of fractional shares.
- Device acceptance must cover receipt handoff, corrected total, equal/custom/item split validation, adding/reusing a local friend and manual LINE ID, Contacts selection/cancellation, and save/reopen. Build/install evidence is reported separately; no production bill is created by automated checks.
- Verification on 2026-10-15: signed iOS and Simulator builds succeeded (`/private/tmp/slippy-receipt-split-current-device.log`, `/private/tmp/slippy-receipt-split-current-simulator.log`). Local-friend and receipt-handoff scripts passed; amount checks covered 15 equal-share and 60 weighted-rounding cases plus invalid inputs. Existing item-photo, active-trip-member/history and image-frame checks also passed. Physical iPhone installation was rejected because the device was unavailable; actual Contacts interactions and authenticated save/reopen remain acceptance checks, not verified by these host tests. Changes are local/uncommitted; no production deployment or migration was performed.
- Simulator app installation succeeded after restarting the test service without erasing data. Subsequent app launch hung and was terminated; a delayed screenshot captured only the home screen, not Slippy. No Light/Dark rendering or Contacts interaction verification is claimed for this feature. Debug fixtures `SLIPPY_APPEARANCE_PREVIEW=split-receipt` and `split-friends` are available for a later UI verification run.
- Follow-up on 2026-10-15: the simulator subsequently launched both debug fixtures successfully. Inspected the receipt draft and local-friend picker in Light/Dark, with no clipped labels or overlapping form rows observed in these initial views. Screenshots: `/private/tmp/slippy-receipt-verified-light.png`, `/private/tmp/slippy-receipt-verified-dark.png`, `/private/tmp/slippy-friends-verified-light.png`, `/private/tmp/slippy-friends-verified-dark.png`. This supersedes the initial rendering blocker above, but not the outstanding real Contacts selection/cancellation and authenticated save/reopen checks. Physical iPhone remains unavailable; no production records, deployments, commits or pushes were made.
- Added `SlippyUITests` through the existing XcodeGen specification, with `SplitFlowUITests.swift` exercising the real document split action via a preloaded DEBUG document, local-friend save/relaunch/select/delete, and Contacts presentation/cancellation. Preview launch skips the outer live auth initialization and document server queries. Test friends use the separate `preview-uitest` key; no test taps financial submission. Contact selection is explicitly skipped when the picker exposes no selectable contacts, without creating or synchronizing address-book data.
- The initial UI run confirmed the document-to-draft handoff, but found Contacts cancellation closing the enclosing friend sheet. The picker now presents from a dedicated UIKit host inside the SwiftUI sheet; its automatic dismissal is isolated from the friend editor. Added a keyboard-dismiss control for numeric fields/search and adjusted selection/deletion tests to operate after dismissing the keyboard.
- Item-mode allocation now uses actual paid totals rather than adding guessed VAT: inclusive tax, tax-exclusive totals, discounts and other charges are apportioned by item-price weights. Receipt rows, summaries and persistence share the same rounded per-receipt amounts. Five allocation cases passed alongside the 15 equal-share and 60 weighted-rounding cases.
- Final UI regression on 2026-10-15: `TEST SUCCEEDED`, 4 tests executed, 3 passed, 1 explicitly skipped, 0 failures. Passed: real document action opens the correct draft; local guest name/LINE ID survive relaunch, can be selected and deleted; Contacts can be opened/cancelled/reopened without dismissing the friend editor. The optional selection test skipped because the simulator picker exposed no selectable contact. Evidence: `/private/tmp/slippy-split-ui-acceptance.log` and `/private/tmp/slippy-split-ui-acceptance.xcresult`. Signed current-source device build also succeeded (`/private/tmp/slippy-split-delivery-device.log`). Real contact selection and authenticated financial save/reopen remain pending device acceptance; no production financial records were created, and no commit/push/deployment was performed.
- Additional offline persistence regression on 2026-10-15: `node ios/scripts/verify-split-persistence.mjs` PASS. Compiles the actual `SplitViewModel` and Codable models, replacing only the database transport with an in-memory store. Verifies receipt provenance, parent totals/creator/organization, guest snapshots and rounded amounts after reopening, distinct populated organizations, manual bills without document links, no LINE/contact fields in participant payloads, empty insert results, and write/read error propagation. This is a client payload/decoding contract test, not actual PostgREST, authentication, server persistence or RLS verification. It reads no credentials and makes no network calls or production records; real authenticated save/reopen remains pending.

## Known gaps

### 2026-10-17 iPhone UI Verification

- User acceptance: the user confirmed real Contacts selection and successful bill save/reopen on 2026-10-17, then explicitly authorized commit, push and PR for native Google Maps and the redesigned split composer. This supersedes the pending user-acceptance note below; no extra production test records were created by the agent.

- Physical-device suite `/private/tmp/slippy-physical-acceptance-20261017.log` and `.xcresult`: TEST SUCCEEDED, 5 tests, 0 failures (including two map cases).
- Split cases passed existing receipt-to-draft handoff, complete line visibility including repeated names, selected-item assignment to friends, explicit inclusive/exclusive VAT calculations and progression to review in Light/Dark. Corrected whole-control scrolling/tap synchronization is now verified on device. Inspected the exported VAT screenshot: selected total 100, included VAT 6.54 and net 93.46 at explicitly entered 7 percent.
- No production financial records were created. Actual authenticated save/reopen and selection of a real Contact remain user acceptance checks, not results implied by these synthetic tests. Existing separate parent/participant writes remain non-atomic as documented below.

- Existing iOS `SplitViewModel.createBill` writes the parent bill and participants separately. Participant insertion failure is propagated, but the inserted parent may remain. The offline regression preserves and documents this behavior; it does not claim atomic writes. No transaction/RPC, compensating financial deletion or security/schema change was introduced as part of this verification.

- ~~`DELETE /api/split` does not verify the caller is the bill's creator~~ — **correction (2026-09-27): this is not a gap.** The route uses the RLS-bound client, and `split_bills`' `split_bills_delete` policy already restricts `DELETE` to `creator_id = auth.uid()`. An earlier version of this document flagged this as an unchecked deletion without verifying whether RLS covered it; it does.
- The web (`POST /api/split`) and LINE (`handleSplitCommand`) creation paths compute participants' amounts differently: the web caller supplies amounts up front, while LINE derives them from claims and VAT apportionment at `/splitstatus` time. A bill created on the web never gets automatic per-item claiming unless someone runs `/splitstatus` on it, which needs the document id, not the bill id.
- `category` on `split_bills` distinguishes at least `general` from a sport-session category (see SPORT_GROUPS_LINE.md); the full set of values and what changes per category was not enumerated here.
- ~~`creator_id` type mismatch breaks `/split` on LINE~~ — **fixed (2026-09-27).** `creator_id` is `uuid`, `REFERENCES users(id)` (`015_split_bills.sql`); `handleSplitCommand` was inserting the raw LINE user id string, which is neither a UUID nor a row in `users`, and its error was discarded, so `/split` always failed silently. It now takes the caller's own resolved `line_connections.user_id` as `creatorUserId` and logs the insert error instead of swallowing it — the `split_participants` row still records the LINE identity separately via its own `line_user_id` (a `text` column, unaffected).
- `expense_splits` is a **different feature**: it holds each trip participant's share of a `trip_expenses` row (see `060_trip_expense_split_modes.sql`), not a split bill. Do not confuse the two when searching the schema.
