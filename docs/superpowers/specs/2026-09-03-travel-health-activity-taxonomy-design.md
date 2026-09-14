# Travel and Health Activity Taxonomy — Design

**Status:** approved on 2026-09-03.

## Goal

Give trips, trip activities, documents, costs, and medication a single
presentation taxonomy on Slippy Web and native iOS. The taxonomy makes the
same data recognizable everywhere without moving, deleting, or reclassifying
existing personal records automatically.

## Scope and boundary

This is a presentation and navigation contract. It adds stable category keys,
labels, icon fallbacks, accent tokens, and themed artwork references. Existing
trip, medication, document, expense, and reminder tables remain the sources of
truth. No health data is shared, published, or attached to a trip merely by
being placed in the `health` category.

## Canonical categories

| Key | Thai label | Meaning | Web fallback | iOS fallback |
| --- | --- | --- | --- | --- |
| `transport` | การเดินทาง | flight, rail, car, local transit | Plane | airplane |
| `place` | สถานที่และแผนที่ | destination, venue, directions | MapPin | mappin.and.ellipse |
| `stay` | ที่พัก | hotel, ryokan, check-in/out | BedDouble | bed.double.fill |
| `food` | อาหาร | meal, cafe, reservation | Utensils | fork.knife |
| `sightseeing` | เที่ยวชม | museum, shrine, attraction | Camera | camera.fill |
| `nature` | ธรรมชาติ | park, mountain, outdoor | Trees | leaf.fill |
| `shopping` | ช้อปปิ้ง | stores, souvenirs | ShoppingBag | bag.fill |
| `reservation` | ตั๋วและการจอง | ticket, booking, confirmation | Ticket | ticket.fill |
| `document` | เอกสาร | passport, insurance, uploaded record | FileText | doc.text.fill |
| `money` | ค่าใช้จ่าย | expense, split, settlement, exchange rate | WalletCards | wallet.pass.fill |
| `people` | ทีมและการแชร์ | crew, invitation, permission | Users | person.2.fill |
| `safety` | ความปลอดภัย | emergency, insurance, contacts | ShieldCheck | shield.checkered |
| `memory` | บันทึกการเดินทาง | photos, diary, voice, notes | Image | photo.on.rectangle.angled |
| `health` | สุขภาพและยา | medicine, appointment, medical record | Cross | cross.case.fill |
| `general` | อื่นๆ | valid fallback when no category exists | Sparkles | sparkles |

Every category owns a semantic accent token rather than an arbitrary colour on
each screen. The Kyushu theme may add an illustration or mascot background to
cards, but the standard symbol remains visible for accessibility and for
platforms that do not ship the artwork.

## Mapping rules

1. A trip's `trip_type` maps to a primary category only for display. A trip
   never changes type as a side effect of rendering.
2. An itinerary item keeps its existing type. The presentation layer maps its
   type to one category; unknown types resolve to `general`.
3. Medication, medication schedule, label image, provider, and reminder views
   resolve to `health`; medical data is never included in a trip export or a
   crew card.
4. Existing expense categories map to `money`; existing documents map to
   `document`. Stored category strings remain unchanged in this release.
5. URLs, APIs, database keys, and user-entered labels remain backwards
   compatible. Only typed display helpers are newly consumed by UI code.

## Web experience

`web/src/lib/activity-taxonomy.ts` is the single display source for category
labels, Lucide icon names, tone classes, and trip/itinerary/expense mapping.
Trips show a category tile in their picker, filter, and card. The Health &
Medication area uses the same `health` tile and groups medication-related
actions under one clear heading. The themed Kyushu journey may use existing
character art for person and identity cards; it does not replace operational
icons such as tickets or medication.

## Native iOS experience

`ios/Slippy/Models/ActivityTaxonomy.swift` mirrors the category keys and
labels. `JourneyStyle` delegates its current item presentation to this model.
SwiftUI screens use the taxonomy's SF Symbol and colour token. This preserves
native behaviour while giving iOS and Web the same category meaning.

## Safety and privacy

- Health remains personal by default. Any future trip-health share needs its
  own consent field, policy, and audit trail; this project does not add one.
- A missing, malformed, or legacy category must render as `general`, never
  fail the trip or medication screen.
- No migration or backfill writes to user records in this implementation.

## Verification

- Unit tests assert every public category has a label and fallback icon.
- Mapping tests cover trip types, itinerary types, expense categories,
  medications, and unknown inputs.
- Web typecheck and production build pass.
- Native iOS generic simulator build passes.
- Existing trip, medication, Apple Maps, profile, and demo-guard tests remain
  green.
