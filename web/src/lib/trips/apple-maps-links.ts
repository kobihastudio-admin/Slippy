/**
 * Apple Maps universal URLs.  These open the native Maps app on Apple devices
 * and maps.apple.com elsewhere, which is the supported web fallback while the
 * product intentionally does not ship a MapKit JS token.
 */

export type AppleMapCoordinate = [number, number]

const coordinate = ([lat, lng]: AppleMapCoordinate) => `${lat},${lng}`

export function appleMapsPinUrl(point: AppleMapCoordinate, label?: string): string {
  const params = new URLSearchParams({ ll: coordinate(point) })
  if (label) params.set("q", label)
  return `https://maps.apple.com/?${params.toString()}`
}

export function appleMapsDirectionsUrl(input: {
  destination: AppleMapCoordinate
  origin?: AppleMapCoordinate
  label?: string
  mode?: "driving" | "walking" | "transit"
}): string {
  const params = new URLSearchParams({ daddr: coordinate(input.destination) })
  if (input.origin) params.set("saddr", coordinate(input.origin))
  if (input.label) params.set("q", input.label)
  params.set("dirflg", input.mode === "walking" ? "w" : input.mode === "transit" ? "r" : "d")
  return `https://maps.apple.com/?${params.toString()}`
}
