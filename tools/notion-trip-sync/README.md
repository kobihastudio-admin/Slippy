# Notion → trip sync (CR-005)

One-way, repeatable import of a Notion trip page into the trip tables. The 2026-10-12 import was done by
hand; this makes the same thing safe to run again.

## Flow
1. **Read** the Notion trip page (itinerary, checklist, notes, places) and write a snapshot JSON in the shape
   below. Each row gets a stable `key` — it is stored in `source_id`, which is what makes a re-run update
   or skip rows instead of duplicating them. Keep a key the same for the same thing even if its title changes.
2. **Generate** SQL: `node generate-sql.mjs snapshot.json > sync.sql` (add `--mode=update` to let Notion overwrite).
3. **Review** `sync.sql`, then run it against the project. The script prints SQL only; it has no credentials and
   makes no network calls. Never put a Notion token or a database key in this folder or in the snapshot.

## Modes
| Mode | Existing row (same `source_id`) |
|---|---|
| `insert-only` (default) | left exactly as it is — edits made in the app are never lost |
| `update` | content fields are overwritten with the snapshot |

Even in `update` mode these are owned by the group in the app and are never overwritten: checklist `is_done`,
candidate `status`, and votes.

## Snapshot shape
```json
{
  "journeyId": "<uuid of life_journeys row>",
  "days": [{ "key": "day-1", "day_number": 1, "date": "2026-11-21", "title": "", "city": "", "summary": "",
             "items": [{ "key": "hotel-blossom-1", "type": "hotel", "title": "", "location": "", "time_from": "09:00",
                         "time_to": null, "status": "planned|confirmed|optional|cancelled", "provider": "",
                         "confirmation_code": "", "amount": 0, "currency": "JPY", "notes": "", "details": {} }] }],
  "checklist": [{ "key": "passport", "title": "", "category": "", "is_done": false }],
  "notes": [{ "key": "bookings", "title": "", "body": "", "tag": "booking", "is_pinned": false }],
  "candidates": [{ "key": "v:d1:kushida", "kind": "place|food|souvenir", "day_number": 1, "title": "", "note": "",
                   "maps_url": "", "price_hint": "", "needs_booking": false, "status": "open" }]
}
```

New itinerary lines are mirrored into the Activity Graph by the last statements of the output (the same
statements as migration `20260903053736`).

## Keys already in the database (2026-10-12 import)
The rows created by hand on 2026-10-12 were given keys so a first run does not duplicate them:
days `day-<n>`; items `i-<first 8 hex of md5("<day number>|<lower-case title as it was>")>`; checklist `c-<sort_order>`;
notes `n-<first 8 hex of md5(lower-case title)>`; places `v:<...>`. Before the first real run, export the
current rows (their `source_id`s) into the snapshot instead of inventing new keys.

## Not covered (decide before building)
Writing app changes back to Notion; deleting rows that disappeared from Notion; expenses and payments (the
source does not say who paid, so they are never imported).

## Test
`node --test generate-sql.test.mjs`
