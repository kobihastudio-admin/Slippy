/**
 * Handing a trip off to Google Maps — deep links, no API key.
 *
 * This is NOT an embed of Google Maps into the app; it is the opposite
 * direction: opening this app's data IN Google Maps, on whatever device the
 * user is holding. Google's public URL scheme does this with no key, no
 * billing, and no SDK — https://developers.google.com/maps/documentation/urls
 *
 * WHY A HARD CAP OF 3 WAYPOINTS
 * Confirmed against Google's current docs (fetched 2026-08-24), not recalled
 * from training: "up to three waypoints supported on mobile browsers, and a
 * maximum of nine waypoints supported otherwise." A day's itinerary routinely
 * has more than three stops, and the failure mode for going over is not an
 * error — Google Maps silently drops the extra waypoints. That is exactly the
 * shape of bug this whole codebase has been hunting: a link that "works" and
 * quietly shows less than it claims to.
 *
 * Capped at 3 everywhere, even on contexts that could take 9, because a link
 * generated on desktop and tapped on a phone (AirDrop, a message, a copied URL)
 * would silently truncate on the mobile end — there is no way to know in
 * advance which device will open it, so the safer number is the one that never
 * breaks. For a route with more real stops than that, the full picture belongs
 * in the KML export (buildTripKml), which has no such limit.
 */

export type Coordinate = [number, number]

const MAX_WAYPOINTS = 3

/** Google's travel-mode strings for the types of leg this app's routing knows about. */
export type GoogleTravelMode = "driving" | "walking" | "transit" | "bicycling"

/**
 * Which Google travel mode applies to an itinerary type, or null when there
 * isn't one — a flight or a ferry has no road/rail equivalent Google can route,
 * and forcing "driving" onto one would silently offer to drive across the sea.
 */
export function googleTravelMode(type: string): GoogleTravelMode | null {
  switch (type) {
    case "walk":                                            return "walking"
    case "car_rental": case "taxi": case "bus":              return "driving"
    case "train": case "shinkansen": case "subway":          return "transit"
    default:                                                 return null
  }
}

const coord = (c: Coordinate) => `${c[0]},${c[1]}`

/** A single pin. Works for anything with coordinates — the universal fallback. */
export function googleMapsPinUrl(point: Coordinate, label?: string): string {
  const q = label ? `${label} @${coord(point)}` : coord(point)
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/**
 * Opens Google Street View at a point — no API key, no billing, no SDK.
 * Confirmed against Google's current Maps URLs docs (fetched 2026-08-25):
 * `map_action=pano` + `viewpoint` opens the panorama photographed closest
 * to that coordinate. Chosen over embedding the Street View JS/Static API
 * specifically to avoid it: an embed needs its own API enabled + billing,
 * and — the reason this app is on MapTiler, not Google's JS Maps API, for
 * the main map — Google's JS API fixes its display language at script-load
 * time (a `language=` query param), with no runtime `setLanguage()` the way
 * MapTiler has; switching languages means reloading the whole script. A
 * plain outbound link has none of that: it just opens Street View in
 * whatever Google Maps the visiting device already has.
 */
export function googleStreetViewUrl(point: Coordinate): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coord(point)}`
}

export interface DirectionsRequest {
  /** Omit to let Google Maps use the device's current location as the start —
   *  the realistic case while actually travelling, not planning ahead. */
  origin?: Coordinate
  destination: Coordinate
  /** In visiting order. Only the first `MAX_WAYPOINTS` are kept — see the header. */
  waypoints?: Coordinate[]
  mode?: GoogleTravelMode
}

export interface DirectionsResult {
  url: string
  /** True when there were more stops than the link could carry. */
  truncated: boolean
}

/** Directions with up to 3 waypoints, honestly reporting when more were asked for. */
export function googleMapsDirectionsUrl(req: DirectionsRequest): DirectionsResult {
  const params = new URLSearchParams({ api: "1", destination: coord(req.destination) })
  if (req.origin) params.set("origin", coord(req.origin))
  if (req.mode) params.set("travelmode", req.mode)

  const all = req.waypoints ?? []
  const kept = all.slice(0, MAX_WAYPOINTS)
  if (kept.length) params.set("waypoints", kept.map(coord).join("|"))

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    truncated: all.length > kept.length,
  }
}
