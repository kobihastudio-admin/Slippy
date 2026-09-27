# Journey Module

Status: **derived from code** (`web/src/app/api/trips/*`, `web/src/lib/trips/*`, `web/src/lib/trip-settlement.ts`, `supabase/migrations`). Where this document and the code disagree, the code is right.

`life_journeys` is the single parent table for what the product surfaces as "trips" (`/trips`). How itinerary items link into the Activity Graph is covered in [operations/activity-graph-rollout.md](operations/activity-graph-rollout.md) and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md); this document covers the trip itself: creation, access control, itinerary, expenses/settlement, membership, and sharing.

## `journey_type` vs `trip_type`

`life_journeys.journey_type` is the canonical discriminator; `trip_type` (`travel` | `food_order` | `sport` | `general`) is a **sub-classifier that only means something when `journey_type = 'trip'`** — enforced by `life_journeys_trip_type_requires_trip_journey` (`CHECK (trip_type = 'general' OR journey_type = 'trip')`). This replaced an earlier, contradictory inference in the trips API that set `journey_type = 'event'` for some rows; `POST /api/trips` now always writes `journey_type: "trip"`. In production, every existing row has `journey_type = 'trip'` — no other value has been observed, and no current route creates one. Filtering trips by `.eq("journey_type", "trip")` (not by `trip_type`) is the only correct way to list them; an earlier bug filtered on `trip_type IS NOT NULL`, which matched every row because the column defaults to `'general'` and is never actually null.

`status`: `active` | `settled` | `cancelled`. `life_journeys.split_mode`: `equal` | `individual` | `custom` — a trip-wide default, **distinct from** `trip_expenses.split_mode` (`equal` | `individual` | `percent` | `shares` | `exclude`), which is set per expense. Do not conflate the two when reading the schema.

## Authorization model (`web/src/lib/trips/trip-access.ts`)

Every trip route uses the service-role (admin) client, which bypasses RLS entirely, so a signed-in session by itself proves nothing about a specific trip — a trip id would otherwise work as a bearer token. `getTripAccess(journeyId, userId)` is the single place this is decided:

- **`owner`** — `life_journeys.user_id === userId`. May invite/remove participants and change trip-wide settings.
- **`participant`** — a `trip_participants` row for this user with `left_at IS NULL`. May act on the trip (add itinerary, log expenses, chat) but not reshape the guest list.
- **`none`** — access denied.

A denied read returns **404, not 403**, so a stranger cannot use the status code to confirm a trip id is real; denials are recorded via `recordDenied("trip.view", …)`. Organisation membership is reported separately (`orgId`) for callers that need it (e.g. accounting rollups) but by itself grants no seat on the trip — deliberately, since a trip is treated as a personal/social record even inside a business organisation. `canManageTrip()` is `getTripAccess(...).role === "owner"`.

## Itinerary

`trip_itinerary_days` (`journey_id`, `day_number`, `date`, `title`) each hold `trip_itinerary_items` (`type`, `title`, `location`, `notes`, `amount`, `time_from`, `time_to`, `image_url`, `booking_ref`, `sort_order`, plus `activity_id` once projected — see the Activity Graph rollout doc). `GET .../itinerary` returns days ordered by `day_number` with items sorted by `sort_order`; `POST` supports `add_day`, `add_item`, `remove_item`, `remove_day`, `reorder_items` as a single action-dispatched endpoint rather than separate REST verbs.

## Expenses and settlement (`lib/trip-settlement.ts`)

Each `trip_expenses` row has its **own** payer (`paid_by_id`) and its **own** `split_mode` — a trip with 5 expenses can have 5 different payers and 5 different divisions. `resolveExpenseSplits()` is the one place that turns an expense's raw per-participant input plus its mode into amounts owed, shared by both the dashboard API (`app/api/trips/[id]/expenses`) and the LIFF API (`app/api/liff/trips/[token]/expenses`) so the math is not duplicated. The *settlement* — who nets out owing whom across the whole trip — is computed separately by the SQL function `calculate_trip_settlement` once expenses are saved, not by summing splits in application code.

