# Slippy Trip Full Loop — Claude Implementation Handoff

> Updated: 2026-08-09  
> Workspace: `/Users/chainimitsakhorn/Documents/Project/Slippy`
> Product: Slippy — AI Life Assistant Platform  
> Architecture: LINE OA → Services → Life Graph → AI Memory → AI Assistant

## 0. Current implementation status

Remote Supabase project `ntzztcnkedcxfjvfxjrf` was reconciled and verified on 2026-08-09:

- Remote timestamp migrations were fetched into the repository.
- Local history `075–078` and `080–085` was marked applied only after catalog-level schema verification.
- Migrations `079_vendor_match_key.sql` and `086_trip_member_lifecycle_and_system_messages.sql` were applied.
- Migration `087_remove_legacy_upsert_vendor_overload.sql` was added and applied after verification found both old and new function overloads.
- Local and Remote history now match through `087`; final dry-run reports that the Remote database is up to date.

### Completed in Phase 1

- Added `supabase/migrations/085_trip_conversation_link.sql`:
  - one conversation per journey;
  - one Slippy participant row per journey/user;
  - rollback guidance.
- Added centralized trip authorization in `web/src/lib/trips/trip-access.ts`.
- Added idempotent trip conversation creation, membership synchronization and structured system events in `web/src/lib/trips/trip-conversation.ts`.
- Added `GET/POST /api/trips/[id]/conversation`.
- Added `GET/POST/DELETE /api/trips/[id]/members`.
- Added feature gates in `web/src/lib/trips/trip-features.ts`.
- Trip creation now creates its group conversation on a best-effort basis.
- Slippy friend invitations validate accepted friendship and prevent duplicate participant rows.
- Added `supabase/migrations/086_trip_member_lifecycle_and_system_messages.sql`:
  - departed members retain their participant row for expense history;
  - trip/chat access is revoked through `left_at`;
  - automated `system` messages may omit a human sender while every other message type still requires one.
- Trip authorization and conversation unit tests currently pass.

### Current feature flags

All unfinished/high-sensitivity features are disabled unless the value is exactly `1`:

```env
TRIP_FEATURE_MAPS=0
TRIP_FEATURE_LIVE_LOCATION=0
TRIP_FEATURE_CALLS=0
```

Do not enable a flag until its schema, restricted credentials, consent UI, privacy configuration, retention process and tests are ready.

### Remaining work, in recommended order

1. Finish Phase 1 UI wiring: production Journey detail, Slippy friend picker, LINE invite/share and member-removal confirmation.
2. Add participant-scoped RLS. Existing historical trip policies are organization-scoped; service-role API routes must continue using `getTripAccess()` until direct-client policies are hardened and verified.
3. Add route-level integration tests for member invitation/removal, conversation access and replayed requests.
4. Configure restricted Google keys and implement Phase 2 maps behind `TRIP_FEATURE_MAPS`.
5. Decide precise location retention and audience rules before creating the Phase 3 schema.
6. Select a VoIP provider before implementing Phase 5 or enabling calls.

### Known decisions still required

- Whether removed members retain read-only access to historical trip chat. Current implementation revokes conversation membership immediately.
- Exact location retention period and whether anything beyond the latest point is retained.
- Verified emergency-number source and offline update cadence.
- Expo/Android map and background-location strategy.
- VoIP provider, region, expected concurrency, TURN cost and data residency.
- Production rollout, monitoring, kill-switch ownership and incident response.

## 1. Objective

Continue the Slippy Trip & Journey module from the existing additive prototypes and connect it to production systems without replacing or breaking the current trip, split-bill, LINE, chat, medication, document, or authentication flows.

The target journey is:

1. Create a trip.
2. Add dates, destinations, itinerary stops, hotels, bookings, notes, images, and map routes.
3. Invite travelers from Slippy or through LINE.
4. Automatically create a trip conversation.
5. Support chat, trip events, location messages, and call invitations.
6. Allow each traveler to explicitly start a temporary live-location session.
7. Help separated travelers find or check in with one another.
8. Record shared expenses, split costs, settle balances, and retain original currencies.
9. Provide an offline-capable Safety Hub for hospitals, pharmacies, medication, allergies, hotels, insurance, embassies, emergency contacts, and local emergency numbers.
10. Preserve trip activity in the Life Graph and expose only explicitly permitted information to AI features.

