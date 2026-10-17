# Journey Module

## Native iOS Map Providers (2026-10-15, D-072)

- `TripMapView` offers Apple Maps / Google Maps inside the existing map surface. Google is the initial provider when configured; Apple remains the credential-free fallback. Google uses the native `GoogleMaps` SPM product pinned to 11.2.0, not a web view or external Google Maps launch.
- Set the build setting `GOOGLE_MAPS_IOS_API_KEY` through a private local/CI build configuration. It is expanded into `GoogleMapsIOSAPIKey` in the app plist. Restrict the credential to iOS bundle `app.slippy.ios` and Maps SDK for iOS. Never reuse a web-only key, put credentials in tracked source/docs, or provision billing/services as part of this implementation.
- An absent/blank/unexpanded key prevents Google view creation, displays a configuration message and retains Apple. SDK key submission is not proof of authorization or tile availability; the Apple selector remains available if a configured key fails remotely.
- Both providers use existing itinerary coordinates/selection, day filtering, recentering and live member positions. Google supports marker selection, coordinate/POI-name preview, existing add/edit/delete/move flows and adaptive Light/Dark styling. No second GPS or Contacts permission workflow is introduced.
- Apple POI searches, reverse geocoding and MKDirections geometry stay on Apple Maps. Google POI names/coordinates come from its delegate; no Places API/extra SDK or Google routing API is enabled. Actual road/footpath overlays remain Apple-only. Google does not misrepresent straight segments as calculated routes.
- Switching retains the visible geographic region. Google camera fitting uses an explicit revision, not every SwiftUI update. Selection-card height pads Google's controls/attribution rather than hiding them underneath the card. Compact/landscape and live Google tiles still require device/key acceptance.
- Host key/fallback checks: `swiftc ios/Slippy/Models/TripMapProvider.swift ios/scripts/verify-trip-map-provider.swift -o /private/tmp/verify-trip-map-provider`, then run that binary. UI fixture `trip-map-test` is Debug-only, uses local trip data and never writes financial/trip records. Native-key authorization cannot be inferred from these tests.
- Verification 2026-10-15: native-key host checks PASS; missing-key UI regression TEST SUCCEEDED (1/1, zero failures) in `/private/tmp/slippy-native-maps-fallback-final.log` / `.xcresult`. Final signed current-source build BUILD SUCCEEDED at `/private/tmp/slippy-native-maps-release-ready.log`; installed on iPhone `00008130-001968C81EF0001C` (installation suffix `FE8A7825-1F90-4ECC-A942-96F36517CBCD`). Focused review found no remaining actionable issue after POI, stale-position, numbered-pin and stable marker-identity fixes. Live Google rendering/interaction remains unverified without an authorized native key. No credentials provisioned, production financial/trip records created, web deployment or commit/push performed.
- Final iPhone launch succeeded. Inspected simulator Light/Dark screenshots at `/private/tmp/slippy-native-maps-light.png` and `/private/tmp/slippy-native-maps-dark.png`: actual Apple tiles and provider selector render without overlapping labels. These screenshots do not verify the credential-gated Google renderer.
- Native-key delivery 2026-10-15: user supplied a dedicated key and confirmed iOS/API restrictions. Private `ios/Config/Maps.local.xcconfig` is Git-ignored with owner-only file permissions. Build with `-xcconfig ios/Config/Maps.local.xcconfig` succeeded (`/private/tmp/slippy-native-maps-key-device.log`, owner-only permissions); a redacted check verified the built plist key equals local configuration and bundle is `app.slippy.ios`. Key-bearing app installed successfully on the iPhone (installation suffix `684AB63D-B7D0-4127-873C-D75F16F91BA9`). Key value is not recorded here or in tracked source. Actual Google tile authorization/rendering, provider switching and POI/card behavior still require device acceptance; SDK initialization/build/install do not prove those checks.
- Expanded verification 2026-10-15: `/private/tmp/slippy-native-maps-final-regression.log` and `.xcresult` report TEST SUCCEEDED, 2 tests, zero failures: configured Google/Apple switching with marker-card selection in both Light/Dark, plus fixture-scoped missing-key fallback in the same credential-bearing build. Inspected four exported screenshots in `/private/tmp/slippy-native-maps-final-images`: real Google road/POI tiles, numbered marker, selected-stop card and unobscured Google credit in both modes. This confirms simulator rendering, not physical-device acceptance or every POI/live-location interaction.
- Tests wait for the SDK's stable-snapshot callback. An initial screenshot captured too early was gray; subsequent attempts exposed fixed-coordinate and unsupported marker-accessibility assumptions in the tests. Final tests use SDK-projected normalized pin coordinates exported as structured JSON only in Debug and only for the synthetic `trip-map-test` fixture; Release and normal user trips do not expose this diagnostic payload. Focused review found no actionable issue after these corrections.
- Signed device build `/private/tmp/slippy-native-maps-verified-device.log` succeeded and installed (suffix `3126CFE5-EBA9-4415-A952-DC5FA427DAD3`). That artifact precedes the final fixture-only theme/projection/missing-key test refinements; normal map behavior is unchanged. Physical UI-test attempt `/private/tmp/slippy-native-maps-physical.log` could not launch because iPhone was locked and was terminated rather than left waiting. Physical Google/POI checks and receipt/friends real Contacts plus authenticated save/reopen remain outstanding; no production test records were created. Mac free disk was about 3 GB after verification; no further redundant build was started and no user files were deleted.


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

