# Journey Team Hub Design

## Goal

Extend Slippy Journey on web and native iOS into a private, shared trip hub:
crew profiles and avatars, dual-map navigation, structured trip documents,
LINE group-linked content, and shared expense settlement.

## Product boundaries

- Existing journeys, itinerary rows, participants, documents, photos, notes and
  expenses remain readable without migration-side data loss.
- A member controls which personal profile fields are shared with a trip.
- Google Maps remains the interactive embedded web map. Apple Maps is an
  explicit navigation target through its supported URL scheme until a MapKit JS
  token is configured.
- LINE is an ingestion and sharing channel. Files, links, notes, album items,
  events and voice references are stored as first-class trip records, not only
  as opaque chat history.

## Experience

### Overview

The countdown sits in the upper-left safe area and never overlays faces. Hero
copy aligns to the lower edge over a dark gradient. Desktop uses the full
content width with a collapsible right-side snapshot rail. Mobile moves that
rail into a non-blocking bottom sheet and preserves access to the tab bar.

### Crew and identity

Crew cards are person-only cards. They open a per-person trip profile and can
add a member. Character icons form a selectable avatar library. Lucky mascots
remain only on reversible Travel Identity luggage-tag cards.

### Navigation

Itinerary and map screens put a sizable, resizable map pane on the left and a
day/timeline pane on the right on desktop. On mobile the map is above the
timeline and supports a full-screen sheet. Map mode control exposes Google
Map and Apple Maps; the latter opens the selected location/directions in Apple
Maps, avoiding a misleading embedded Apple map.

### Money and documents

Expenses store their entered currency, exchange rate and base-currency amount.
Each expense can be edited and split among trip participants. Documents use a
formal travel-record schema: kind, owner, issuer, dates, reference number,
currency/amount, privacy, original file, AI extraction status and reviewed
fields.

## Data and integration design

1. `trip_participants` carries profile/role/share data already introduced by
   the current Journey privacy migration. A person-level trip hub view reads
   only the participant's permitted fields and related records.
2. A small `trip_resources` model (or an equivalent documented extension of
   `trip_notes`/`trip_documents`) classifies LINE imports as note, link, album,
   event, file or voice. Each record stores its source, LINE group reference,
   author, sharing scope and immutable source URL when applicable.
3. `life_journeys.line_group_id` is the single LINE binding. LIFF and webhook
   ingestion only attach content after validating the active trip participant
   or allowed group binding.
4. Existing `trip_expenses`, `expense_splits` and `trip_payments` are the
   settlement source of truth. Exchange-rate metadata supplements, never
   replaces, original expense amounts.

## Delivery sequence

1. Web information architecture and responsive Journey layout.
2. Per-person crew profile navigation and icon/identity presentation.
3. Map mode controls and full-screen/compact map interaction.
4. Formal document capture and editable expense exchange-rate/split workflow.
5. Native iOS parity for the same trip navigation model.
6. LINE Group resource ingestion adapter, webhook validation and activity
   timeline, followed by end-to-end integration tests.

## Safety and verification

- RLS remains participant-scoped for every trip resource and financial row.
- No personal document or avatar is exposed to a trip unless explicitly shared.
- Web: TypeScript, unit tests, production build and authenticated browser
  journey test.
- iOS: generic iPhone build; simulator/manual test when an installed runtime
  is available.