## 2. Non-negotiable safety and privacy rules

- Never enable silent or permanent location tracking.
- Location sharing must be opt-in per person, trip-scoped, visible while active, revocable immediately, and have an explicit expiry.
- Default location duration: 60 minutes. Also support 15 minutes, 4 hours, and until the end of the day.
- Do not allow a trip owner or admin to remotely enable another member's location.
- Store only the minimum location history needed. Define and enforce retention and deletion.
- Health, medication, allergy, passport, insurance, hotel, voice, and precise-location information is sensitive data.
- A user must select which emergency/medical fields can be shared, and with whom.
- SOS must confirm country and emergency service before initiating a call.
- Safety information must not be presented as medical advice or as a replacement for local emergency services.
- Do not scrape a LINE friend list. Invite through LINE-approved login, link, QR, URL scheme, or LIFF `shareTargetPicker()` flows.
- Never expose service-role keys, LINE secrets, APNs keys, Google server keys, or VoIP provider secrets to Web, Expo, or iOS clients.
- Do not commit secrets, `.p8` files, service-account JSON, or production `.env` files.
- Keep all production writes behind authentication, membership checks, RLS, server validation, and an audit trail where appropriate.

## 3. Existing additive prototypes

### Web

- Route: `web/src/app/(app)/trips/journey-design/page.tsx`
- Main UI: `web/src/components/trips/trip-journey-design.tsx`
- Trips-list entry: `web/src/components/trips/trips-client.tsx`
- Sidebar entry: `web/src/components/layout/sidebar.tsx`
- URL after login: `/trips/journey-design`

Current prototype areas:

- Overview
- Itinerary/day-by-day plan
- Mock route map
- Budget and split expenses
- Gallery/media map
- Notes and checklist
- Trip settings
- Travel Together: Slippy/LINE invite, group chat, call buttons, temporary location sharing
- Safety Hub: SOS, hospitals, medication, hotel/insurance, embassy and emergency contacts

### Expo Mobile

- Prototype route: `mobile/src/app/(app)/journey-prototype.tsx`
- Hidden route registration: `mobile/src/app/(app)/_layout.tsx`
- Dashboard entry: `mobile/src/app/(app)/index.tsx`

Open from the mobile dashboard using the **Journey Prototype** card.

### Native iOS SwiftUI

- Prototype: `ios/Slippy/Views/Trips/JourneyPrototypeView.swift`
- Entry from Trips toolbar: `ios/Slippy/Views/Trips/TripsView.swift`

Open the **Trips** tab and tap the map icon in the top-right toolbar.

### Design assets

- `web/public/design/slippy-journey-ios-showcase.png`
- `web/public/design/slippy-journey-web-workspace.png`

These prototypes intentionally use local demonstration data and should not be treated as completed production integrations.

## 4. Existing systems to reuse

Before creating new domains, inspect and reuse these systems:

### Trips, itinerary and shared expense

- `life_journeys`
- Current trip participant, expense, split, and settlement tables
- `supabase/migrations/073_trip_multi_currency.sql`
- `supabase/migrations/074_itinerary_and_preorder.sql`
- `web/src/app/api/trips/`
- `web/src/app/api/liff/trips/`
- `web/src/components/trips/trip-detail-client.tsx`
- `ios/Slippy/Models/TripModels.swift`
- `ios/Slippy/ViewModels/TripsViewModel.swift`

### Friends and chat

- `supabase/migrations/052_friendships.sql`
- `supabase/migrations/053_chat.sql`
- `supabase/migrations/055_recent_features_security.sql`
- `supabase/migrations/070_friend_invite_rpc.sql`
- `supabase/migrations/076_chat_attachments_bucket.sql`
- `supabase/migrations/077_chat_attachments_size_limit.sql`
- `mobile/src/store/social.store.ts`
- `web/src/app/(app)/messages/`
- `web/src/app/(app)/social/friends/`
- `ios/Slippy/Models/MessageModels.swift`
- `ios/Slippy/Models/SocialModels.swift`
- `ios/Slippy/Views/Chat/`
- `ios/Slippy/Views/Social/`

