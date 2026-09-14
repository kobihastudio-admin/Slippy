# Trip live location + free voice calling — design

> Date: 2026-08-31
> Status: awaiting user review
> Supersedes-in-part: `docs/SLIPPY_TRIP_FULL_LOOP_CLAUDE_HANDOFF.md` §8 (schema), §9 Phase 3 & Phase 5, §6.5 (VoIP provider) — this spec makes the decisions that document left open and scopes them into one buildable slice.

## 1. Why

The user wants trip companions to be able to (a) stay in voice contact and (b) see each other's live position while traveling, "แบบ walky talky" — so a group never loses track of each other, without depending on any external app. Both features already exist as *planned but disabled* work in the codebase (`web/src/lib/trips/trip-features.ts` — `TRIP_FEATURE_LIVE_LOCATION` and `TRIP_FEATURE_CALLS`, both gated off) and as a fully-specified but decision-incomplete roadmap in the handoff doc above. This spec closes the three decisions that doc left open and turns Phase 3 + Phase 5 of that roadmap into one implementation plan.

## 2. Decisions locked in this session

| Decision | Choice | Why |
|---|---|---|
| VoIP provider | **LiveKit Cloud** | Recommended by the existing handoff doc; generous free tier; open-source core keeps a self-hosted fallback available if usage grows past free-tier cost. |
| Location sharing mode | **Foreground-only, opt-in, time-boxed sessions** | No `NSLocationAlwaysAndWhenInUseUsageDescription` entitlement, no special App Store background-location review, matches the handoff doc's own non-negotiable privacy rules (§2) with the least new attack surface. |
| Call media | **Voice only** | Simpler permission surface (no camera), lower bandwidth for travelers on patchy roaming/hotel wifi, ships faster. Video can be added later behind the same LiveKit room without a redesign. |

Everything below assumes these three choices; it does not re-litigate them.

## 3. Non-negotiable rules (unchanged from the handoff doc §2 — repeated here because they drive every schema/UI choice below)

- No coordinate is ever transmitted before the user explicitly starts a session.
- Sharing is trip-scoped, visible while active (to the sharer, via a persistent indicator), and stoppable in one tap.
- Sharing always has an expiry. Supported durations: 15 min, 1 hour, 4 hours, until end of day. No "forever" option.
- A trip owner/admin can never remotely turn on another member's location.
- Only the latest position is retained — no location history table, no timeline.
- Removing a trip member immediately revokes their access to both location data and call rooms.
- No call audio is recorded or stored, ever.
- VoIP/location provider secrets (`LIVEKIT_API_SECRET`, etc.) exist only in server env vars — never shipped to Web, iOS, or Expo bundles.

## 4. Data model (new, additive migration — does not touch any existing table)

### `trip_location_sessions`
```
id            uuid pk
journey_id    uuid  references life_journeys(id) on delete cascade
user_id       uuid  references auth.users(id)
started_at    timestamptz default now()
expires_at    timestamptz not null        -- started_at + chosen duration
stopped_at    timestamptz null            -- set when the user taps Stop early
created_at    timestamptz default now()
```
One row per sharing session. "Active" = `stopped_at is null and expires_at > now()`.

### `trip_member_locations`
```
session_id    uuid pk references trip_location_sessions(id) on delete cascade
journey_id    uuid  references life_journeys(id) on delete cascade  -- denormalized for RLS simplicity
user_id       uuid  references auth.users(id)
latitude      double precision not null
longitude     double precision not null
accuracy_m    real
heading       real
speed_mps     real
recorded_at   timestamptz not null
```
`session_id` as primary key, not a surrogate id: latest-position-only per the retention rule above means every position update is an `UPSERT ... ON CONFLICT (session_id) DO UPDATE`, never an insert of a new row. There is deliberately no location history to query, back up, or leak.

RLS on both tables: `journey_id` must be a trip the requesting `auth.uid()` is an active participant of (`left_at is null`), reusing the exact membership check `getTripAccess()` already applies to chat/expenses — no new authorization concept.

A `pg_cron` job (5-minute cadence) deletes `trip_location_sessions` rows where `expires_at < now() - interval '1 hour'` (cascades to `trip_member_locations`) — the 1-hour grace window is only so a client that reconnects moments after expiry can still show "sharing ended," not so stale data lingers indefinitely.

### `trip_call_sessions`
```
id                uuid pk
journey_id        uuid references life_journeys(id) on delete cascade
conversation_id   uuid references trip conversation (existing table from trip-conversation.ts)
room_name         text not null           -- LiveKit room identifier, derived from id
initiator_id      uuid references auth.users(id)
status            text not null           -- 'ringing' | 'active' | 'ended' | 'missed'
started_at        timestamptz default now()
ended_at          timestamptz null
```
No participant list, no per-user join/leave log beyond what's needed to render call history without audio — matches the handoff doc's "no call recording occurs" rule by not even structurally supporting it.

## 5. Realtime transport

