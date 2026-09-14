# Trip Map — Search, Photos, Offline Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-Places-backed name search with photos to the iOS trip map, wire the already-built manual photo upload into it, cache stop data + photos on-device for offline viewing, and fix the one real icon mismatch (`activity` category).

**Architecture:** One new backend endpoint (`/api/places/search`) reuses the Google API key, `place_cache` table, and upsert pattern already live in `web/src/app/api/places/route.ts`. iOS gets a new `PlacesSearchAPI.swift` (same Bearer-token pattern as the existing `TripDocumentAPI.swift`) wired into `TripMapView.swift`'s search bar and `AddStopSheet`. A small on-device cache (`TripOfflineCache.swift`) downloads each stop's photo the first time it's seen online; a `NetworkStatus.swift` singleton gates the map surface when offline.

**Tech Stack:** Next.js API routes (TypeScript, `node:test` for unit tests), Swift/SwiftUI (Xcode build is the verification gate — this project has no XCTest target), Supabase (`place_cache`, `trip_itinerary_items.details` jsonb, `trip_photos`).

**Spec:** `docs/superpowers/specs/2026-08-30-trip-map-google-places-design.md`

## Global Constraints

- No Google API key, ever, in the iOS bundle — all Google calls go through `api.slippyai.app` (Decision 4 in the spec).
- No new Supabase tables or migrations — `place_cache`, `trip_itinerary_items.details` (jsonb), and `trip_photos` already have everything needed (spec, "Existing infrastructure").
- iOS has no XCTest target (confirmed: zero `XCTest`/`SlippyTests` references in `Slippy.xcodeproj/project.pbxproj`, no `*Tests` directory). Every iOS task's verification is `xcodebuild ... build` succeeding with 0 errors, plus a simulator check for anything UI-visible — this matches how every iOS fix earlier in this project's history was actually verified, not a gap introduced by this plan.
- Web/TypeScript unit tests use Node's built-in runner directly against `.ts` files: `node --import tsx --test <path>` (confirmed working invocation, verified against the existing `web/src/lib/trips/trip-conversation.test.mjs`).
- Thai user-facing strings throughout (matches every existing string in `TripMapView.swift`/`AddStopSheet`).

---

## Task 1: Backend — `/api/places/search` endpoint

**Files:**
- Create: `web/src/app/api/places/search/route.ts`
- Create: `web/src/app/api/places/search/route.test.mjs`

**Interfaces:**
- Produces: `GET /api/places/search?q=<text>&lat=&lng=` → `{ results: SearchResult[], has_google_key: boolean }` where `SearchResult = { id, name, type, address, lat, lng, rating, user_ratings, photo_url, price_level, is_open, maps_url, label, emoji }` — same shape as `/api/places`'s existing result objects (see `web/src/app/api/places/route.ts:57-77`), so Task 4 (iOS client) can share one Swift model with a future nearby-search client.
- Produces (exported, for the unit test): `toSearchResult(raw: GoogleTextSearchResult, googleKey: string): SearchResult` — a pure function, same pattern as `toPlace()` in `web/src/app/api/trips/geocode/route.ts:27-37`.
- Consumes: nothing from other tasks — this is the first task and has no dependency.

- [ ] **Step 1: Write the route**

```typescript
// web/src/app/api/places/search/route.ts
/**
 * Name search for the trip map's search bar — "type a name, get suggestions
 * with photos", the one thing the existing places endpoints don't cover:
 *   • /api/places is Nearby Search (category/radius), not name search.
 *   • /api/trips/geocode is name search, but via free Nominatim — no photos,
 *     no ratings, so a place found there would need a second lookup anyway.
 *
 * Same Google key, same place_cache table, same upsert pattern as
 * /api/places — see that file's Step 3 for the sibling implementation this
 * one is deliberately kept parallel to.
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

const GOOGLE_TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json"
const GOOGLE_KEY = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""

const PLACE_TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  restaurant:         { label: "ร้านอาหาร",   emoji: "🍽️" },
  cafe:               { label: "คาเฟ่",        emoji: "☕" },
  lodging:            { label: "โรงแรม",       emoji: "🏨" },
  shopping_mall:      { label: "ห้างฯ",        emoji: "🛍️" },
  tourist_attraction: { label: "ท่องเที่ยว",   emoji: "🏛️" },
  spa:                { label: "สปา",          emoji: "💆" },
  establishment:      { label: "ทั่วไป",       emoji: "📍" },
}

export interface GoogleTextSearchResult {
  place_id: string
  name: string
  formatted_address?: string
  geometry: { location: { lat: number; lng: number } }
  rating?: number
  user_ratings_total?: number
  photos?: { photo_reference: string }[]
  price_level?: number
  opening_hours?: { open_now?: boolean }
  types?: string[]
}

export interface SearchResult {
  id: string
  name: string
  type: string
  address: string | null
  lat: number
  lng: number
  rating: number | null
  user_ratings: number | null
  photo_url: string | null
  price_level: number | null
  is_open: boolean | null
  maps_url: string
  label: string
  emoji: string
}

/** Pure — reshapes one Google Text Search result. No network, no DB, unit-testable. */
export function toSearchResult(raw: GoogleTextSearchResult, googleKey: string): SearchResult {
  const type = raw.types?.[0] ?? "establishment"
  const photo = raw.photos?.[0]
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${raw.photos[0].photo_reference}&key=${googleKey}`
    : null
  return {
    id: raw.place_id,
    name: raw.name,
    type,
    address: raw.formatted_address ?? null,
    lat: raw.geometry.location.lat,
    lng: raw.geometry.location.lng,
    rating: raw.rating ?? null,
    user_ratings: raw.user_ratings_total ?? null,
    photo_url: photo,
    price_level: raw.price_level ?? null,
    is_open: raw.opening_hours?.open_now ?? null,
    maps_url: `https://www.google.com/maps/place/?q=place_id:${raw.place_id}`,
    label: PLACE_TYPE_LABELS[type]?.label ?? type,
    emoji: PLACE_TYPE_LABELS[type]?.emoji ?? "📍",
  }
}