### LINE and LIFF

- `web/src/lib/liff.ts`
- `web/src/lib/liff-auth.ts`
- `web/src/lib/line-identity.ts`
- `web/src/app/liff/trip/page.tsx`
- `web/src/app/liff/trips/`
- `web/src/app/liff/friends/`
- `web/src/app/api/liff/`
- `api/src/services/line-push.ts`
- `api/src/services/line-trip.ts`
- `api/src/services/line-flex.ts`
- `api/src/routes/line.ts`

### Places, hospital and pharmacy search

- `api/src/services/location-search.ts`

This service already reads `GOOGLE_MAPS_API_KEY` and supports categories such as hospital and pharmacy.

### Medication and health

- `supabase/migrations/031_medication_tracking.sql`
- `api/src/services/medication-reminder.ts`
- `ios/Slippy/Models/HealthModels.swift`
- `ios/Slippy/Views/Health/`
- `web/src/app/liff/health/`
- `web/src/app/api/liff/health/`
- `web/src/app/api/liff/medications/`

## 5. Current known gaps

- Native Google Maps SDK is not configured in `ios/project.yml`.
- Expo does not currently list a production map/location dependency.
- Web map in the prototype is a CSS mock, not a real Google Map.
- Web `Permissions-Policy` currently disables `microphone` and `geolocation`.
- Default Web CSP does not yet allow required Google Maps or VoIP provider domains.
- No trip-specific live-location session schema or production tracking service exists.
- No selected VoIP provider or deployed WebRTC signaling/TURN infrastructure exists.
- No production CallKit/PushKit call flow exists.
- The existing health and medication domains are not yet connected to trip-specific emergency sharing.
- Emergency-number data needs a verified country-aware source and offline snapshot strategy.

## 6. External consoles and services to configure

### 6.1 Google Cloud Console

Open or verify billing and enable:

- Maps SDK for iOS
- Maps JavaScript API
- Places API
- Routes API
- Geocoding API

Create separate restricted keys:

1. Web key restricted by production/staging HTTP referrers.
2. iOS key restricted to bundle identifier `app.slippy.ios`.
3. Server key restricted to server usage/IP/API scope.

Expected environment variables:

```env
NEXT_PUBLIC_GOOGLE_MAPS_KEY=
GOOGLE_MAPS_API_KEY=
```

Do not reuse an unrestricted key across clients and servers.

### 6.2 LINE Developers Console

For the LINE Login channel:

- Verify callback URLs.
- Verify iOS bundle identifier `app.slippy.ios`.
- Link the LINE Login channel to the correct LINE Official Account.
- Enable the required login scopes.

For the LIFF app:

- Endpoint origin: production/staging Slippy web origin.
- Scope: `profile`, `openid` and only other required scopes.
- Enable `shareTargetPicker` and accept its information-use agreement.
- Test inside the LINE app and in an external browser fallback.

Expected variables:

```env
NEXT_PUBLIC_LIFF_ID=
NEXT_PUBLIC_LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
```

### 6.3 Supabase

- Apply all existing migrations in a controlled environment.
- Enable Realtime only for required tables.
- Disable public Realtime channel access.
- Add RLS to private `realtime.messages` topics.
- Verify trip membership, conversation membership and storage-bucket policies.
- Create retention cleanup for expired location data.
- Store privileged credentials only in server/Edge Function secrets.

Existing client/server variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```

`SUPABASE_SERVICE_KEY` is server-only.

### 6.4 Apple Developer and Xcode

For App ID `app.slippy.ios`, enable as required:

- Push Notifications
- Background Modes → Remote notifications
- Background Modes → Location updates, only if the reviewed background-location feature is implemented
- Background Modes → Voice over IP, only when a real VoIP provider and PushKit flow are implemented

Add usage descriptions:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription` only when required
- `NSMicrophoneUsageDescription`
- Camera usage text must also cover video calling if used

