# Journey Team Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Journey a structured, private trip hub across web and native iOS with crew profiles, map navigation, documents, LINE resources and shared settlement.

**Architecture:** Keep `life_journeys` as the aggregate root and participant-scoped RLS as the access boundary. Add presentation and navigation components around the existing Journey data first, then add typed data extensions for resources and financial exchange data without changing existing rows.

**Tech Stack:** Next.js/React/TypeScript, Supabase/Postgres/RLS, SwiftUI/MapKit, LINE Messaging API/LIFF.

**Spec:** `docs/superpowers/specs/2026-09-02-journey-team-hub-design.md`

## Global Constraints

- Preserve all existing trip data and current participant-scoped access policy.
- Google Map is embedded on web; Apple Maps opens through a supported URL/deep link until MapKit JS credentials are provisioned.
- Personal records are private by default and require a sharing flag for the trip.
- Use Thai interface copy with clear, action-oriented labels.

---

### Task 1: Responsive Journey composition

**Files:**
- Modify: `web/src/components/trips/trip-journey-client.tsx`
- Test: `web/src/lib/trips/journey.test.mjs`

**Interfaces:**
- Consumes: `JourneyTrip`, `JourneyParticipant`, `JourneyDay`.
- Produces: `JourneyLayoutState` and overview controls with non-overlapping hero, collapsible snapshot rail and focused map action.

- [ ] Write a failing test asserting the Journey layout configuration supplies Google and Apple map modes and a collapsed snapshot default.
- [ ] Run the focused test and confirm it fails because the configuration is absent.
- [ ] Implement the layout configuration and responsive overview controls.
- [ ] Run focused test, TypeScript check and visual browser inspection.

### Task 2: Crew profiles and selectable character icon library

**Files:**
- Modify: `web/src/components/trips/trip-journey-client.tsx`
- Modify: `web/src/lib/trips/journey.ts`
- Modify: `ios/Slippy/Views/Trips/JourneyPrototypeView.swift`
- Test: `web/src/lib/trips/journey.test.mjs`

**Interfaces:**
- Produces: `JourneyCharacterIcon`, `JourneyParticipantProfileLink`.
- Consumes: `avatar_url`, `trip_role`, `profile_shared_with_trip`.

- [ ] Write a failing test asserting icon identifiers resolve to stable avatar assets.
- [ ] Verify the test fails before the icon library exists.
- [ ] Implement avatar selection presentation, add-member affordance and person-only Crew cards; keep mascots on identity cards only.
- [ ] Verify TypeScript and iOS generic-device builds.

### Task 3: Map modes and map-first itinerary

**Files:**
- Modify: `web/src/components/trips/trip-map.tsx` or its loader and Journey client
- Modify: `ios/Slippy/Views/Trips/JourneyPrototypeView.swift`
- Test: `web/src/lib/trips/google-maps-links.test.mjs`

**Interfaces:**
- Produces: `mapProvider` (`google` | `apple`), `compact` and `fullScreen` display states.

- [ ] Write failing tests for Apple Maps direction URLs and Google URLs for the same itinerary coordinates.
- [ ] Confirm failure before the Apple URL helper/control is added.
- [ ] Implement map-provider controls and desktop/mobile resizing/full-screen behavior.
- [ ] Run map URL tests and browser interaction test.

### Task 4: Formal travel documents and exchanged expenses

**Files:**
- Modify: `web/src/components/trips/trip-journey-client.tsx`
- Modify: `web/src/app/(app)/trips/[id]/expenses/*`
- Create: `supabase/migrations/098_trip_document_records_and_exchange_rates.sql`
- Test: `web/src/lib/trips/trip-document-html.test.mjs`

**Interfaces:**
- Produces: document metadata fields and editable expense exchange-rate input.
- Consumes: existing `trip_documents`, `trip_expenses`, `expense_splits`, `trip_payments`.

- [ ] Write failing tests for document field normalization and original-currency-to-base conversion.
- [ ] Confirm failure before the normalizers exist.
- [ ] Add backward-compatible migration and forms; route payments and splits through existing settlement records.
- [ ] Run focused tests and validate RLS with the existing trip participant SQL suite.

### Task 5: LINE Group resource hub

**Files:**
- Modify: `api/src/services/line-trip.ts`
- Create: `api/src/services/line-trip-resources.ts`
- Create: `supabase/migrations/099_trip_group_resources.sql`
- Test: `api/src/services/line-trip-resources.test.ts`

**Interfaces:**
- Produces: `recordTripGroupResource({ journeyId, groupId, type, sourceUrl, authorId, privacy })`.
- Consumes: `life_journeys.line_group_id` and active trip participant checks.

- [ ] Write failing tests rejecting a mismatched LINE group and accepting a bound group resource.
- [ ] Confirm the test fails before the resource validator exists.
- [ ] Implement validator, resource storage and webhook/LIFF handoff for note, album, calendar event, link, file and voice reference.
- [ ] Run API tests and RLS migration test.

### Task 6: Deploy and end-to-end verification

**Files:**
- Modify: deployment assets only if build/runtime configuration requires it.

- [ ] Run all focused web, API and SQL tests plus `npm run typecheck --workspace=web`.
- [ ] Run iOS generic iPhone build with code signing disabled.
- [ ] Build and deploy the web container using the existing Synology stack.
- [ ] Confirm authenticated dashboard → trip → overview → map → documents → expenses in a browser and report any iOS simulator limitation separately.