export async function GET(req: NextRequest) {
  const q   = req.nextUrl.searchParams.get("q")?.trim()
  const lat = req.nextUrl.searchParams.get("lat")
  const lng = req.nextUrl.searchParams.get("lng")

  if (!q || q.length < 2) {
    return NextResponse.json({ error: "q (min 2 chars) required", results: [] }, { status: 400 })
  }
  if (!GOOGLE_KEY()) {
    return NextResponse.json({ results: [], has_google_key: false })
  }

  const url = new URL(GOOGLE_TEXT_SEARCH)
  url.searchParams.set("query", q)
  url.searchParams.set("language", "th")
  url.searchParams.set("key", GOOGLE_KEY())
  if (lat && lng) {
    // Bias, not restrict — a 50km radius nudges results toward the trip's
    // area without hiding a place the user is deliberately searching for
    // outside it (e.g. planning tomorrow's city while still in today's).
    url.searchParams.set("location", `${lat},${lng}`)
    url.searchParams.set("radius", "50000")
  }

  const admin = createAdminClient()
  try {
    const gRes = await fetch(url.toString())
    const gData = await gRes.json() as { results: GoogleTextSearchResult[]; status: string }

    if (gData.status !== "OK" && gData.status !== "ZERO_RESULTS") {
      console.error("[places/search] Google API status:", gData.status)
      return NextResponse.json({ error: `Google: ${gData.status}`, results: [] }, { status: 502 })
    }

    const results = (gData.results ?? []).map(r => toSearchResult(r, GOOGLE_KEY()))

    // Cache every result (fire-and-forget, same posture as /api/places).
    for (const r of results) {
      try {
        await admin.from("place_cache").upsert({
          google_place_id: r.id, name: r.name, place_type: r.type,
          address: r.address, latitude: r.lat, longitude: r.lng,
          rating: r.rating, user_ratings_total: r.user_ratings,
          photo_url: r.photo_url, price_level: r.price_level,
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        }, { onConflict: "google_place_id" })
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ results, has_google_key: true })
  } catch (err: any) {
    console.error("[places/search] error:", err.message)
    return NextResponse.json({ error: err.message, results: [] }, { status: 502 })
  }
}
```

- [ ] **Step 2: Write the unit test for the pure function**

```javascript
// web/src/app/api/places/search/route.test.mjs
import assert from "node:assert/strict"
import test from "node:test"
import { toSearchResult } from "./route.ts"

test("toSearchResult maps a full Google result", () => {
  const raw = {
    place_id: "ChIJ_abc123",
    name: "Wat Arun",
    formatted_address: "158 Thanon Wang Doem, Bangkok",
    geometry: { location: { lat: 13.7437, lng: 100.4888 } },
    rating: 4.6,
    user_ratings_total: 12000,
    photos: [{ photo_reference: "ref-xyz" }],
    price_level: undefined,
    opening_hours: { open_now: true },
    types: ["tourist_attraction", "point_of_interest"],
  }
  const result = toSearchResult(raw, "test-key")
  assert.equal(result.id, "ChIJ_abc123")
  assert.equal(result.name, "Wat Arun")
  assert.equal(result.type, "tourist_attraction")
  assert.equal(result.lat, 13.7437)
  assert.equal(result.lng, 100.4888)
  assert.equal(result.rating, 4.6)
  assert.equal(result.is_open, true)
  assert.equal(result.label, "ท่องเที่ยว")
  assert.equal(result.emoji, "🏛️")
  assert.match(result.photo_url, /photo_reference=ref-xyz/)
  assert.match(result.photo_url, /key=test-key/)
})