Both location updates and call ringing/state changes ride the **same** private-per-trip Supabase Realtime channel the chat system already opens for that trip's conversation (`trip:{journey_id}`), as two new event types (`location_update`, `call_state`) rather than a parallel channel — one less thing to secure, one less thing to reconnect on network loss. Per the handoff doc §6.3, this channel must have RLS on `realtime.messages` and public channel access disabled; that's already required infrastructure, not new to this feature.

## 6. Location — client flow

1. User opens the trip map, taps "แชร์ตำแหน่ง" (Share location).
2. Picks a duration (15m / 1h / 4h / rest of day) from a sheet — the sheet **is** the consent UI; there is no separate settings toggle to forget about.
3. Client inserts a `trip_location_sessions` row, requests `CLLocationManager` (`.whenInUse`) / browser `Geolocation` permission if not already granted, and starts posting an upsert every ~10–15s while the app/tab is foregrounded.
4. A persistent small banner ("กำลังแชร์ตำแหน่ง · เหลือ 42 นาที · หยุด") stays visible on every screen while a session is active — this is the "visible while active" rule, not just a map-screen detail.
5. Other trip members see a distinct avatar pin (not a numbered itinerary pin) on the existing `TripMapView`/`trip-map.tsx`, with a live-updating "last seen Xs ago" and a greyed-out "stale" treatment once an update is >60s old (connection dropped, app backgrounded, etc. — the doc's "offline/stale must never look like currently live" rule).
6. Session ends when: the user taps Stop, `expires_at` passes (client stops posting; other clients grey the pin out once the server-side expiry has passed, not just on the sharer's local clock), or the member leaves the trip.

No map redesign — this reuses the `TripMapView`/`trip-map.tsx` components already fixed this session, adding one more pin type and one banner.

## 7. Calling — client flow

1. A "โทร" (Call) button lives next to the trip's existing group chat entry point.
2. Tapping it calls `POST /api/trips/[id]/calls/token`, which: verifies the caller is an active trip member (existing `getTripAccess()`), creates a `trip_call_sessions` row (`status: 'ringing'`), asks the LiveKit server SDK for a short-lived join token scoped to that room, and broadcasts a `call_state: ringing` event on the trip's Realtime channel.
3. Other online members see an incoming-call UI; on iOS this arrives as a **CallKit** native call screen via a **PushKit** VoIP push (so it rings even if Slippy is backgrounded or the phone is locked) — this is why a VoIP APNs auth key is required (§9 below); on Web it's an in-app banner (browsers cannot ring outside an open tab).
4. Accepting connects to the LiveKit room with the same token flow; declining/timing out flips `status` to `missed`.
5. Ending the call (either side, or all participants leaving the room) sets `status: 'ended'`, `ended_at`, and releases the microphone — call history shows who called whom and for how long, never what was said.

## 8. What the assistant will implement directly

- Migration: the three tables above, RLS, `pg_cron` cleanup job.
- `POST /api/trips/[id]/calls/token`, `POST/DELETE /api/trips/[id]/location-sessions`, `POST /api/trips/[id]/location-sessions/[id]/ping` — all reusing `getTripAccess()`.
- Web: share-location sheet + persistent banner + map pin type; call button + LiveKit `livekit-client` integration; flip `Permissions-Policy` from `microphone=(), geolocation=()` to `microphone=(self), geolocation=(self)`; extend CSP `connect-src`/`img-src` for the LiveKit Cloud project's WSS/HTTPS hosts.
- iOS: same share-location flow with `CLLocationManager`; LiveKit Swift SDK + CallKit/PushKit call flow; `NSLocationWhenInUseUsageDescription` and `NSMicrophoneUsageDescription` strings (no `NSLocationAlwaysAndWhenInUseUsageDescription` — foreground-only, per §2 above).
- Tests: RLS/authorization tests for the new routes (non-member cannot fetch a call token or read another trip's locations) using the same injectable-`db` pattern as `medications.test.mjs`; a fake-LiveKit-client unit test for the token route's membership gate.

## 9. What only the user can do (accounts, billing, Apple entitlements — the assistant cannot create third-party accounts or spend money)

1. Create a LiveKit Cloud account/project; copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` into server-only env vars.
2. In Apple Developer, for `app.slippy.ios`: enable **Push Notifications** and **Background Modes → Voice over IP**; generate a VoIP APNs authentication key (`.p8`) and store it in a secret manager (never commit it).
3. Decide (can defer): whether to also enable `TRIP_FEATURE_LIVE_LOCATION` / `TRIP_FEATURE_CALLS` in staging before production, per the existing feature-flag convention in `trip-features.ts`.

## 10. Explicitly out of scope for this slice

- Background location tracking (would need `NSLocationAlwaysAndWhenInUseUsageDescription`, a much heavier App Review conversation, and a battery-drain review — revisit only if foreground sessions prove insufficient in real use).
- Video calling (same LiveKit room supports it later; not built now per the voice-only decision).
- Location history/trails, geofencing, or "meet me here" routing.
- SOS/Safety Hub (handoff doc Phase 4) — a related but separate feature; not bundled into this slice.
- Group calls beyond what LiveKit gives "for free" by being a multi-party room (no special mesh/SFU tuning work planned).

## 11. Acceptance criteria (adapted from the handoff doc §10)

- No coordinate is ever transmitted before the sharing sheet's explicit start action.
- The sharing banner is visible on every screen, not just the map, for the whole active session.
- Stopping, or letting the session expire, is reflected for other members within one Realtime tick — no polling delay.
- A user removed from a trip immediately loses read access to that trip's `trip_member_locations` and cannot mint a call token for it, verified by an integration test, not just RLS existing.
- A call token is only ever issued to a verified active member; the route returns the same 404-shaped "not found" the rest of the app uses for unauthorized trip access (per `trip-features.ts`'s existing convention), not a 403 that would confirm the trip exists.
- Ending a call — from either side — releases the microphone within one UI frame on both platforms.
- No audio is stored anywhere; call history rows contain no media reference.

## 12. Addendum (2026-08-31) — action cams and YouTube Live

Added after the initial review round, in response to two follow-up requests: support for 360 action cameras (specifically the Insta360 X6, released 2026-08-12) and the ability to broadcast a trip live to YouTube.

### 12.1 Action cameras — file import, not device SDK integration

Researched two paths:

1. **Insta360's Camera SDK** (device pairing, remote control, live preview from within our own app) requires applying to Insta360's Enterprise Developer program for an `appId`/`secretKey` — a business approval process, and its published supported-camera list does not yet include the X6 (only up to X5 as of this research). Not a fit for an indie trip app, and blocked on Insta360's own approval regardless.
2. **Importing already-exported 360 media** — every Insta360 camera, including the X6, exports standard equirectangular photo (JPG) and video (MP4) files with spherical metadata through the Insta360 app to the phone's camera roll. These are ordinary files at that point; no camera pairing or SDK is involved.

**Recommendation: path 2.** It works today, for the X6 and any other 360 camera, with no approval process and no dependency on a specific camera's SDK support lagging its hardware release. The only new work is: (a) detecting the spherical-photo/video metadata tag on an imported file so the app knows to treat it specially, and (b) adding a pan-around 360 viewer component to the existing photo/video picker and the Travel Guide, instead of rendering it flat (which looks visibly distorted for an equirectangular image). This slots into the Travel Guide work already in progress — not a new subsystem.

Out of scope for this addendum: live device pairing/remote camera control from within Slippy.

### 12.2 YouTube Live — via LiveKit, not a separate integration

Confirmed: LiveKit Cloud's **Egress** (Room Composite) can push a room's live output as an RTMP stream to YouTube Live (or Twitch, or any custom RTMP target) with no additional infrastructure — it's included for LiveKit Cloud projects. Separately, LiveKit Cloud's **Ingress** does the reverse: it accepts an incoming RTMP (or WHIP) stream and publishes it into a room as an ordinary participant's video track.

The X6's own live-streaming mode (its manual explicitly lists YouTube and **custom RTMP** as destinations, alongside Douyin/Kuaishou/Facebook) is the missing piece that makes this fit together end-to-end, **once Insta360 ships it** — the manual states "Live-streaming functionality will be supported in subsequent firmware updates," so it is documented but not confirmed live on the camera's current firmware as of this research.

**Recommended architecture, buildable now, camera-agnostic until the firmware update lands:**

```
Insta360 X6 (Custom RTMP) ──▶ LiveKit Ingress ──▶ Trip's LiveKit room ──▶ LiveKit Egress ──▶ YouTube Live
                                                         ▲
                                          trip members' voice calls (§7)
```

- A trip's "live broadcast" is its own opt-in session, separate from a normal 1:1/group voice call — the camera and any narrating members share the same room, and Egress composites all of it into one YouTube stream.
- The user configures exactly two things, once per trip: the LiveKit Ingress URL + stream key (generated by our backend) pasted into the X6's own "Custom RTMP" setting, and their YouTube stream key (from YouTube Studio → Go Live) pasted into Slippy. Both are one-time secret handoffs, not a separate external app doing the composition — consistent with the original "no external composition" requirement.
- Nothing here depends on the X6 specifically: the same Ingress endpoint accepts RTMP from OBS, a phone, or any other camera today, so this can be built and tested immediately without waiting on Insta360's firmware update.
- This does **not** change the voice-only decision for normal person-to-person trip calls (§2) — the broadcaster's video track comes from Ingress (the camera), not from every call participant publishing their own camera.

New pieces this adds to §8 (implementation): an Ingress-creation endpoint per trip, an Egress-start/stop endpoint (target: a YouTube stream key the user enters, stored as a secret, never displayed back in full), and the corresponding "ถ่ายทอดสด" (Go Live) UI. Left out of this addendum: exact YouTube stream-key storage/rotation UI details — to be worked out at implementation-plan time, not blocking the architecture decision.

Sources consulted: LiveKit's Egress/Ingress documentation (docs.livekit.io), Insta360's X6 online manual live-streaming tutorial (onlinemanual.insta360.com), Insta360's developer/SDK program page (insta360.com/developer).