Create APNs authentication credentials and store them in a server-side secret manager.

### 6.5 VoIP provider

Choose one before implementing real calls:

- Recommended initial option: LiveKit Cloud
- Alternatives: Twilio, Agora, or self-hosted LiveKit/WebRTC with TURN

Expected server-only configuration after choosing LiveKit:

```env
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Never mint room tokens in a client. Create a server endpoint that verifies trip/conversation membership before issuing a short-lived token.

### 6.6 APNs/PushKit server configuration

```env
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=app.slippy.ios
APNS_PRIVATE_KEY=
```

Do not commit the `.p8` file or its content.

## 7. Required Web security configuration

Review `web/next.config.ts`.

The current policy contains:

```text
camera=(self), microphone=(), geolocation=()
```

For enabled features, use the narrowest appropriate policy, for example:

```text
camera=(self), microphone=(self), geolocation=(self)
```

Do not broaden permissions before the feature, consent UI, privacy policy and tests are ready.

Add only required Google Maps and selected VoIP provider hosts to:

- `script-src`
- `connect-src`
- `img-src`
- `style-src`, if required
- `frame-src`, only if required

Keep the default policy restrictive. Do not use `*` as a shortcut.

## 8. Proposed database additions

Create new additive migrations. Do not edit historical migrations already applied in production.

Suggested tables:

### `trip_location_sessions`

- `id`
- `journey_id`
- `user_id`
- `started_at`
- `expires_at`
- `stopped_at`
- `sharing_mode` (`foreground`, optional reviewed `background`)
- `audience` (`all_trip_members`, selected members)
- `created_at`

### `trip_member_locations`

- `id`
- `session_id`
- `journey_id`
- `user_id`
- `latitude`
- `longitude`
- `accuracy_m`
- `heading`
- `speed_mps`
- `recorded_at`
- `expires_at`

Prefer retaining only the latest location unless history is a documented requirement.

### `trip_check_ins`

- `id`
- `journey_id`
- `user_id`
- `status` (`safe`, `delayed`, `need_help`)
- optional coarse location
- message
- `created_at`

### `trip_sos_events`

- `id`
- `journey_id`
- `user_id`
- `country_code`
- `emergency_service`
- location snapshot
- lifecycle status
- `created_at`, `resolved_at`

### `trip_emergency_shares`

- `journey_id`
- owner user ID
- grantee user ID or emergency audience
- explicit fields granted
- expiry/revocation

### `trip_call_sessions`

- `id`
- `journey_id`
- `conversation_id`
- provider room ID
- call type
- initiator
- status
- timestamps

Do not store voice/video content by default.

## 9. Suggested implementation phases

### Phase 1 — Production trip collaboration

- Connect the prototype to real journeys and itinerary APIs.
- Create a trip group conversation when a trip is created.
- Add existing Slippy friends to a trip.
- Implement LINE invitation link/LIFF sharing.
- Add trip system messages for itinerary, member and expense changes.
- Keep existing trip creation and expense flows operational.

### Phase 2 — Real maps and places

- Web Google Maps and route rendering.
- Native iOS Google Maps SDK via Swift Package Manager.
- Expo map implementation compatible with the project’s build strategy.
- Place autocomplete and stop details.
- Route and travel-time calculations.
- Hospital, pharmacy, hotel and embassy search.
- Correct Google attribution and API-key restrictions.

### Phase 3 — Temporary live location

- Foreground-only location sharing first.
- Private trip Realtime channel.
- Explicit start, remaining-time display and stop controls.
- Last updated time and GPS accuracy.
- Stale/offline status.
- Check-in and “I need help” messages.
- Server-enforced expiry and cleanup.
- Add background location only after privacy, battery and App Review review.

### Phase 4 — Safety Hub

- Offline trip safety card.
- Verified emergency numbers per country.
- Nearby hospitals/pharmacies.
- Hotel, policy and embassy contacts.
- Selective medication/allergy sharing.
- SOS confirmation and audit log.
- No diagnostic or medical recommendation claims.

### Phase 5 — Voice/video calling

- Provider integration and server token endpoint.
- Trip membership authorization.
- Ringing, accept, decline, end and reconnect states.
- CallKit and PushKit for iOS.
- Web microphone/camera permissions.
- Call history without recording media.
- Abuse controls, blocking and rate limits.

### Phase 6 — AI and Life Graph

- Write meaningful trip events to the Life Graph.
- Keep private notes, location and medical data excluded by default.
- Require explicit scopes before AI can use sensitive fields.
- Provide preview/diff before AI modifies itinerary or trip records.

## 10. Acceptance criteria

### Create and invite

- A user can create a trip from the existing production flow.
- The new journey interface can open the production trip without duplicate records.
- A trip conversation is created exactly once.
- A Slippy friend can accept/decline an invite.
- A LINE recipient can join through a signed, expiring or revocable invite.
- Reusing an invite cannot create duplicate membership.

### Chat

- Only active conversation members can read or send messages.
- Attachments use private storage with signed access.
- Trip changes appear as structured system messages.
- Push notifications do not reveal sensitive content when privacy preview is disabled.

### Location

- No coordinates are transmitted before explicit consent.
- Active sharing is visibly indicated.
- Sharing stops when the user presses Stop or the session expires.
- Non-members cannot subscribe, query or infer locations.
- Removing a trip member immediately removes location access.
- Expired locations are deleted according to retention policy.
- Offline/stale members are shown as stale, not as currently live.

### Expenses

- Existing split/settlement math remains the source of truth.
- Original currency and exchange rate are retained.
- Adding or removing a trip member does not silently rewrite finalized expenses.

### Safety

- SOS confirms country/service before calling.
- Emergency card is usable offline.
- Medication/allergy fields are private unless explicitly selected.
- Access and sharing changes are auditable.

### Calls

- Tokens are short-lived and issued only after server membership validation.
- Incoming VoIP pushes are used only for actual calls and reported to CallKit promptly.
- Ending a call releases microphone/camera resources.
- No call recording occurs unless a separate explicit feature and consent flow is approved.

## 11. Verification commands

Run checks proportional to the files changed:

```bash
cd web
npm run typecheck

