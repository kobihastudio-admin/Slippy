# Activity-first information architecture

**Status:** proposed for review
**Scope:** Slippy web, native iOS, LINE-connected experiences, and the shared Life Graph
**Decision:** activities are the canonical, shareable unit of participation. A trip is a specialized collection of activities, not an isolated feature.

## 1. Goal

Make **Trips & Activities** the place where people discover, plan, join, and share real-world moments. The system must keep private life data private by default while allowing an owner to publish selected activities, share registration links, and bring approved external activity sources into Slippy.

This change organizes existing capability without deleting existing trip, document, finance, or profile data.

## 2. Product principles

1. **Activity-first, not feed-first.** A Feed is a query over activities; it is never a second copy of activity data.
2. **One canonical reference.** Every cross-feature link uses stable IDs: `activity_id`, `trip_id`, `group_id`, `registration_id`, and `resource_id`.
3. **Private by default.** The owner explicitly selects Private, Group, or Public visibility for each activity.
4. **Connect outward with consent.** External links, registration pages, LINE content, calendars, photos, notes, files, and voices are attached as resources with clear ownership and access control.
5. **Keep existing links working.** Existing trip URLs, documents, and iOS deep links remain valid throughout the rollout.
6. **No destructive migration.** New data is introduced alongside current tables; verified backfill and a rollback path precede any retirement decision.

## 3. Navigation and information architecture

The visual sidebar and iOS tab/navigation structure use the same mental model.

| Area | Purpose | Primary routes / iOS destination |
| --- | --- | --- |
| **Explore** | Today, suggested activities, saved items, and activity Feed | `/dashboard` evolves into Today; new `/explore` |
| **Trips & Activities** | Trips, calendar, map, activity Feed, groups, and registrations | existing `/trips`; new activity sub-routes |
| **Create** | Create a trip, activity, group, registration link, note, or expense | global create sheet/menu |
| **My Space** | Personal documents, finances, health, relationships, and private collections | existing domain routes, reorganized under this label |
| **Work** | Reports, tax, vendors, billing, and shared organizational work | existing work/finance routes |
| **Settings** | Profile, privacy, integrations, notifications, members, and help | existing settings routes |

`/trips` remains the existing entry point. It gains an Activities view rather than being replaced. `/dashboard` remains a stable URL and becomes the personal Today/Explore landing view; no bookmarked link is broken.

## 4. Canonical domain model

### 4.1 New core records

#### `activities`

The source of truth for anything a person may plan, attend, save, or share.

| Field | Notes |
| --- | --- |
| `id` | UUID, exposed as `activity_id` |
| `owner_id` | authenticated creator |
| `trip_id` | nullable link to `trips.id` |
| `group_id` | nullable link to `community_groups.id` |
| `title`, `summary`, `category` | human-readable activity content |
| `visibility` | `private`, `group`, or `public`; defaults to `private` |
| `status` | draft, published, cancelled, completed |
| `location_name`, `location_point`, `timezone` | precise data protected by visibility rules |
| `starts_at`, `ends_at` | occurrence defaults for simple activities |
| `source_type`, `source_url` | manual, imported, LINE, partner, or calendar |
| audit fields | `created_at`, `updated_at`, `published_at` |

#### `activity_occurrences`

Supports repeat events and itinerary moments without duplicating the parent activity. Includes `activity_id`, start/end timestamps, a display order, venue override, and cancellation state.

#### `activity_participants`

The membership and attendance record. Includes `activity_id`, `profile_id` or invited contact, role (`owner`, `organizer`, `member`, `guest`), RSVP state, and joined timestamp. This is the authoritative record for participant lists.

#### `activity_resources`

An ordered, permission-aware reference layer. Each row has `activity_id`, `resource_id`, `resource_type`, role (`document`, `note`, `album`, `file`, `voice`, `link`, `calendar_event`, `LINE_message`), and an optional label. Resource bodies stay in their owning system/table; this table only stores references.

#### `activity_registration_links`

Shareable enrollment links with `activity_id`, a non-reversible token hash, expiration, max-use count, optional invitee email/LINE identity, and revoked timestamp. Raw tokens are shown only at creation time.

#### `activity_interests`

Private per-user state for saved, hidden, and interested activities. It enables recommendations without turning a private activity into a public record.

### 4.2 Existing data relationship

| Existing record | Relationship after rollout |
| --- | --- |
| `trips` | A trip groups its child activities through `activities.trip_id`. Its itinerary remains available and is projected into activity occurrences. |
| `trip_itinerary_days` / `trip_itinerary_items` | Retained as current editing model during rollout; each item gains a nullable activity reference after backfill. |
| `trip_participants` | Remains authoritative for trip membership; synchronized with activity participants only for activities in that trip. |
| `trip_documents`, `trip_notes`, `trip_photos`, location/call records | Kept in place; attached to activities through `activity_resources` where relevant. |
| `community_groups` | Becomes the optional group audience and organizer container using `activities.group_id`. |
| Split expenses and settlements | Stay financial records; may reference an activity for context but are not copied into activity payloads. |

## 5. Feed, discovery, and registration

### Feed rules

The Feed is a materialized query/view, not an independently authored entity:

