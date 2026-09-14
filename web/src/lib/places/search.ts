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
