# One person across chat, bills, sport sessions and trips — and "ยอดค้าง" with each friend

Status: DRAFT SPEC for user review. Not an implementation plan.
Date: 2026-11-09 (Asia/Bangkok).
Traces to: user request "ออกแบบการใช้งานร่วมกับระบบหารบิลและการร่วมกิจกรรมเพื่อหารและคำนวณค่าใช้จ่าย ให้ทำงานสอดคล้องกันทั้งระบบ รวมถึงคำนึงเรื่อง User Friendly" (2026-11-09); D-077.
Governance note: SCOPE_EXPANSION / architectural. It needs a schema migration and a new SECURITY DEFINER function (security-model change) and reads Trip data while the Trip contract is still open. Schema/RLS/security, production writes, deploy and Git mutations are separately gated by D-077; this spec approves none of them. It does not edit the governance repository.

## 1. Understanding (confirmed with the user)

- The user wants chat, friends, bill splitting, sport sessions ("นัดกีฬา") and trips ("ทริป") to work together coherently, with expense sharing and calculation, and to be user friendly.
- First increment (user's choice): **make the same real person the same everywhere, and add a "ยอดค้าง" (balance) view between me and each friend.** Not first: the chat money-request flow, and unifying the calculation engines.
- Success: for any accepted friend, a user can see in one place who owes whom and how much across bills, sport sessions, trips and standalone payment requests, understand where the number comes from, and reach it from the friends list and from the 1:1 chat. Where the system cannot know, it says so instead of guessing.

## 2. What exists today (verified in code 2026-11-09)

- **Bills and sport sessions** are one engine: `split_bills` + `split_participants` (name, email, `amount`, `paid_at`, optional `line_user_id`, guests via `added_by_participant_id`), item claims, receipts (`split_bill_receipts.paid_by_participant_id`), `category='sport'` for sport sessions (flat fee split evenly; `sport_groups` for recurring clubs). `split_participants` has **no `user_id`**; the iOS bill flow picks people from a device-only address book (`LocalSplitFriend`), not from social friends.
- **Trips** are a separate engine: `trip_participants` (**has `user_id`**), `trip_expenses` (`paid_by_id`, split modes equal/individual/percent/shares/exclude), `expense_splits`, `trip_payments` (pending/confirmed/disputed), a SQL function that returns the minimum set of transfers (from → to → amount), and `web/src/lib/trip-settlement.ts`. Friends can already be added to a trip (`add_friend_to_trip`).
- **Payment requests** (`payment_requests`): PromptPay QR, requester/payer users, optional `conversation_id` and `split_bill_id`, status pending/paid/expired/cancelled. `messages.msg_type` already allows `payment_request`, `slip`, `system`; the iOS chat room shows non-text messages only as a placeholder.
- **Access rules differ:** bills/participants/receipts are readable by **organization members**; trip data is readable by **trip participants**. A friend in another organization cannot read my bill through RLS.
- **`friendships.source`** already allows `split_activity` and `trip_activity`.
- Split calculation exists in at least four places (web trip-settlement TS, the trip SQL function, `api/src/services/line-split.ts`, iOS split code). They were not diffed for this spec.

## 3. Problems this increment addresses

1. The same person is several different things: a bill participant (a name), a trip participant (a user), a friend (a user), a LINE id.
2. There is no per-friend view of what is owed across features.
3. Social friends cannot be used when creating a bill on iOS.

## 4. Design

### 4.1 One identity: `users.id`

- A participant is linked to a person by `user_id`. `trip_participants.user_id` exists; add a nullable `split_participants.user_id references users(id) on delete set null`.
- Links are set in three ways, never by name matching:
  1. **Friend picker:** when a bill or sport session is created on iOS, "เลือกเพื่อน" lists accepted social friends first (the device address book stays as a second tab for people who are not on Slippy). Choosing a friend sets `user_id`.
  2. **LINE:** a participant with `line_user_id` that matches a `line_connections` row gets that row's `user_id`.
  3. **Backfill** of existing participants runs only for the unambiguous case (2). Name-only guests stay guests.
- Guests (no `user_id`) keep working exactly as today and do not appear in friend balances; they stay visible inside their bill.
- Linking never changes amounts, shares or who is on the bill.

### 4.2 Balance rules ("ยอดค้าง")

A pair-wise balance between me and one friend is the sum of four kinds of rows, each with its own stated rule. A row that cannot be attributed is **not guessed**; it is counted in an "unattributed" bucket and shown as such.

- **Bills and sport sessions.** For a bill, the payer is the single `paid_by_participant_id` shared by all its receipts. If the bill has no receipts and is a sport session, the payer is the creator (the host books and pays the court). Every other participant who is linked to a user and whose `paid_at` is null owes their `amount` to the payer. Bills with several different payers, or no determinable payer, are unattributed.
- **Trips.** Use the existing minimum-transfer settlement output (from → to → amount) mapped to users through `trip_participants.user_id`, exactly as the trip screens show it. This spec does not recompute trip settlement. (To be verified in the plan: whether that output already nets confirmed `trip_payments`; if not, only pending/unconfirmed transfers count.)
- **Standalone payment requests.** `payment_requests` with `split_bill_id` null and status `pending` between the two users. Requests that carry a `split_bill_id` are **not** counted again (the bill is the debt; the request is only a way to pay it).
- **Currency.** All amounts are THB as stored. Rows in another currency are unattributed.
- Counterpart view is the mirror: what I owe is what they are owed. Net per friend = sum(they owe me) − sum(I owe them), shown with the breakdown, never only the net.

### 4.3 Read path: one function, scoped to the caller

- New SECURITY DEFINER function `friend_balances()` (security-model addition; gated). It uses `auth.uid()` only, returns rows only where the caller is one side, and returns for each row: counterpart user id, direction, amount, source kind (bill / sport / trip / request), source id, title, date, and an attributed flag. It never returns another participant's share or any row the caller is not part of.
- It is needed because RLS differs per source (organization vs trip participant) and a friend in another organization cannot read the bill directly. The function exposes only the minimum a person needs to understand their own debt.
- `search_path` is pinned, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated`, matching `accept_friend_invite` (migration 070).

### 4.4 Where it appears (iOS first)

- **Friends list:** each friend with a non-zero balance shows a small chip: "ค้างคุณ ฿450" (they owe me) or "คุณค้าง ฿450" (I owe them). Zero or unknown shows nothing. Colors use the existing adaptive palette (no new tokens).
- **1:1 chat room:** a slim tappable line under the title when the balance is non-zero ("ค้างกัน ฿450 · ดูรายละเอียด"); hidden otherwise. The chat room is also used for the trip chat; the line is shown only when the caller passes the friend's user id, so the trip chat is unchanged.
- **Balance screen** "ยอดค้างกับ <ชื่อ>": net total at the top in one sentence, then the breakdown grouped by source ("บิล", "นัดกีฬา", "ทริป", "ขอเงิน") with title, date and amount, and a line "มี N รายการที่คำนวณยอดให้ไม่ได้" when the unattributed bucket is not empty. Each row opens its own screen when the caller can open it (bills/trips the user belongs to), otherwise it is plain text.
- Read-only in this increment. No "mark as paid", no "request money", no reminders from this screen (see Non-Goals).
- Empty state: "ยังไม่มียอดค้างกับ <ชื่อ>" with no actions.
- Web follows later; the function is client-agnostic.

## 5. Non-Goals (this increment)

- Unifying the calculation engines (rounding, VAT, service charge, percent/shares) into one module; changing how any bill, session or trip is computed or settled.
- Bill/request/slip cards inside chat, "ขอเงิน" and "หารบิล" buttons in the chat composer, sending or receiving payment requests from chat, reminders.
- LINE group integration beyond using `line_connections` to link participants (the LINE group sync is its own spec).
- Auto-adding people as friends from activity (`split_activity`/`trip_activity` sources) and group debt simplification across bills.
- Multi-currency, multi-payer bill allocation, recording payments, disputes.
- Web UI, Android, notifications.

## 6. Verification

- SQL: a test script run against a **disposable** local Postgres/Supabase (never production) with synthetic users, friends, bills, sport sessions, trips and requests, asserting: each source rule in 4.2, no double counting of requests that carry `split_bill_id`, guests excluded, unattributed bucket counts, mirrored views between the two users, and that a third user sees nothing about them.
- Security: assert the function returns nothing without a session, and returns no row for a pair that does not include the caller; run the existing RLS expectations for bills and trips unchanged.
- Migration: applied only to the disposable database during development; the production migration is a separate approval.
- Host logic: iOS formatting of the chip and sentence (direction, rounding to two decimals, thousands separators, zero/unknown cases) as a Foundation-only helper tested with `swiftc` like `ChatPresentation`.
- iOS: simulator build, Debug fixtures and Light/Dark screenshots of the friends list chip, the chat line and the balance screen, using synthetic data only (the fixture pattern from the chat redesign).
- Not claimed unless actually done: behavior on hosted data, the production migration, a physical device (provisioning profile is expired), real multi-user flows, web.

## 7. Acceptance Criteria

- [ ] `split_participants.user_id` exists, is set only by friend choice or a `line_connections` match, and never by name.
- [ ] `friend_balances()` follows the four rules in 4.2 and returns only rows involving the caller.
- [ ] A bill with a request attached counts once.
- [ ] Unattributed rows are never added to any amount and are always disclosed.
- [ ] Friends list, 1:1 chat and balance screen show consistent numbers for the same friend, and the mirrored view for the other user matches.
- [ ] Trip chat and existing bill/trip screens behave as before.
- [ ] No change to how any amount is calculated or any bill/trip is settled.
- [ ] Migration, function, deploy and any production write only after their own approvals; no commit/push without separate approval.

## 8. Risks and Open Points

- **Payer semantics for bills** are the weakest part: bills carry the payer on receipts, and sport sessions imply the creator pays. If real usage differs (for example the creator did not pay), balances would be wrong for those bills. The unattributed bucket limits the damage; the plan must verify the rule against real usage (read-only) before the migration is proposed.
- **Trip numbers** come from the trip engine as is. If it double counts confirmed payments, this view would inherit that; to verify in the plan.
- **Privacy:** linking a participant to a user lets the other person see their own debt line (title, date, amount) through the function. This is the point of the feature, but it means a bill title is visible to the linked friend; confirm this is acceptable for private titles.
- **Existing participants stay unlinked** unless they have a connected LINE id, so day-one balances will look incomplete. The screen says so ("N รายการที่คำนวณยอดให้ไม่ได้") rather than hiding it; a later "link this guest to a friend" action is a possible follow-up.
- **Trip contract is open** (Journey/photo review, full build, device proof). This increment only reads trip data; confirm the order is acceptable.
- Sequencing: queued after the LINE invite-to-app and LINE group sync specs unless the user reorders; the D-077 reorder note still stands.

## 9. Planning amendments (2026-11-09, found while reading the code for the plan)

These refine the approved spec; they narrow or make explicit, they add no product scope.

1. **Counterparts are accepted friends only.** The existing participant-insert policy is organization-wide, so any member can attach any `user_id` to a bill. Returning rows only for accepted friends keeps non-friends out of your balances, but it does NOT stop an organization member from planting a debt between two people who are friends: the participant-insert/update policies (015) and the receipt-payer update (101) are organization-wide, so someone who is not even your friend can link your friend to a bill you are on, or repoint a receipt's payer. The real fix is to restrict writes to `split_participants.user_id` and `split_bill_receipts.paid_by_participant_id` to the bill creator or the linked user (a gated policy/trigger change). Until then balances are a convenience view, not proof of a debt. (Correction after review, 2026-11-09.) (Spec §4.3 said "rows where the caller is one side"; this is stricter.) A friend can still plant a debt; closing that needs a policy change, which is a separate gated task.
2. **Trip rule mirrors the web trip page.** `calculate_trip_settlement` does **not** net confirmed `trip_payments`. The web page (`trip-detail-client.tsx`, `alreadyPaid`) hides a suggested transfer when a confirmed payment exists for the same (from, to) pair, whatever its amount. The balance view uses the same rule so the two screens never disagree. Partial payments are therefore handled coarsely; recorded as a known limit.
3. **Trips can be non-THB.** `life_journeys.base_currency` exists (migration 073). Trips whose base currency is not THB are returned with `attributed = false` and are never summed. Participants without a user (guests) have no friend to attach to and are skipped for trips.
4. **Trips are a separate function behind a verification gate.** Reading the 060 settlement formula suggests it credits a payer with their *own* share instead of the share of everyone else, so a 3-person trip would lose one debtor's transfer (a script re-implementation of the formula, not the real function, gave `B→A 100` only; correct is `B→A 100` and `C→A 100`). The plan proves or refutes this on a local database first. If it is real, trip rows are left out, the UI says `ยังไม่รวมยอดจากทริป`, and a separate, separately approved fix is proposed. This spec does not change how money is settled.
5. **Unattributed rows are tied to a friend.** When a bill's payer cannot be determined, the row's counterpart is the creator (if the caller is an unpaid linked participant and the creator is a friend) or the linked friend participant (if the caller created the bill). So every unattributed row can be shown on the right friend's screen and counted, never summed.
6. **LINE links are resolved at read time as well as backfilled.** A participant's person is `COALESCE(user_id, the user connected to its LINE id)`; the migration also backfills existing rows. This covers participants the LINE bot creates after the migration without changing the bot.
7. **Standalone requests** additionally require "not expired by time" (`expires_at > now()`), because the status column is not guaranteed to be updated when a request lapses.
8. **Linking on iOS is limited to bill creation** (`CreateSplitView` friend picker). The sport-session roster ("เพิ่มเพื่อน" by name in `SportSessionDetailView`) keeps adding by name; sport sessions therefore show balances only for participants who are linked by LINE or by a later increment.
9. **Deployment order is part of the design:** apply the migration first, then ship iOS. An iOS build that sends `user_id` to a database without the column fails bill creation.

10. **Review corrections (2026-11-09).** (a) Bills created in the iOS app today record no receipt and no category, so their payer cannot be determined and they show as "can't compute" rows; making the creator the recorded payer for iOS bills is an open, separately approved decision. (b) The detail screen's rows are plain text (the spec's "open the bill or trip" is not implemented in this increment). (c) A friend picked twice in one bill produces two participant rows; the app merges them into one line per source. (d) `SocialViewModel.load` compared UUIDs case-sensitively (uppercase `uuidString` vs lowercase Postgres) and was fixed to compare case-insensitively, because the friend picker and chips depend on it.