test("toSearchResult handles a result with no photo, no rating, no address", () => {
  const raw = {
    place_id: "ChIJ_bare",
    name: "Unnamed Spot",
    geometry: { location: { lat: 1, lng: 2 } },
  }
  const result = toSearchResult(raw, "k")
  assert.equal(result.photo_url, null)
  assert.equal(result.rating, null)
  assert.equal(result.address, null)
  assert.equal(result.type, "establishment")
  assert.equal(result.label, "ทั่วไป")
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd web && node --import tsx --test src/app/api/places/search/route.test.mjs`
Expected: `# pass 2`, `# fail 0`

- [ ] **Step 4: Verify against the real Google API**

The dev server must already be running (`dev.slippyai.app`, per the connection established earlier in this project's work). From any machine that can reach it:

Run:
```bash
curl -s "https://dev.slippyai.app/api/places/search?q=Wat%20Arun&lat=13.7563&lng=100.5018" | head -c 800
```
Expected: HTTP 200, JSON with `"results":[...]` containing a real place named something like "Wat Arun (Temple of Dawn)" with a non-null `lat`/`lng` and (if Google has one) a `photo_url` starting `https://maps.googleapis.com/maps/api/place/photo?...`. A `REQUEST_DENIED`/`OVER_QUERY_LIMIT` status here (not an HTTP error, an empty `results: []` with an `error` field) means the Google Cloud project's Places API needs attention — that's an external, non-code fix (see spec's "Open items").

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/places/search/route.ts web/src/app/api/places/search/route.test.mjs
git commit -m "Add Google Places Text Search endpoint for the trip map search bar"
```

---

## Task 2: iOS — fix the `activity` icon

**Files:**
- Modify: `ios/Slippy/Models/JourneyStyle.swift:44`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new — `JourneyStyle.spec("activity").symbol` now returns `"star.fill"` instead of `"camera.fill"`. No other task depends on this value's exact string, so this can run in any order.

- [ ] **Step 1: Make the change**

In `ios/Slippy/Models/JourneyStyle.swift`, line 44:

```swift
        "activity":   Spec(label: "กิจกรรม",    symbol: "camera.fill",                 color: Color(hex: "#10B981"), kind: .place),
```
→
```swift
        "activity":   Spec(label: "กิจกรรม",    symbol: "star.fill",                   color: Color(hex: "#10B981"), kind: .place),
```

- [ ] **Step 2: Build**

Run:
```bash
cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build
```
Expected: `** BUILD SUCCEEDED **`. (If that simulator ID no longer exists on the machine running this, list available ones first: `xcrun simctl list devices | grep "iPhone 16 Pro"` and substitute.)

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Models/JourneyStyle.swift
git commit -m "Change activity pin icon from camera to star"
```

---

## Task 3: iOS — surface `google_place_id`/`photo_url`, fix the missing `details` column

**Files:**
- Modify: `ios/Slippy/Models/TripModels.swift:185-187`
- Modify: `ios/Slippy/ViewModels/TripsViewModel.swift:73-84`

**Interfaces:**
- Consumes: nothing.
- Produces: `TripItineraryItem.placeGooglePlaceId: String?` and `TripItineraryItem.placePhotoURL: String?`, read the same way as the existing `placeAddress`/`placePhone`/`placeWebsite` — Task 6 (`TripOfflineCache.swift`) and Task 7 (`TripMapView.swift` save wiring) both read/write these.

**Why this task exists — a real, pre-existing bug found while researching this plan:** `TripsViewModel.loadItinerary(journeyId:)`'s `trip_itinerary_items` sub-select (`ios/Slippy/ViewModels/TripsViewModel.swift:76-81`) does not include the `details` column, unlike `TripItineraryAPI.itemColumns` which does. Since `TripDetailView` feeds `TripMapView` from `vm.itineraryDays` (confirmed: `ios/Slippy/Views/Trips/TripDetailView.swift:278`, `private var days: [TripItineraryDay] { vm.itineraryDays }`), every `item.details` reaching `TripMapView`/`EditStopSheet` today is `nil` — `EditStopSheet`'s address/phone/website fields are prefilled empty even for a stop that has them saved. Without this fix, `google_place_id`/`photo_url` (this whole feature's data) would never reach the client either.

- [ ] **Step 1: Add the computed properties**

In `ios/Slippy/Models/TripModels.swift`, right after line 187 (`var placeAddress: String? { detailString("address") }`):

```swift
    var placeGooglePlaceId: String? { detailString("google_place_id") }
    var placePhotoURL: String? { detailString("photo_url") }
```

- [ ] **Step 2: Add `details` to the itinerary select**

In `ios/Slippy/ViewModels/TripsViewModel.swift`, the `trip_itinerary_items(...)` sub-select inside `loadItinerary(journeyId:)` (lines 76-81):

```swift
                    trip_itinerary_items(
                        id, day_id, sort_order, type, title, subtitle, location, notes,
                        time_from, time_to, status, provider, confirmation_code,
                        lat, lng, end_location, end_lat, end_lng,
                        amount, currency, exchange_rate, amount_base_currency, expense_id
                    )
```
→
```swift
                    trip_itinerary_items(
                        id, day_id, sort_order, type, title, subtitle, location, notes,
                        time_from, time_to, status, provider, confirmation_code,
                        lat, lng, end_location, end_lat, end_lng,
                        amount, currency, exchange_rate, amount_base_currency, expense_id,
                        details
                    )
```

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Verify the regression fix in the simulator**

This is directly checkable without any new feature: open a trip that already has a stop with an address (e.g. the earlier-added "Bangkok" test stop, or add one), tap the pin, tap edit (pencil icon) — the "ที่อยู่" field should now show the saved address instead of being blank. Screenshot both before/after this task's build if a pre-existing stop with an address is available; otherwise, add one, edit it once to set an address, dismiss, reopen — it should now round-trip correctly where it previously wouldn't have.

- [ ] **Step 5: Commit**

```bash
git add ios/Slippy/Models/TripModels.swift ios/Slippy/ViewModels/TripsViewModel.swift
git commit -m "Fix missing details column in itinerary fetch, add photo/place-id accessors"
```

---

## Task 4: iOS — `PlacesSearchAPI.swift`

**Files:**
- Create: `ios/Slippy/Services/PlacesSearchAPI.swift`

**Interfaces:**
- Consumes: the JSON shape produced by Task 1 (`SearchResult` fields: `id, name, type, address, lat, lng, rating, user_ratings, photo_url, price_level, is_open, maps_url, label, emoji`); `Config.webAppURL` (`ios/Slippy/App/Config.swift:14`); `TripDocumentAPI`'s pattern (`ios/Slippy/Services/TripDocumentAPI.swift`) for the Bearer-token/`APIError`/`base` shape, copied rather than shared, matching how `TripDocumentAPI` itself is a standalone enum (no shared base class in this codebase to extend).
- Produces: `PlacesSearchAPI.search(query: String, near: CLLocationCoordinate2D?) async throws -> [PlacesSearchAPI.PlaceResult]`, `PlacesSearchAPI.PlaceResult` (with `appCategory: String` computed from Google's `type`), `PlacesSearchAPI.uploadPhoto(tripId: String, itemId: String, imageData: Data) async throws -> PlacesSearchAPI.UploadedPhoto`. Task 7 (`TripMapView.swift` search bar) and Task 8 (manual photo upload button) both call these.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/Services/PlacesSearchAPI.swift
import Foundation
import CoreLocation

/// Searching Google Places by name, and uploading a photo to a stop — both go
/// through the web app, same reasoning as TripDocumentAPI: the Google key and
/// the trip-photos upload logic only exist server-side, and a key bundled
/// into the app is a published key.
enum PlacesSearchAPI {

    private static let base: String = {
        ProcessInfo.processInfo.environment["WEB_BASE_URL"] ?? Config.webAppURL.absoluteString
    }()

    enum APIError: LocalizedError {
        case notSignedIn
        case server(String)
        case badResponse

        var errorDescription: String? {
            switch self {
            case .notSignedIn:   return "กรุณาเข้าสู่ระบบใหม่"
            case .server(let m): return m
            case .badResponse:   return "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"
            }
        }
    }

    private static func accessToken() async throws -> String {
        guard let token = try? await SupabaseManager.shared.client.auth.session.accessToken else {
            throw APIError.notSignedIn
        }
        return token
    }

    private static func throwIfError(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "ทำรายการไม่สำเร็จ (\(http.statusCode))")
        }
    }

    // MARK: – Search

    struct PlaceResult: Codable, Identifiable {
        let id: String
        let name: String
        let type: String
        let address: String?
        let lat: Double
        let lng: Double
        let rating: Double?
        let photoURL: String?

        enum CodingKeys: String, CodingKey {
            case id, name, type, address, lat, lng, rating
            case photoURL = "photo_url"
        }

        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }

        /// Google's raw `type` (e.g. "tourist_attraction", "lodging") mapped to
        /// this app's own stop types (JourneyStyle.creatable) — the search-side
        /// twin of TripMapView.appType(for: MKPointOfInterestCategory).
        var appCategory: String {
            switch type {
            case "restaurant", "cafe", "bakery", "meal_takeaway", "meal_delivery", "food", "bar", "night_club":
                return "restaurant"
            case "lodging":
                return "hotel"
            case "shopping_mall", "store", "clothing_store", "department_store", "supermarket", "convenience_store":
                return "shopping"
            case "spa":
                return "onsen"
            default:
                return "activity"
            }
        }
    }

    private struct SearchResponse: Codable {
        let results: [PlaceResult]
    }

    static func search(query: String, near: CLLocationCoordinate2D?) async throws -> [PlaceResult] {
        var components = URLComponents(string: "\(base)/api/places/search")
        var items = [URLQueryItem(name: "q", value: query)]
        if let near {
            items.append(URLQueryItem(name: "lat", value: String(near.latitude)))
            items.append(URLQueryItem(name: "lng", value: String(near.longitude)))
        }
        components?.queryItems = items
        guard let url = components?.url else { throw APIError.badResponse }

        var req = URLRequest(url: url)
        req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: req)
        try throwIfError(data: data, response: response)
        return try JSONDecoder().decode(SearchResponse.self, from: data).results
    }

    // MARK: – Manual photo upload

    struct UploadedPhoto: Codable {
        let id: String
        let url: String
    }

    private struct UploadResponse: Codable {
        let photo: UploadedPhoto
    }

    /// JPEG only, matching what the web route's EXT_MIME accepts most simply —
    /// the picker always hands back a UIImage regardless of the source format,
    /// so re-encoding to JPEG here is not a capability loss.
    static func uploadPhoto(tripId: String, itemId: String, imageData: Data) async throws -> UploadedPhoto {
        guard let url = URL(string: "\(base)/api/trips/\(tripId)/photos") else {
            throw APIError.badResponse
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"itemId\"\r\n\r\n\(itemId)\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"stop.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        req.httpBody = body
        req.timeoutInterval = 60

        let (data, response) = try await URLSession.shared.data(for: req)
        try throwIfError(data: data, response: response)
        return try JSONDecoder().decode(UploadResponse.self, from: data).photo
    }
}
```

- [ ] **Step 2: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Slippy/Services/PlacesSearchAPI.swift
git commit -m "Add PlacesSearchAPI: Google Places search and manual photo upload client"
```

---

## Task 5: iOS — `NetworkStatus.swift` and `CachedPlaceImage.swift`

**Files:**
- Create: `ios/Slippy/Connectivity/NetworkStatus.swift`
- Create: `ios/Slippy/Views/Shared/CachedPlaceImage.swift`

**Interfaces:**
- Consumes: nothing (both are self-contained; `CachedPlaceImage` takes a local file URL and/or a remote URL as plain parameters, no dependency on Task 6's cache-writer — it only reads whatever local file path it's handed).
- Produces: `NetworkStatus.shared.isOnline: Bool` (`@Published`, `ObservableObject`) — consumed by Task 7's offline placeholder. `CachedPlaceImage(localURL: URL?, remoteURL: URL?, size: CGFloat)` view — consumed by Task 7 (search results list) and Task 8 (stop detail photo).

- [ ] **Step 1: Write `NetworkStatus.swift`**

```swift
// ios/Slippy/Connectivity/NetworkStatus.swift
import Foundation
import Network

/// Whether the device currently has any usable network path — gates the map
/// surface in TripMapView, which needs a live connection for MapKit tiles no
/// matter what else this app caches (see the offline-cache design doc: Apple
/// gives no public API for pre-caching map tiles, so "offline map" is not on
/// the table — only "offline stop data" is).
@MainActor
final class NetworkStatus: ObservableObject {
    static let shared = NetworkStatus()

    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "NetworkStatus")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOnline = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }
}
```

- [ ] **Step 2: Write `CachedPlaceImage.swift`**

```swift
// ios/Slippy/Views/Shared/CachedPlaceImage.swift
import SwiftUI

/// A place photo that prefers the on-device copy TripOfflineCache already
/// downloaded, and only reaches the network if there isn't one — the same
/// image loader for both the online search-results list and the offline
/// stop list, so nothing has to branch on connectivity to decide which view
/// to use.
struct CachedPlaceImage: View {
    let localURL: URL?
    let remoteURL: URL?
    var size: CGFloat = 48

    var body: some View {
        Group {
            if let localURL, let uiImage = UIImage(contentsOfFile: localURL.path) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else if let remoteURL {
                AsyncImage(url: remoteURL) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFill()
                    } else {
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.border.opacity(0.4))
            .overlay(Image(systemName: "photo").foregroundColor(Color.textSecondary))
    }
}
```

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/Connectivity/NetworkStatus.swift ios/Slippy/Views/Shared/CachedPlaceImage.swift
git commit -m "Add NetworkStatus and CachedPlaceImage for offline-aware photo display"
```

---

## Task 6: iOS — `TripOfflineCache.swift`

**Files:**
- Create: `ios/Slippy/Services/TripOfflineCache.swift`
- Modify: `ios/Slippy/ViewModels/TripsViewModel.swift` (`loadItinerary`, after the existing `itineraryDays = ...` assignment)

**Interfaces:**
- Consumes: `TripItineraryItem.placePhotoURL` (Task 3), `NetworkStatus.shared.isOnline` (Task 5, to avoid attempting downloads while offline — a wasted attempt that would just time out).
- Produces: `TripOfflineCache.localImageURL(forItemId: String) -> URL?` (returns nil if nothing cached yet) — consumed by Task 7/8 wherever `CachedPlaceImage` needs a `localURL:`. `TripOfflineCache.cache(items: [TripItineraryItem]) async` — called from `TripsViewModel.loadItinerary`.

- [ ] **Step 1: Write the file**

```swift
// ios/Slippy/Services/TripOfflineCache.swift
import Foundation

/// Downloads and keeps each stop's photo on disk the first time it's seen
/// online, so the itinerary list still shows something during travel with no
/// signal. Text fields need no caching step of their own — they arrive
/// already local, inside the Supabase-synced TripItineraryItem/`details` —
/// only the photo bytes need an explicit fetch.
///
/// Opportunistic, not a "download for offline" button: caching piggybacks on
/// every itinerary fetch that happens to be online, matching the trip's
/// original "it should just work" framing rather than adding a step the user
/// has to remember to take before a trip.
enum TripOfflineCache {

    private static var directory: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("trip-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func localImageURL(forItemId itemId: String) -> URL? {
        let file = directory.appendingPathComponent("\(itemId).jpg")
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    /// Best-effort — a stop with no photo_url is skipped, a download that
    /// fails is skipped, neither is surfaced as an error. The same posture as
    /// the on-device MKLocalSearch enrichment in TripMapView: "failure is
    /// fine — the user can type the name" applies just as much to "the user
    /// can look at the address text with no photo".
    static func cache(items: [TripItineraryItem]) async {
        guard await NetworkStatus.shared.isOnline else { return }
        for item in items {
            guard localImageURL(forItemId: item.id) == nil,
                  let urlString = item.placePhotoURL,
                  let url = URL(string: urlString) else { continue }
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
            else { continue }
            let dest = directory.appendingPathComponent("\(item.id).jpg")
            try? data.write(to: dest, options: .atomic)
        }
    }
}
```

- [ ] **Step 2: Hook it into the itinerary fetch**

In `ios/Slippy/ViewModels/TripsViewModel.swift`, `loadItinerary(journeyId:)` — after the existing sort line:

```swift
            itineraryDays = itineraryDays.map { day in
                var copy = day; copy.items = (day.items ?? []).sorted { $0.sortOrder < $1.sortOrder }; return copy
            }
```
add:
```swift
            Task { await TripOfflineCache.cache(items: itineraryDays.flatMap { $0.items ?? [] }) }
```
(fire-and-forget — the itinerary view must render immediately with whatever's already cached from a previous visit; it does not wait on fresh downloads.)

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/Services/TripOfflineCache.swift ios/Slippy/ViewModels/TripsViewModel.swift
git commit -m "Add TripOfflineCache: download stop photos for offline viewing"
```

---

## Task 7: iOS — search bar in `TripMapView.swift`

**Files:**
- Modify: `ios/Slippy/Views/Trips/TripMapView.swift`

**Interfaces:**
- Consumes: `PlacesSearchAPI.search`/`PlacesSearchAPI.PlaceResult` (Task 4), `CachedPlaceImage` (Task 5). Does NOT consume `TripOfflineCache` — a freshly-searched result has no local cache yet by definition; `CachedPlaceImage` is used here with `localURL: nil`, remote-only. Task 9 is where `TripOfflineCache.localImageURL` actually gets consumed.
- Produces: `AddStopSheet` gains an optional `searchResult: PlacesSearchAPI.PlaceResult?` init parameter — no other task consumes this, it's the terminal write path (`save()` writes straight to Supabase via the existing `TripItineraryAPI.addStop`).

- [ ] **Step 1: Add search state and the search bar UI**

In `TripMapView`, add new `@State` alongside the existing ones (near line 60, after `@State private var showImportSheet = false`):

```swift
    @State private var searchQuery = ""
    @State private var searchResults: [PlacesSearchAPI.PlaceResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
```

Add the search bar as a new private computed view, placed right after `daySelector` (before `mapArea`) in `body`:

```swift
    var body: some View {
        VStack(spacing: 0) {
            daySelector
            if canEdit { searchBar }
            mapArea
            bottomBar
            if let selected {
                selectionCard(selected)
            } else if let pending {
                pendingCard(pending)
            }
        }
```

Add the `searchBar` view and its results list, near `daySelector`:

```swift
    // MARK: – Search

    private var searchBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(Color.textSecondary)
                TextField("ค้นหาสถานที่", text: $searchQuery)
                    .onChange(of: searchQuery) { _, newValue in
                        searchTask?.cancel()
                        guard newValue.trimmingCharacters(in: .whitespaces).count >= 2 else {
                            searchResults = []
                            return
                        }
                        searchTask = Task {
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            guard !Task.isCancelled else { return }
                            await runSearch(newValue)
                        }
                    }
                if isSearching { ProgressView().controlSize(.small) }
                if !searchQuery.isEmpty {
                    Button {
                        searchQuery = ""; searchResults = []
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(Color.textSecondary)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.background, in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 12).padding(.top, 8)

            if !searchResults.isEmpty {
                searchResultsList
            }
        }
        .background(Color.surface)
    }

    private var searchResultsList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(searchResults) { result in
                    Button {
                        hapticLight()
                        searchQuery = ""
                        searchResults = []
                        poi = ResolvedPlace(
                            coordinate: result.coordinate,
                            title: result.name,
                            suggestedType: result.appCategory,
                            address: result.address,
                            phone: nil,
                            website: nil
                        )
                        pendingSearchResult = result
                        showAddSheet = true
                    } label: {
                        HStack(spacing: 10) {
                            CachedPlaceImage(
                                localURL: nil,
                                remoteURL: result.photoURL.flatMap(URL.init),
                                size: 44
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(result.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(Color.textPrimary)
                                if let address = result.address {
                                    Text(address)
                                        .font(.system(size: 11))
                                        .foregroundColor(Color.textSecondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    Divider().padding(.leading, 12)
                }
            }
        }
        .frame(maxHeight: 240)
        .background(Color.surface)
    }

    private func runSearch(_ query: String) async {
        isSearching = true
        defer { isSearching = false }
        let near = pins.first?.item.coordinate.map {
            CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng)
        }
        searchResults = (try? await PlacesSearchAPI.search(query: query, near: near)) ?? []
    }
```

- [ ] **Step 2: Carry the selected search result into `AddStopSheet` and `save()`**

Add one more `@State` next to `poi`:

```swift
    @State private var pendingSearchResult: PlacesSearchAPI.PlaceResult?
```

`AddStopSheet` needs the Google data threaded through. Update its call site (the `if let poi { AddStopSheet(...) }` branch, lines 157-169) to pass it along, and clear it alongside `poi` on dismiss:

```swift
        .sheet(isPresented: $showAddSheet, onDismiss: { pending = nil; poi = nil; pendingSearchResult = nil }) {
            if let day = targetDay {
                if let poi {
                    AddStopSheet(
                        coordinate: poi.coordinate,
                        placeNameHint: poi.title,
                        resolved: poi,
                        googlePlaceId: pendingSearchResult?.id,
                        photoURL: pendingSearchResult?.photoURL,
                        day: day,
                        baseCurrency: trip.baseCurrency ?? "THB",
                        onDone: { added in
                            showAddSheet = false
                            self.poi = nil
                            pendingSearchResult = nil
                            if added { Task { await onChanged() } }
                        }
                    )
                } else if let place = pending {
                    AddStopSheet(
                        coordinate: place.coordinate,
                        placeNameHint: place.name,
                        resolved: nil,
                        googlePlaceId: nil,
                        photoURL: nil,
                        day: day,
                        baseCurrency: trip.baseCurrency ?? "THB",
                        onDone: { added in
                            showAddSheet = false
                            pending = nil
                            if added { Task { await onChanged() } }
                        }
                    )
                }
            }
        }
```

Update `AddStopSheet`'s definition: add the two new stored properties and thread them into `save()`.

```swift
private struct AddStopSheet: View {
    let coordinate: CLLocationCoordinate2D
    let placeNameHint: String?
    let resolved: ResolvedPlace?
    /// Non-nil only when this stop came from the search bar (Task 7) — a
    /// tapped map POI or empty-ground pin has neither, and that's fine; not
    /// every stop needs a photo.
    let googlePlaceId: String?
    let photoURL: String?
    let day: TripItineraryDay
    let baseCurrency: String
    let onDone: (Bool) -> Void

    @State private var title: String
    @State private var type: String
    @State private var timeFrom = ""
    @State private var placeName: String?
    @State private var address: String
    @State private var phone: String
    @State private var website: String
    @State private var saving = false
    @State private var errorText: String?
    @Environment(\.dismiss) private var dismiss

    init(coordinate: CLLocationCoordinate2D, placeNameHint: String?, resolved: ResolvedPlace?,
         googlePlaceId: String?, photoURL: String?,
         day: TripItineraryDay, baseCurrency: String, onDone: @escaping (Bool) -> Void) {
        self.coordinate = coordinate
        self.placeNameHint = placeNameHint
        self.resolved = resolved
        self.googlePlaceId = googlePlaceId
        self.photoURL = photoURL
        self.day = day
        self.baseCurrency = baseCurrency
        self.onDone = onDone
        _title = State(initialValue: resolved?.title ?? "")
        _type = State(initialValue: resolved?.suggestedType ?? "activity")
        _address = State(initialValue: resolved?.address ?? "")
        _phone = State(initialValue: resolved?.phone ?? "")
        _website = State(initialValue: resolved?.website ?? "")
    }
```

And `save()` (lines 876-904) gains the two extra `details` keys:

```swift
    private func save() async {
        saving = true
        defer { saving = false }
        var details: [String: AnyJSON] = [:]
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
        let trimmedWebsite = website.trimmingCharacters(in: .whitespaces)
        if !trimmedAddress.isEmpty { details["address"] = .string(trimmedAddress) }
        if !trimmedPhone.isEmpty { details["phone"] = .string(trimmedPhone) }
        if !trimmedWebsite.isEmpty { details["website"] = .string(trimmedWebsite) }
        if let googlePlaceId { details["google_place_id"] = .string(googlePlaceId) }
        if let photoURL { details["photo_url"] = .string(photoURL) }
        do {
            _ = try await TripItineraryAPI.addStop(
                dayId: day.id,
                title: title.trimmingCharacters(in: .whitespaces),
                type: type,
                lat: coordinate.latitude,
                lng: coordinate.longitude,
                location: placeName ?? (trimmedAddress.isEmpty ? nil : trimmedAddress),
                timeFrom: timeFrom.isEmpty ? nil : timeFrom,
                baseCurrency: baseCurrency,
                details: details
            )
            hapticSuccess()
            onDone(true)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
```

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Verify in the simulator**

Launch the built app (`mcp__Claude_Code_iOS_Simulator__control` with `action: "launch"`, same `app_path` pattern used earlier in this project's own testing), open a trip's map (or the standalone "แผนที่" tab inside `TripDetailView`, which is the screen that actually hosts `TripMapView` — confirmed earlier in this project's own simulator testing), type a real, well-known place name (e.g. "วัดพระแก้ว" or "Wat Arun") into the new search field, wait for results, tap one, confirm `AddStopSheet` opens pre-filled with the name/address, save it, confirm the pin appears on the map and the itinerary count increments. Screenshot the search-results list and the resulting pin as evidence.

- [ ] **Step 5: Commit**

```bash
git add ios/Slippy/Views/Trips/TripMapView.swift
git commit -m "Add search bar to TripMapView, wire Google Places results into AddStopSheet"
```

---

## Task 8: iOS — manual photo upload button, and the offline map placeholder

**Files:**
- Modify: `ios/Slippy/Views/Trips/TripMapView.swift`

**Interfaces:**
- Consumes: `PlacesSearchAPI.uploadPhoto` (Task 4), `NetworkStatus.shared` (Task 5), `TripOfflineCache.localImageURL` (Task 6).
- Produces: nothing further downstream — this is the last TripMapView-touching task before the full end-to-end pass.

- [ ] **Step 1: Add a manual "add photo" button to `selectionCard`**

`selectionCard(_:)` (lines 390-506) already has a `VStack(spacing: 10)` of icon buttons for a selected pin (street view, open in Google Maps, edit, move, delete — lines 436-480). Add a photo button into that same stack, right after the street-view button:

```swift
                    if canEdit {
                        Button {
                            hapticLight()
                            showPhotoPicker = true
                        } label: {
                            Image(systemName: "camera.fill").font(.system(size: 13))
                        }
                        .buttonStyle(.borderless)
                    }
```

Add the state and the picker + upload handling. New `@State` near the others:

```swift
    @State private var showPhotoPicker = false
    @State private var uploadingPhoto = false
```

Add a `.photosPicker` modifier on the outer `VStack` in `body` (needs `import PhotosUI` at the top of the file, alongside the existing `import SwiftUI` / `import MapKit` / `import Supabase`):

```swift
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhotoItem, matching: .images)
        .onChange(of: pickedPhotoItem) { _, newItem in
            guard let newItem, let selected else { return }
            Task {
                guard let data = try? await newItem.loadTransferable(type: Data.self) else { return }
                await uploadPhoto(for: selected, imageData: data)
            }
        }
```

One more `@State`:

```swift
    @State private var pickedPhotoItem: PhotosPickerItem?
```

And the upload function, near `deleteSelected`:

```swift
    private func uploadPhoto(for item: TripItineraryItem, imageData: Data) async {
        uploadingPhoto = true
        defer { uploadingPhoto = false; pickedPhotoItem = nil }
        do {
            _ = try await PlacesSearchAPI.uploadPhoto(tripId: trip.id, itemId: item.id, imageData: imageData)
            hapticSuccess()
            await onChanged()
        } catch {
            errorText = error.localizedDescription
        }
    }
```

- [ ] **Step 2: Add the offline map placeholder**

`mapArea`'s `.overlay(alignment: .top)` (lines 296-301) already shows a resolving/moving banner. Add an offline check that replaces the whole map content instead — wrap the existing `MapReader { ... }` body:

```swift
    private var mapArea: some View {
        Group {
            if networkStatus.isOnline {
                liveMapArea
            } else {
                offlinePlaceholder
            }
        }
    }

    private var offlinePlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 32))
                .foregroundColor(Color.textSecondary)
            Text("ต้องต่ออินเทอร์เน็ตเพื่อดูแผนที่")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textPrimary)
            Text("รายการจุดแวะยังดูได้ตามปกติ")
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .background(Color.surface)
    }
```

Rename the existing `mapArea` body to `liveMapArea` (the `MapReader { ... }` block, currently lines 249-303 — same content, just the `private var mapArea: some View {` line becomes `private var liveMapArea: some View {`).

Add the observed object near the other `@State`/`@StateObject` declarations:

```swift
    @StateObject private var networkStatus = NetworkStatus.shared
```

(`NetworkStatus` is `@MainActor` `ObservableObject` with a `static let shared` — `@StateObject` wrapping a shared singleton is the same pattern already used for other app-wide singletons in this codebase, e.g. `PhoneConnectivityManager.shared` elsewhere.)

- [ ] **Step 3: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/Views/Trips/TripMapView.swift
git commit -m "Add manual photo upload button and offline map placeholder to TripMapView"
```

---

## Task 9: iOS — show the stop's photo in the itinerary row

**Files:**
- Modify: `ios/Slippy/Views/Trips/TripDetailView.swift:397-401`

**Interfaces:**
- Consumes: `CachedPlaceImage` (Task 5), `TripOfflineCache.localImageURL` (Task 6), `TripItineraryItem.placePhotoURL` (Task 3).
- Produces: nothing further downstream.

**Why this task exists — another gap found during self-review:** the spec (§5, "Offline read path") says the itinerary list should show a stop's cached photo, but no earlier task actually touches the file that renders that list. `itineraryRow(_:)` (confirmed by reading `TripDetailView.swift:389-401`) currently renders only a small `spec.symbol` icon-in-a-box — never a photo, online or offline. Without this task, Task 9 (Step 5, offline verification)'s claim that "the stop list still shows... cached photo" would be false.

- [ ] **Step 1: Replace the icon box with a photo when one exists**

In `ios/Slippy/Views/Trips/TripDetailView.swift`, `itineraryRow(_:)`:

```swift
            Image(systemName: spec.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(spec.color)
                .frame(width: 28, height: 28)
                .background(spec.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
```
→
```swift
            if let photoURL = item.placePhotoURL {
                CachedPlaceImage(
                    localURL: TripOfflineCache.localImageURL(forItemId: item.id),
                    remoteURL: URL(string: photoURL),
                    size: 28
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                Image(systemName: spec.symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(spec.color)
                    .frame(width: 28, height: 28)
                    .background(spec.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
            }
```

- [ ] **Step 2: Build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Verify in the simulator**

Open a trip whose "แผน" (plan) tab lists a stop added via search (from Task 7's verification, which has a Google photo) — confirm that row now shows the photo thumbnail instead of the category icon. A stop with no `placePhotoURL` (a plain map-tap stop) should still show the icon box exactly as before — confirm at least one such row is unchanged.

- [ ] **Step 4: Commit**

```bash
git add ios/Slippy/Views/Trips/TripDetailView.swift
git commit -m "Show stop photo in the itinerary row when one is available"
```

---

## Task 10: Full end-to-end verification

**Files:** none (verification only).

**Interfaces:** consumes every task's output; produces nothing further.

- [ ] **Step 1: Confirm clean build**

Run: `cd ios && xcodebuild -project Slippy.xcodeproj -scheme Slippy -destination 'id=8CE142B0-B730-482D-92FA-20B810D4ECF9' -skipMacroValidation build`
Expected: `** BUILD SUCCEEDED **`, 0 errors.

- [ ] **Step 2: Install and launch**

Use `mcp__Claude_Code_iOS_Simulator__control` `action: "launch"` with the built `.app` path from DerivedData (same approach used earlier in this project: `/Users/chainimitsakhorn/Library/Developer/Xcode/DerivedData/Slippy-*/Build/Products/Debug-iphonesimulator/Slippy.app`, bundle id `app.slippy.ios`).

- [ ] **Step 3: Online path**

Navigate: หน้าหลัก → ทริป → (a trip) → ค่าใช้จ่าย tab (hosts the real `TripDetailView`) → แผนที่ (inner tab, this is the `TripMapView` all the new code lives in). Search a real place, tap a result, confirm `AddStopSheet` is pre-filled, save it. Confirm: the pin renders with its category's colored circle + icon, the itinerary count went up, and (if the searched place had a Google photo) the search-results-list thumbnail showed one.

- [ ] **Step 4: Manual photo upload**

Tap the new pin, tap the camera-icon button, pick a photo from the simulator's photo library (seed one first if empty: `xcrun simctl addmedia <device> <path-to-jpg>`), confirm no error and the upload completes (`hapticSuccess`, no `errorText` alert).

- [ ] **Step 5: Offline path**

Disable network on the simulator: `Settings → ... ` is unreliable in-simulator; instead use `xcrun simctl` if available, or the Simulator app's own Features → Network Link Conditioner, or (most reliable) toggle the host Mac's Wi-Fi off briefly while the simulator has no separate network stack of its own and will report offline too. Confirm: the map area is replaced by the "ต้องต่ออินเทอร์เน็ตเพื่อดูแผนที่" placeholder, while re-opening the trip's "แผน" (plan) tab still shows the stop list with its cached photo (from Task 6's download during Step 3) rather than a blank image or a crash.

- [ ] **Step 6: Restore connectivity**

Re-enable the network, confirm the map area returns to normal (the `Group { if networkStatus.isOnline ... }` in Task 8 re-renders automatically via the `@StateObject`/`@Published` binding — no manual refresh needed).

- [ ] **Step 7: Clean up test data**

If a throwaway trip/stop was created for this verification (matching the pattern already used earlier in this project — a "Google Maps Test Trip" already exists from prior testing and can be reused instead of creating a new one), leave it or delete the test stop/day via the UI; do not leave stray Supabase rows from a raw SQL insert, since everything here goes through the real app flow and real RLS-scoped writes.

- [ ] **Step 8: Report results**

Summarize: build status, screenshots of the search flow, the offline placeholder, and the restored online map. No commit for this task — it's verification, not a code change.
