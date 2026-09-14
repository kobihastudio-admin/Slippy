import assert from "node:assert/strict"
import test from "node:test"
import { toSearchResult } from "../../../../lib/places/search.ts"

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
