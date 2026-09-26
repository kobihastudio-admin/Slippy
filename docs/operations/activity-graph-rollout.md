# Activity Graph rollout runbook

## Purpose and scope

This runbook releases the additive Activity Graph foundation without replacing
the existing trip itinerary, map, documents, expenses, LINE, or profile flows.
`activities` is the canonical record for an activity. Existing trip rows remain
where they are and are linked through nullable references.

## Production gate

Do **not** run `supabase db push` until all items below are true:

1. The linked Supabase migration history agrees with the repository migration
   files. Prefer recovering any missing historical source from the approved
   backup/NAS archive. If source recovery is impossible, a release may use a
   reviewed, explicitly documented no-op ledger placeholder only after an
   approved database snapshot; it must not be represented as the original SQL.
2. A recoverable database backup has a named destination, retention period,
   encryption owner, and named restore operator.
3. The restore operator has restored that backup to an isolated database and
   run the reconciliation query below.
4. The web and iOS builds listed in **Verification** pass from the release
   commit.

This gate prevents a new feature migration from being marked applied against an
unknown schema baseline. It does not delete or repair any existing data.

### Baseline reconciliation record (2026-09-03)

The linked remote database contained these historical versions without source
files in the repository, reachable git objects, or the inspected NAS archives:

`20260829080740`, `20260829145238`, `20260830015906`,
`20260831030024`, and `20260831103354`.

After an approved remote snapshot, their migration-history entries were
reconciled with committed **no-op ledger placeholders**. Those files only make
the repository ledger match the already-existing remote state; they are not a
reconstruction of the original migrations and must never be reapplied to
recreate schema. A future archival-recovery task should still seek the original
SQL.

The same preflight marked three known, already-present remote schema versions
as applied without executing them again: `20260829150000`, `20260829180000`,
and `20260830090000`. This avoided regressing existing medication and task
schema while allowing the additive trip-location and Activity Graph migrations
to run in order.

## Pre-deploy backup record

Record the following in the release ticket before the production migration:

| Field | Required value |
| --- | --- |
| Backup destination | Immutable NAS/S3 path, not a local temporary directory |
| Retention | Explicit duration and deletion owner |
| Encryption owner | Person/team that controls the recovery key |
| Restore operator | Person who performed an isolated restore test |
| Schema checksum | SHA-256 of the schema dump and recovered migration files |
| Restore evidence | Timestamp and reconciliation result |

### Release record — 2026-09-03

- Snapshot destination: `/volume1/homes/chainimit/Backup/Slippy-release-preflight/20260903T140000/`
- Snapshot contents: schema and public-data SQL dumps with
  `slippy-remote-pre-reconcile-20260903T140000-SHA256SUMS.txt`; both checksums
  were verified on the NAS.
- Restore note: the public-data dump contains circular foreign keys in the
  existing `documents`/`split_participants` model, so an isolated restore must
  use a complete Postgres restore procedure with the appropriate constraint
  handling. It was not represented as a completed restore test.
- Applied additive migrations: `20260831090000_trip_location_and_calls`,
  `20260903012138_activity_graph`, and
  `20260903053736_activity_trip_projection`.
- Reconciliation result: `activity_trip_reconciliation` returned zero rows
  with `unlinked_item_count <> 0` immediately after deployment.

## Migration deployment

After the production gate is approved:

```bash
supabase db push --linked
```

Apply the migrations in their committed order. The itinerary projection is
idempotent: for each itinerary item without a linked activity it inserts one
`activities` row (visibility `private`, status `published`, or `cancelled` for
cancelled items) and then fills the null `trip_itinerary_items.activity_id`. It
never deletes a trip field or moves itinerary data.

## Verification

Run from the release commit; both must pass before the production gate:

```bash
npm run build                                   # web (next build) and api (tsc)
xcodebuild -project ios/Slippy.xcodeproj -scheme Slippy \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Reconciliation

Immediately after deployment, run as a privileged release operator:

```sql
select *
from public.activity_trip_reconciliation
where unlinked_item_count <> 0;
```

Expected result: no rows for journeys whose itinerary items have been
projected. Investigate rows before enabling Activity Graph navigation for that
journey. Do not manually rewrite itinerary rows to force a zero result.

## Security acceptance checklist

- [ ] No unexpected rows in `activity_trip_reconciliation`.
- [ ] Private activity is absent from Explore, public API, map, and public join preview.
- [ ] Public published activity is discoverable without private resources.
- [ ] Raw registration tokens do not appear in database queries or logs.
- [ ] Existing trip route, web Google Map/Apple Maps action, and iOS MapKit/Google link still work.
- [ ] Backup destination, retention, encryption owner, and restore operator are approved.

Review note (2026-09-26): these items are unchecked because they need runtime,
log, database, or staging access. A repository review confirmed only the code
side (token hashing, Explore filtering, RLS policies); it does not tick them.

## Browser smoke test

In authenticated staging, verify:

1. `/trips` still opens an existing trip and itinerary/map actions work.
2. `/activities` opens My Feed, Group, and Explore scopes.
3. A private item appears only for its owner/participant; it never appears in
   Explore.
4. Create one registration link, join once while signed in, then confirm the
   second join reports `joined: false` and does not consume another use.
5. The Kyushu trip keeps its existing Google Map in-page behavior and its Apple
   Maps action still opens Apple Maps first.

## Rollback

Do not drop Activity Graph tables during an incident. There is currently no
feature flag for Activities (flags exist only for trips, `TRIP_FEATURE_*`), so
disabling the Activities navigation/API means a code change and redeploy; keep
legacy `/trips` live in the meantime, and restore from the approved backup only
if a data-restoration incident is declared. The additive links use
`ON DELETE SET NULL` so a future controlled removal does not delete legacy
itinerary items.
