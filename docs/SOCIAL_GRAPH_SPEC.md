# Social Graph

## iOS Friend Management (D-073, 2026-10-17)

User acceptance 2026-10-17: the user confirmed the new friend-management screen works and explicitly authorized its commit, push and separate PR. This supersedes the pending user-acceptance status in the implementation evidence below; no additional production friendship mutations were made by the agent.

The More menu exposes **จัดการเพื่อน**. One searchable list filters all, in-system and external friends. In-system profiles and relationship IDs reuse `SocialViewModel` and existing friendship queries/removal; adding and request handling link to the existing Social screen. No new server endpoint, schema or RLS policy is introduced.

External friends reuse the account-isolated `LocalSplitFriendStore`, shared with the split composer. Add/edit preserves UUID on updates; removal does not mutate historical bill participant snapshots. Selected Contacts copy only the chosen display name. Names are required; manual LINE IDs are optional contact notes, not verified account links. Missing email, LINE or delivery channels stay blank. The screen neither registers nor sends notifications or messages.

Implementation checks: local storage regression `ios/scripts/verify-friend-management.swift` covers identity preservation, trimming, empty-name rejection, account isolation and deletion. UI regression `testFriendManagementLocalEditAndChannels` uses an isolated synthetic account and covers blank channel fields, add/edit/reopen and type filtering. Signed build and actual UI evidence are recorded after execution; authenticated friendship changes are not performed automatically against production.

Verification 2026-10-17: local-store regression PASS; signed device build `/private/tmp/slippy-friend-management-device-final.log` BUILD SUCCEEDED. Simulator `/private/tmp/slippy-friends-management-ui.log` and `.xcresult` TEST SUCCEEDED, 2 tests, 0 failures (management add/edit/reopen/filter/blank channels and existing split friend reuse). Inspected exported screenshot `/private/tmp/slippy-friends-management-images/1FD693E4-8E50-4951-930F-6C06A1777F77.png`: unavailable channels remain blank with legible labels. App installed on iPhone, installation suffix `095A8768-71BE-42FA-826F-0B27D2513ABA`. Actual authenticated in-system friend removal/addition and user acceptance of this new screen remain pending. No production friendship mutation was used in verification. Changes remain local and uncommitted.

Status: **derived from code** (`web/src/app/api/friends/*`, `web/src/app/api/social/*`, `web/src/app/api/liff/community/*`), plus a read-only check of `friendships`' RLS policies. Where this document and the code disagree, the code is right. Human-to-human chat (`conversations`/`messages`) is a separate feature covered where it is used (trip chat in JOURNEY_MODULE_SPEC.md, LIFF friend chat in LINE_OA_SPEC.md) and not repeated here.

Three largely independent sub-graphs share the "social" label: **friends** (mutual, request-based), **follows** (one-directional, feed-driving), and **community groups** (LIFF-only, LINE-group-linked). A fourth area — creator profiles and product/receipt-linked posts — exists only in the schema with no code wired to it yet.

## Friends (`friendships`, mutual, request-based)

- **`GET /api/friends`** — returns accepted friends (resolved to whichever side of the row isn't the caller), requests received (`pending`, `addressee_id = me`), and requests sent (`pending`, `requester_id = me`).
- **`POST /api/friends`** — send a request (`{ addresseeId, source }`); inserts `status: "pending"` (the column's default). No check here that a request (in either direction) doesn't already exist, or that `addresseeId !== self` — see *Known gaps*.
- **`PATCH /api/friends/[id]`** — `accept` and `decline` both scope the update/delete to `addressee_id = caller`, so only the recipient can act on a pending request. **`block` does not** — it updates by `id` alone, with no check that the caller is either party to that friendship. See *Known gaps*.
- **`DELETE /api/friends/[id]`** — unfriend; scoped to either party (`requester_id = caller OR addressee_id = caller`).
- **`GET /api/friends/search?q=`** — looks up users by name/phone/email (admin client, bypasses RLS by necessity — this is a cross-user search), excludes the caller, and masks the result's contact info (`081***89`, `ab***@domain`) rather than returning it in full.
- **`GET /api/friends/invite`** — returns the caller's own active invite link (`friend_invite_links`), creating one if none is unexpired; the public join flow it feeds into was not traced here.

Three of these four routes use the admin (service-role) client, so **RLS on `friendships` is not what protects them** — the route code is the only enforcement. `friendships` does have RLS (`friendships_participant_update`/`_delete`: `requester_id = auth.uid() OR addressee_id = auth.uid()`), but it is irrelevant to these routes since the admin client bypasses it; it would only matter for a client-side query that used the regular client instead.

## Follows (`social_follows`, one-directional)

`POST`/`DELETE /api/social/follow` (`{ targetUserId }`) — both use the **regular, RLS-bound** client. Following yourself is rejected explicitly (`400`) before the upsert. A follow is an upsert (idempotent — following twice does nothing extra); counts are maintained via `increment_follow_counts`/`decrement_follow_counts` RPCs rather than computed on read.

## Feed and posts (`posts`)

- **`GET /api/social/posts`** — all published posts (`is_published = true`), newest first, cursor-paginated by `created_at` (page size 20, fetches 21 to detect `hasMore`).
- **`GET /api/social/feed`** — the same shape, but scoped to authors the caller follows (via `social_follows`); the fallback behaviour when a user follows no one was not traced in this pass.
- Post `type` is one of `"protocol" | "review" | "challenge" | "stack"` — a wellness/health-tracking vocabulary, not a generic caption. Posts carry `media_urls` and `receipt_ids` (so a post can reference the user's own scanned receipts) and maintain `likes_count`/`comments_count`/`saves_count` as denormalised counters.
- Both routes use the regular client; RLS presumably enforces `is_published` / ownership on write, not independently verified here.

## Community groups (LIFF-only)

`GET/POST /api/liff/community` and `GET/PATCH /api/liff/community/[id]` operate on `community_groups`/`community_members`, resolved from a LINE user via `line_connections` (same identity-resolution pattern as elsewhere — see LINE_OA_SPEC.md). **There is no web-dashboard route or page for this feature** — community groups are reachable only through the LIFF mini-app, not `/social` on the main site.

## Schema-only, not yet wired to any route

`creator_profiles`, `post_product_links`, `post_receipt_links` exist in the database but no `web/src` route or page references any of them in this pass. They likely belong to a Creator Economy feature (see CREATOR_ECONOMY_SPEC.md, itself unwritten) rather than this one; do not assume they are live just because they're in the schema.

## Known gaps

- **`/api/friends/[id]` `block` has no participant check** — any authenticated caller who knows a friendship's `id` can set it to `blocked`, regardless of whether they are the requester or addressee. `accept`/`decline` on the same file get this right (`.eq("addressee_id", user.id)`); `block` is missing the equivalent `.or(...)` that `DELETE` already uses. The route uses the admin client, so RLS does not save it the way it saved `DELETE /api/split` (see SPLIT_BILL_SPEC.md) — this one is real. Not fixed here; flagged for a decision.
- `POST /api/friends` relies entirely on the database to reject bad requests, not the application layer: `friendships_check` (`requester_id <> addressee_id`) blocks a self-request, and `UNIQUE (requester_id, addressee_id)` blocks sending the *same-direction* request twice. Neither constraint stops **both sides requesting each other** (A→B pending, then B→A pending) — that produces two rows for one pair rather than either reusing or rejecting the second. The route surfaces the resulting DB error as a generic `400`, so a repeat request currently fails with no clearer message than any other bad insert.
- The public invite-link join flow (`friend_invite_links` → presumably `/friends/join/[token]`) was not traced past where the token is issued.