## iOS trip reference photos

The trip workspace uses the existing bundled Kyushu illustrations for day headers and 44pt offline reference-photo thumbnails beside matching itinerary/place-vote entries. These are destination references, separate from member uploads in `trip_photos`. Tap a thumbnail to open the existing full-screen zoom viewer with photographer, source-page and license attribution. Place-vote entries retain their Google Maps action.

The full-screen profile/reference image viewer supports iPhone landscape rotation and a rotate button. Closing it restores the normal portrait-only app interface. Zoom/pan reset when the viewer dimensions change.

The Kyushu workspace's four visual-diary illustrations now appear in the trip gallery alongside uploaded photos, rather than in a separate overview section. Bundled illustrations open in the full-screen viewer and have no deletion action; gallery uploads retain their existing upload/delete flow.

The itinerary item editor can select a picture from the trip gallery (including the four diary illustrations), or from the iPhone photo library. iPhone selections are downscaled to JPEG and uploaded only on Save using the existing public `trip-photos` bucket; the owner explicitly approved this destination on 2026-10-13. Uploaded pictures also appear in the trip gallery. The item stores `photo_path` or `photo_asset` in its existing `details` JSON, preserving unrelated keys; an unchanged photo leaves `details` out of the update payload. Reset returns to automatic destination matching without deleting a shared gallery photo. Item thumbnails remain 44pt and use the existing landscape-capable full-screen viewer. Missing remote pictures fall back to a matching attributed reference image or an inert placeholder. No schema, RLS or storage-policy changes.

`node ios/scripts/verify-item-photo.mjs <resolved-supabase-swift-checkout>` compiles the actual model, payload and photo-selection block with the pinned package's AnyJSON source and verifies selection/reset/details-preservation behavior. DEBUG appearance preview route `item-edit` renders the editor with synthetic IDs and no-op itinerary actions; actual upload and persistence require authenticated device acceptance testing.

`ios/Slippy/Assets.xcassets/KyushuReferencePhotos.dataset` holds the matching aliases and attribution. `ios/scripts/import-kyushu-reference-photos.mjs` imports licensed JPEGs from Wikimedia Commons into the existing asset catalog; it can resume interrupted imports. Unmatched places keep their original text/icon presentation; no substitute image is assigned to an unrelated location. No database or storage-policy changes are required.

## Known gaps

- No current route creates a `life_journeys` row with any `journey_type` other than `"trip"`; `"event"` is mentioned only in a stale code comment as a historical possibility, not a live path. Do not assume other journey types are reachable without checking again.
- This document does not itemise every route under `app/api/trips/[id]/*` (calls, location-sessions, preorder, route-legs, geocode) field by field — the list above says what each does, not its full request/response shape.
- Sport-group trips (`life_journeys.trip_type = 'sport'`) and their LINE integration are covered by SPORT_GROUPS_LINE.md, not here.

## 2026-10-16 Verification Handoff

### 2026-10-17 Physical Device Verification

- User unlocked the iPhone and authorized continued testing. Physical-device XCTest completed successfully: 5 tests, 0 failures, exit 0. Evidence: `/private/tmp/slippy-physical-acceptance-20261017.log` and `.xcresult`.
- Map cases verified configured Google as the initial provider, stable rendering, selecting the synthetic itinerary marker/card, Google/Apple switching in Light/Dark, and fixture-scoped missing-key Apple fallback. Screenshots exported to `/private/tmp/slippy-physical-acceptance-images-all`; inspected Google tiles/marker/card with visible attribution on the physical device.
- Tests used synthetic trip data, not production trip writes. Arbitrary Google POI selection and live-location sharing were not exercised; build/install and these map checks do not establish those additional behaviors.

- 09:08 Bangkok retry: disk space improved and signed current-source build was attempted (`/private/tmp/slippy-default-google-delivery.log`), but exited 74 during package resolution: GoogleMaps 11.2.0 binary download reported offline. Compilation/signing did not complete; no new app installed. Device connection recovered enough to read lock state (`passcodeRequired: true`), so physical UI verification remains blocked by the lock. Do not repeatedly rebuild while the download remains unavailable.

- Trip maps now initialize with Google when the native SDK is configured; missing configuration still initializes Apple. Provider switching remains available. Host provider/default tests pass; the UI regression now asserts Google is selected before any tap. This source revision has not yet been rebuilt or installed on iPhone.
- Latest device checks encountered a CoreDevice initialization timeout and then a connection reset on the escalated retry. Installation/launch cannot currently proceed; unlock state is unverified.
- Terrain/weather proposal only (not implemented): use the existing Google iOS terrain map type for terrain and a separate forecast panel for Thai destinations. Windy Map Forecast is a JavaScript/Leaflet map, so a separate weather view is preferable to assuming its visual layers can be reused as native Google tiles. Windy testing access is development-only; production pricing/licensing must be reviewed before integration. Open-Meteo is another forecast-data option, with commercial endpoint access requiring a subscription.
- References: https://developers.google.com/maps/documentation/ios-sdk/configure-map ; https://api.windy.com/map-forecast/docs ; https://api.windy.com/map-forecast/pricing ; https://open-meteo.com/en/pricing . No weather service, key, subscription or new dependency has been enabled.