- **My Feed:** private activities owned by or shared with the viewer, their saved items, and relevant trip moments.
- **Group Feed:** activities visible to the viewer through `group_id` membership.
- **Explore:** only public, published activities plus curated external items explicitly imported for discovery.
- **Recommendations:** opt-in suggestions based on stated interests, saved categories, approximate region, and calendar availability. They never reveal a private address, participant list, document, or profile detail.

Every Feed card links to the same activity detail view and its `activity_id`.

### Registration flow

1. Owner creates or publishes an activity and chooses visibility.
2. Owner creates a registration link with access, expiry, and capacity controls.
3. Recipient opens the link, sees a privacy-safe activity preview, signs in or identifies through the permitted channel, and accepts the invitation.
4. The system creates or updates `activity_participants`, records the `registration_id`, and issues only the permissions selected by the owner.
5. The activity appears in the recipient's My Feed and optionally their calendar after confirmation.

## 6. Privacy, permissions, and LINE/external connections

### Visibility contract

| Visibility | Who can discover it | What is protected |
| --- | --- | --- |
| Private | owner and explicitly invited participants | all data outside permitted invitees |
| Group | active group members and invited guests | exact location, documents, and member data unless individually shared |
| Public | signed-out previews and eligible Explore users | private resources, direct contacts, precise home/private venues, and attendee details |

Row-level security is enforced on core records and reference tables. Front-end filtering is only a presentation convenience, never an access-control mechanism.

### LINE Group integration

LINE is an optional connection, not a data sink. A connected group can be selected as an activity source or notification channel. Notes, albums, calendar events, links, files, and voice items are imported or referenced only after the group/admin grants the relevant scope and the activity owner chooses where they belong. The UI must show source, import time, access scope, and a disconnect/delete-reference action for every imported item.

### External links and calendars

External registration links remain external until a user deliberately opens them. Calendar export/import uses explicit confirmation. Maps preserve the current web default (Google Map in-page) with an Apple Maps action that opens Apple Maps/its website; native iOS continues to use MapKit with Google deep-link support.

## 7. Web and iOS experience

- One shared taxonomy and data contract; platform-native navigation and controls remain appropriate to each platform.
- The web sidebar is regrouped gradually behind stable routes. Mobile web uses a non-overlapping drawer with clear dismiss behavior.
- Native iOS uses a compact tab/navigation hierarchy: Today, Trips & Activities, Create, My Space, and Settings. Activity detail contains Overview, Plan, Map, Resources, People, and Cost where applicable.
- Profile cards retain personal avatar/character assets and link to that member's profile; mascots remain travel-identity assets rather than replacing people.
- The existing Kyushu anime journey remains a trip theme/content package, independent from the core activity model.

## 8. Migration, verification, and backup safeguards

### Planned migrations

1. `20260903090000_activity_graph.sql` — additive core tables, indexes, enum/check constraints, and non-destructive nullable references.
2. `20260903100000_activity_trip_projection.sql` — idempotent trip itinerary projection/backfill and reconciliation views.
3. `20260903110000_activity_graph_rls.sql` — RLS policies, secure registration token handling, and audit triggers.

Names are proposed; exact sequence will be checked against the migration directory before implementation.

### Required rollout order

1. Inventory current schema, route usage, record counts, and storage references.
2. Produce a timestamped, encrypted database/storage export to an approved backup destination; validate the restore manifest. No data transformation starts without a recoverable baseline.
3. Apply additive schema migrations in staging and run the idempotent backfill.
4. Verify row counts, orphan counts, ownership, access policies, trip itinerary totals, documents/photos/notes references, and legacy route behavior.
5. Enable Activity views behind a feature flag; keep legacy trip views available.
6. Perform web, iOS, LINE-sandbox, registration, privacy, map, and expense flow acceptance testing.
7. Deploy progressively, monitor reconciliation metrics, then only later decide whether any legacy fields can be deprecated. No existing table is deleted in this project phase.

### Backup boundary

The backup/move phase is a separate controlled operation after the implementation and acceptance checklist are complete. It needs an approved destination, retention period, encryption/key owner, restore operator, and a verified restore test. This design intentionally does not copy or move user data.

## 9. Acceptance criteria

- A user can create a private or public activity, attach it to an optional trip/group, and see it in the correct Feed.
- A registration link respects expiry, capacity, revocation, and visibility; joining creates exactly one participant membership.
- An attached note, document, album, link, file, voice, calendar event, or LINE item is accessible only to authorized users and opens its canonical source.
- Existing trip URLs and the Kyushu journey retain their data and layout after migration.
- Web Google Map and Apple Maps action work; iOS MapKit and Google deep link work.
- Private activities and resources are not discoverable through Explore, search, map, Feed API, or public registration preview.
- Finance links retain existing split/settlement values and optionally show activity context without duplicating transactions.
- Production deployment occurs only after clean build/typecheck, migration reconciliation, browser smoke test, iOS build, and a verified backup/restore runbook.

## 10. Out of scope for this phase

- Automatically publishing a user's personal activity to a public Feed.
- Scraping external platforms without consent or a supported connector.
- Deleting current trip/document/finance tables.
- Claiming LINE API, payment collection, or iOS App Store deployment is live before credentials, permissions, and end-to-end tests are completed.