`recurring_expense_templates` auto-generate `trip_expenses` on a schedule (rent, subscriptions, recurring shared costs); `next_run_date` advances each time the scheduled run creates an expense, and `is_active = false` pauses a template without deleting its history (`POST/GET /api/trips/recurring`, `.../recurring/run`).

`preorder_sessions` / `preorder_items` support "everyone add what you're ordering" rounds that close into exactly one `trip_expenses` row (`split_mode = "individual"`, each person's share = the sum of their own preorder items) via `createTripExpense()`.

## Membership (`app/api/trips/[id]/members`)

- **`GET`** — participants with `left_at IS NULL`, plus the caller's own role.
- **`POST` (invite)** — owner only (`403 "Only the trip owner can invite"`); re-adds a participant who previously left by clearing `left_at` rather than inserting a duplicate row, and ensures the trip's chat conversation exists (`ensureTripConversation`).
- **`DELETE` (remove)** — owner only; the owner cannot remove themself (`409 "The trip owner cannot be removed"`). Removal sets `left_at`, so the row (and its expense history) is retained; the participant is explicitly removed from chat membership separately.

## Feature flags (`lib/trips/trip-features.ts`)

Three phases of the "Trip Full Loop" are gated **off by default**, the opposite convention from the Activities kill switch (`ACTIVITIES_ENABLED`, default on): `TRIP_FEATURE_MAPS`, `TRIP_FEATURE_LIVE_LOCATION`, `TRIP_FEATURE_CALLS`, each read as enabled only when the env var is exactly `"1"` — anything else (unset, `"true"`, empty, a typo) is off, so a half-configured environment cannot silently turn one on. `featureDisabledResponse()` returns a 404-shaped result for a gated API route, matching the "looks like it doesn't exist" convention used elsewhere (see the scope gate in OCR_ENGINE_SPEC.md and the Activities kill switch). As of the rollout runbook, location and calls have their schema and UI in place and are rollout switches rather than blocked features; maps still needs restricted Google keys and a CSP change.

## Sharing and export

- **`share_token`**: a public, unguessable identifier (set by `ensure_trip_share_token`, a `SECURITY DEFINER` function) used by the public LIFF join route (`/api/liff/join-trip`, one of the 3 public LIFF exceptions — see LINE_OA_SPEC.md) and by trip PDF/KML export.
- **`.../pdf`**, **`.../kml`** — read-only exports of the itinerary/route for a trip the caller can access.
- **`.../route-legs`**, **`.../geocode`** — routing and address lookup for the map view (gated by `TRIP_FEATURE_MAPS` where applicable).
- **`.../calls`**, **`.../calls/token`** — LiveKit room join, gated by `TRIP_FEATURE_CALLS`.
- **`.../location-sessions`** — temporary live-location sharing, gated by `TRIP_FEATURE_LIVE_LOCATION`.
- **`.../import-document`** — attaches a scanned document (receipt/ticket) to the trip.
- **`.../notes`**, **`.../photos`**, **`.../documents`** — per-trip notes, photo gallery, and linked documents.
- **`.../conversation`** — the trip's chat thread (see `ensureTripConversation`).

## Creation paths

- **`POST /api/trips`** — the dashboard/LIFF creation path described above (`journey_type: "trip"` always).
- **`create_trip_full`** (`SECURITY DEFINER` SQL function) — an alternate, atomic creation path used elsewhere (e.g. LINE `/tripgroup`) that agrees with the same `trip_type`-only-when-`journey_type='trip'` convention.

## Known gaps

- No current route creates a `life_journeys` row with any `journey_type` other than `"trip"`; `"event"` is mentioned only in a stale code comment as a historical possibility, not a live path. Do not assume other journey types are reachable without checking again.
- This document does not itemise every route under `app/api/trips/[id]/*` (calls, location-sessions, preorder, route-legs, geocode) field by field — the list above says what each does, not its full request/response shape.
- Sport-group trips (`life_journeys.trip_type = 'sport'`) and their LINE integration are covered by SPORT_GROUPS_LINE.md, not here.