cd ../mobile
npm run typecheck

cd ../ios
xcrun --sdk iphonesimulator swiftc -typecheck \
  -target arm64-apple-ios17.0-simulator \
  -module-cache-path /private/tmp/slippy-prototype-module-cache \
  Slippy/Utils/SlippyColors.swift \
  Slippy/Views/Trips/JourneyPrototypeView.swift
```

When native dependencies or project capabilities change, regenerate the Xcode project using the repository’s existing XcodeGen workflow and verify the `Slippy` target. Be aware that the full workspace previously had unrelated SlippyWatch build issues; do not hide or attribute those issues to the Trip prototype.

Also test:

- Authenticated Web journey route.
- LINE app LIFF flow on a second LINE account.
- Two real devices for Realtime location and calls.
- Location permission denied/restricted states.
- Network loss and reconnect.
- Trip member removal while chat/location/call is active.
- Expired invite and expired sharing session.
- iOS background/foreground transitions.

## 12. Working-tree protection

The repository may contain many existing user changes and untracked files.

- Inspect `git status` before editing.
- Do not reset, delete, restore, or overwrite unrelated work.
- Prefer new additive migrations and small targeted patches.
- Do not reformat unrelated files.
- Do not regenerate lockfiles unless dependencies actually change.
- Do not commit or push unless explicitly requested.

## 13. Recommended first task for Claude

Implement **Phase 1 only** as a safe vertical slice:

1. Map the existing production trip model to the Journey UI.
2. Add a single idempotent trip-conversation creation path.
3. Add Slippy friend invite and LINE LIFF share invitation.
4. Add structured trip system messages.
5. Add integration tests for authorization and duplicate membership.
6. Keep maps, live location and calls behind disabled feature flags until their credentials, schema and privacy configuration are ready.

Before modifying code, provide:

- The exact files and migrations to change.
- The existing models/APIs being reused.
- Any missing credentials or console settings.
- The security/RLS impact.
- A rollback strategy.

Do not attempt to deliver every phase in one unreviewed change.
